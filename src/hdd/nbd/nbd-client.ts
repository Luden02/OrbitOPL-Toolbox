/**
 * NBD client — the BlockDevice used for OPL's built-in NBD server (and for
 * the elevated local-device helper, which re-serves a raw disk over
 * loopback with the same protocol).
 *
 * Speaks fixed-newstyle negotiation with NBD_OPT_EXPORT_NAME, then the
 * transmission phase with simple replies. Requests are pipelined over one
 * socket and matched to replies by handle. Large transfers are split into
 * conservative chunks: the PS2 side (lwNBD on the IOP) is happier with
 * modest request sizes, and it caps read replies well below the protocol
 * maximum.
 */

import * as net from "net";
import { createLogger, formatBytes } from "../../logger";
import { BlockDevice, assertAligned } from "../block-device";
import {
  ByteQueue,
  NBD_CMD_DISC,
  NBD_CMD_FLUSH,
  NBD_CMD_READ,
  NBD_CMD_WRITE,
  NBD_DEFAULT_PORT,
  NBD_FLAG_C_FIXED_NEWSTYLE,
  NBD_FLAG_C_NO_ZEROES,
  NBD_FLAG_FIXED_NEWSTYLE,
  NBD_FLAG_NO_ZEROES,
  NBD_FLAG_READ_ONLY,
  NBD_FLAG_SEND_FLUSH,
  NBD_INIT_MAGIC,
  NBD_OPT_EXPORT_NAME,
  NBD_OPTS_MAGIC,
  NBD_SIMPLE_REPLY_BYTES,
  decodeSimpleReply,
  encodeRequest,
} from "./nbd-protocol";

const log = createLogger("nbd");

export interface NbdConnectOptions {
  host: string;
  port?: number;
  /** OPL exports the internal drive as "hdd0". */
  exportName?: string;
  /** Per-request watchdog. The PS2 link is slow; default is generous. */
  timeoutMs?: number;
  /** Max bytes per READ/WRITE request. */
  maxChunkBytes?: number;
  connectTimeoutMs?: number;
}

interface Pending {
  resolve: (data: Buffer | null) => void;
  reject: (err: Error) => void;
  /** READ requests expect this many payload bytes after the reply header. */
  readLength: number;
  timer: NodeJS.Timeout;
}

export class NbdBlockDevice implements BlockDevice {
  public readonly sizeBytes: number;
  public readonly readOnly: boolean;
  public readonly canFlush: boolean;

  private readonly socket: net.Socket;
  private readonly queue = new ByteQueue();
  private readonly pending = new Map<bigint, Pending>();
  private nextHandle = 1n;
  private closed = false;
  private readonly timeoutMs: number;
  private readonly maxChunkBytes: number;
  /** Reply currently being received (header parsed, payload outstanding). */
  private receiving: { handle: bigint; error: number } | null = null;

  private constructor(
    socket: net.Socket,
    sizeBytes: number,
    transmissionFlags: number,
    opts: Required<Pick<NbdConnectOptions, "timeoutMs" | "maxChunkBytes">>
  ) {
    this.socket = socket;
    this.sizeBytes = sizeBytes;
    this.readOnly = (transmissionFlags & NBD_FLAG_READ_ONLY) !== 0;
    this.canFlush = (transmissionFlags & NBD_FLAG_SEND_FLUSH) !== 0;
    this.timeoutMs = opts.timeoutMs;
    this.maxChunkBytes = opts.maxChunkBytes;

    socket.on("data", (chunk: Buffer) => this.onData(chunk));
    socket.on("error", (err) => this.failAll(err));
    socket.on("close", () => {
      if (!this.closed) this.failAll(new Error("NBD connection closed unexpectedly"));
    });
  }

  public static async connect(opts: NbdConnectOptions): Promise<NbdBlockDevice> {
    const port = opts.port ?? NBD_DEFAULT_PORT;
    const exportName = opts.exportName ?? "hdd0";
    const timeoutMs = opts.timeoutMs ?? 30000;
    const maxChunkBytes = opts.maxChunkBytes ?? 256 * 1024;

    const socket = await new Promise<net.Socket>((resolve, reject) => {
      const s = net.connect({ host: opts.host, port });
      const to = setTimeout(() => {
        s.destroy();
        reject(new Error(`Timed out connecting to ${opts.host}:${port}`));
      }, opts.connectTimeoutMs ?? 10000);
      s.once("connect", () => {
        clearTimeout(to);
        resolve(s);
      });
      s.once("error", (err) => {
        clearTimeout(to);
        reject(err);
      });
    });
    socket.setNoDelay(true);

    try {
      const size = await NbdBlockDevice.negotiate(socket, exportName, timeoutMs);
      log.info(
        `Connected to NBD export "${exportName}" at ${opts.host}:${port} — ` +
          `${formatBytes(Number(size.exportSize))}${size.readOnly ? " (read-only)" : ""}`
      );
      return new NbdBlockDevice(socket, Number(size.exportSize), size.transmissionFlags, {
        timeoutMs,
        maxChunkBytes,
      });
    } catch (err) {
      socket.destroy();
      throw err;
    }
  }

  /** Fixed-newstyle handshake + NBD_OPT_EXPORT_NAME. */
  private static async negotiate(
    socket: net.Socket,
    exportName: string,
    timeoutMs: number
  ): Promise<{ exportSize: bigint; transmissionFlags: number; readOnly: boolean }> {
    const queue = new ByteQueue();
    let notify: (() => void) | null = null;
    let streamError: Error | null = null;
    const onData = (chunk: Buffer) => {
      queue.push(chunk);
      notify?.();
    };
    const onErr = (err: Error) => {
      streamError = err;
      notify?.();
    };
    socket.on("data", onData);
    socket.on("error", onErr);
    socket.on("close", () => onErr(new Error("Connection closed during NBD negotiation")));

    const deadline = Date.now() + timeoutMs;
    const take = async (n: number): Promise<Buffer> => {
      for (;;) {
        if (streamError) throw streamError;
        const buf = queue.take(n);
        if (buf) return buf;
        if (Date.now() > deadline) throw new Error("NBD negotiation timed out");
        await new Promise<void>((resolve) => {
          notify = resolve;
          setTimeout(resolve, 250);
        });
        notify = null;
      }
    };

    try {
      const greeting = await take(18);
      if (greeting.readBigUInt64BE(0) !== NBD_INIT_MAGIC) {
        throw new Error("Not an NBD server (bad INIT magic)");
      }
      if (greeting.readBigUInt64BE(8) !== NBD_OPTS_MAGIC) {
        throw new Error("NBD server uses oldstyle negotiation — not supported");
      }
      const handshakeFlags = greeting.readUInt16BE(16);
      if ((handshakeFlags & NBD_FLAG_FIXED_NEWSTYLE) === 0) {
        throw new Error("NBD server does not offer fixed-newstyle negotiation");
      }
      const noZeroes = (handshakeFlags & NBD_FLAG_NO_ZEROES) !== 0;

      const clientFlags = Buffer.alloc(4);
      clientFlags.writeUInt32BE(
        NBD_FLAG_C_FIXED_NEWSTYLE | (noZeroes ? NBD_FLAG_C_NO_ZEROES : 0),
        0
      );
      socket.write(clientFlags);

      const nameBytes = Buffer.from(exportName, "utf8");
      const opt = Buffer.alloc(16 + nameBytes.length);
      opt.writeBigUInt64BE(NBD_OPTS_MAGIC, 0);
      opt.writeUInt32BE(NBD_OPT_EXPORT_NAME, 8);
      opt.writeUInt32BE(nameBytes.length, 12);
      nameBytes.copy(opt, 16);
      socket.write(opt);

      // EXPORT_NAME reply: u64 size + u16 transmission flags (+ 124 zero pad)
      const info = await take(10);
      const exportSize = info.readBigUInt64BE(0);
      const transmissionFlags = info.readUInt16BE(8);
      if (!noZeroes) await take(124);
      if (exportSize <= 0n) {
        throw new Error("NBD server reported a zero-size export");
      }
      return {
        exportSize,
        transmissionFlags,
        readOnly: (transmissionFlags & NBD_FLAG_READ_ONLY) !== 0,
      };
    } finally {
      socket.removeListener("data", onData);
      socket.removeListener("error", onErr);
      // Anything already buffered belongs to the transmission phase; there
      // shouldn't be any, since the client speaks first after negotiation.
    }
  }

  private onData(chunk: Buffer): void {
    this.queue.push(chunk);
    for (;;) {
      if (this.receiving === null) {
        const header = this.queue.take(NBD_SIMPLE_REPLY_BYTES);
        if (!header) return;
        let reply;
        try {
          reply = decodeSimpleReply(header);
        } catch (err) {
          this.failAll(err instanceof Error ? err : new Error(String(err)));
          return;
        }
        this.receiving = { handle: reply.handle, error: reply.error };
      }
      const pending = this.pending.get(this.receiving.handle);
      if (!pending) {
        this.failAll(new Error(`NBD reply for unknown handle ${this.receiving.handle}`));
        return;
      }
      if (this.receiving.error !== 0) {
        // Errored reads carry no payload.
        this.settle(this.receiving.handle, null, this.receiving.error);
        this.receiving = null;
        continue;
      }
      if (pending.readLength > 0) {
        const payload = this.queue.take(pending.readLength);
        if (!payload) return;
        this.settle(this.receiving.handle, payload, 0);
      } else {
        this.settle(this.receiving.handle, null, 0);
      }
      this.receiving = null;
    }
  }

  private settle(handle: bigint, data: Buffer | null, error: number): void {
    const pending = this.pending.get(handle);
    if (!pending) return;
    this.pending.delete(handle);
    clearTimeout(pending.timer);
    if (error !== 0) {
      pending.reject(new Error(`NBD server returned error ${error}`));
    } else {
      pending.resolve(data);
    }
  }

  private failAll(err: Error): void {
    for (const [, pending] of this.pending) {
      clearTimeout(pending.timer);
      pending.reject(err);
    }
    this.pending.clear();
    if (!this.closed) {
      this.closed = true;
      this.socket.destroy();
    }
  }

  private request(type: number, offset: number, length: number, payload?: Buffer): Promise<Buffer | null> {
    if (this.closed) return Promise.reject(new Error("NBD connection is closed"));
    const handle = this.nextHandle++;
    const header = encodeRequest({
      flags: 0,
      type,
      handle,
      offset: BigInt(offset),
      length,
    });
    return new Promise<Buffer | null>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(handle);
        this.failAll(new Error(`NBD request timed out after ${this.timeoutMs} ms`));
      }, this.timeoutMs);
      this.pending.set(handle, {
        resolve,
        reject,
        readLength: type === NBD_CMD_READ ? length : 0,
        timer,
      });
      this.socket.write(payload ? Buffer.concat([header, payload]) : header);
    });
  }

  public async read(offsetBytes: number, lengthBytes: number): Promise<Buffer> {
    assertAligned(offsetBytes, lengthBytes);
    if (offsetBytes + lengthBytes > this.sizeBytes) {
      throw new Error("NBD read beyond end of export");
    }
    const parts: Buffer[] = [];
    for (let done = 0; done < lengthBytes; ) {
      const n = Math.min(this.maxChunkBytes, lengthBytes - done);
      const data = await this.request(NBD_CMD_READ, offsetBytes + done, n);
      if (!data) throw new Error("NBD read returned no data");
      parts.push(data);
      done += n;
    }
    return parts.length === 1 ? parts[0] : Buffer.concat(parts);
  }

  public async write(offsetBytes: number, data: Buffer): Promise<void> {
    assertAligned(offsetBytes, data.length);
    if (this.readOnly) throw new Error("NBD export is read-only");
    if (offsetBytes + data.length > this.sizeBytes) {
      throw new Error("NBD write beyond end of export");
    }
    for (let done = 0; done < data.length; ) {
      const n = Math.min(this.maxChunkBytes, data.length - done);
      await this.request(NBD_CMD_WRITE, offsetBytes + done, n, data.subarray(done, done + n));
      done += n;
    }
  }

  public async flush(): Promise<void> {
    if (!this.canFlush || this.closed) return;
    try {
      await this.request(NBD_CMD_FLUSH, 0, 0);
    } catch (err) {
      // A failed flush is worth noting but not fatal: data writes already
      // received simple-reply acknowledgements.
      log.warn(`NBD flush failed: ${err instanceof Error ? err.message : err}`);
    }
  }

  public async close(): Promise<void> {
    if (this.closed) return;
    this.closed = true;
    try {
      // DISC has no reply; give the FIN a moment to go out.
      this.socket.write(
        encodeRequest({ flags: 0, type: NBD_CMD_DISC, handle: this.nextHandle++, offset: 0n, length: 0 })
      );
      await new Promise<void>((resolve) => {
        this.socket.end(() => resolve());
        setTimeout(resolve, 1000);
      });
    } finally {
      this.socket.destroy();
    }
  }
}
