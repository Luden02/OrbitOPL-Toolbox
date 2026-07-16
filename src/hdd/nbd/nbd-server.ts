/**
 * Minimal NBD server: exposes one BlockDevice as a single export. Used by
 * the elevated local-device helper (serving a raw disk to the unprivileged
 * main process over loopback) and by the test suite as a stand-in for OPL.
 *
 * Speaks the same subset as the client: fixed-newstyle negotiation,
 * NBD_OPT_EXPORT_NAME / LIST / ABORT, simple replies, READ/WRITE/FLUSH/DISC.
 */

import * as net from "net";
import { createLogger } from "../../logger";
import { BlockDevice, SECTOR_SIZE } from "../block-device";
import {
  ByteQueue,
  NBD_CMD_DISC,
  NBD_CMD_FLUSH,
  NBD_CMD_READ,
  NBD_CMD_WRITE,
  NBD_EINVAL,
  NBD_EIO,
  NBD_EPERM,
  NBD_FLAG_C_NO_ZEROES,
  NBD_FLAG_FIXED_NEWSTYLE,
  NBD_FLAG_HAS_FLAGS,
  NBD_FLAG_NO_ZEROES,
  NBD_FLAG_READ_ONLY,
  NBD_FLAG_SEND_FLUSH,
  NBD_INIT_MAGIC,
  NBD_OPT_ABORT,
  NBD_OPT_EXPORT_NAME,
  NBD_OPT_LIST,
  NBD_OPT_REPLY_MAGIC,
  NBD_OPTS_MAGIC,
  NBD_REP_ACK,
  NBD_REP_ERR_UNSUP,
  NBD_REP_SERVER,
  NBD_REQUEST_BYTES,
  decodeRequest,
  encodeSimpleReply,
} from "./nbd-protocol";

const log = createLogger("nbd-server");

export interface NbdServerOptions {
  exportName?: string;
  host?: string;
  /** 0 = ephemeral (read the actual port from `address()`). */
  port?: number;
}

export class NbdServer {
  private readonly server: net.Server;
  private readonly exportName: string;
  private readonly sockets = new Set<net.Socket>();

  constructor(private readonly device: BlockDevice, opts?: NbdServerOptions) {
    this.exportName = opts?.exportName ?? "hdd0";
    this.server = net.createServer((socket) => {
      this.sockets.add(socket);
      socket.on("close", () => this.sockets.delete(socket));
      handleConnection(socket, this.device, this.exportName).catch((err) => {
        log.verbose(`NBD session ended: ${err instanceof Error ? err.message : err}`);
        socket.destroy();
      });
    });
  }

  public listen(opts?: NbdServerOptions): Promise<{ host: string; port: number }> {
    const host = opts?.host ?? "127.0.0.1";
    const port = opts?.port ?? 0;
    return new Promise((resolve, reject) => {
      this.server.once("error", reject);
      this.server.listen(port, host, () => {
        const addr = this.server.address() as net.AddressInfo;
        resolve({ host, port: addr.port });
      });
    });
  }

  /** Serves a single already-connected socket (helper mode: no listener). */
  public async serveSocket(socket: net.Socket): Promise<void> {
    this.sockets.add(socket);
    socket.on("close", () => this.sockets.delete(socket));
    await handleConnection(socket, this.device, this.exportName);
  }

  public async close(): Promise<void> {
    for (const socket of this.sockets) socket.destroy();
    this.sockets.clear();
    await new Promise<void>((resolve) => this.server.close(() => resolve()));
  }
}

/** Waits until `queue` holds n bytes, resolving them as they stream in. */
function makeTaker(socket: net.Socket): { take: (n: number) => Promise<Buffer>; dispose: () => void } {
  const queue = new ByteQueue();
  let notify: (() => void) | null = null;
  let streamError: Error | null = null;
  const onData = (chunk: Buffer) => {
    queue.push(chunk);
    notify?.();
  };
  const onEnd = () => {
    streamError = streamError ?? new Error("Connection closed");
    notify?.();
  };
  socket.on("data", onData);
  socket.on("error", (err) => {
    streamError = err;
    notify?.();
  });
  socket.on("close", onEnd);
  return {
    take: async (n: number): Promise<Buffer> => {
      for (;;) {
        const buf = queue.take(n);
        if (buf) return buf;
        if (streamError) throw streamError;
        await new Promise<void>((resolve) => {
          notify = resolve;
        });
        notify = null;
      }
    },
    dispose: () => {
      socket.removeListener("data", onData);
    },
  };
}

async function handleConnection(
  socket: net.Socket,
  device: BlockDevice,
  exportName: string
): Promise<void> {
  socket.setNoDelay(true);
  const { take, dispose } = makeTaker(socket);
  try {
    // Greeting: NBDMAGIC + IHAVEOPT + handshake flags.
    const greeting = Buffer.alloc(18);
    greeting.writeBigUInt64BE(NBD_INIT_MAGIC, 0);
    greeting.writeBigUInt64BE(NBD_OPTS_MAGIC, 8);
    greeting.writeUInt16BE(NBD_FLAG_FIXED_NEWSTYLE | NBD_FLAG_NO_ZEROES, 16);
    socket.write(greeting);

    const clientFlags = (await take(4)).readUInt32BE(0);
    const noZeroes = (clientFlags & NBD_FLAG_C_NO_ZEROES) !== 0;

    // Option haggling until EXPORT_NAME enters transmission.
    for (;;) {
      const optHeader = await take(16);
      if (optHeader.readBigUInt64BE(0) !== NBD_OPTS_MAGIC) {
        throw new Error("Bad option magic from client");
      }
      const option = optHeader.readUInt32BE(8);
      const dataLen = optHeader.readUInt32BE(12);
      const data = dataLen > 0 ? await take(dataLen) : Buffer.alloc(0);

      if (option === NBD_OPT_EXPORT_NAME) {
        const requested = data.toString("utf8");
        if (requested !== exportName && requested !== "") {
          // EXPORT_NAME has no error reply; the spec says disconnect.
          throw new Error(`Unknown export "${requested}"`);
        }
        const flags =
          NBD_FLAG_HAS_FLAGS |
          NBD_FLAG_SEND_FLUSH |
          (device.readOnly ? NBD_FLAG_READ_ONLY : 0);
        const info = Buffer.alloc(noZeroes ? 10 : 134);
        info.writeBigUInt64BE(BigInt(device.sizeBytes), 0);
        info.writeUInt16BE(flags, 8);
        socket.write(info);
        break;
      } else if (option === NBD_OPT_LIST) {
        const name = Buffer.from(exportName, "utf8");
        socket.write(optionReply(option, NBD_REP_SERVER, Buffer.concat([u32(name.length), name])));
        socket.write(optionReply(option, NBD_REP_ACK, Buffer.alloc(0)));
      } else if (option === NBD_OPT_ABORT) {
        socket.write(optionReply(option, NBD_REP_ACK, Buffer.alloc(0)));
        socket.end();
        return;
      } else {
        socket.write(optionReply(option, NBD_REP_ERR_UNSUP, Buffer.alloc(0)));
      }
    }

    // Transmission phase.
    for (;;) {
      const req = decodeRequest(await take(NBD_REQUEST_BYTES));
      if (req.type === NBD_CMD_DISC) {
        socket.end();
        return;
      }
      const offset = Number(req.offset);
      switch (req.type) {
        case NBD_CMD_READ: {
          let error = 0;
          let payload: Buffer | null = null;
          if (!validRange(device, offset, req.length)) {
            error = NBD_EINVAL;
          } else {
            try {
              payload = await device.read(offset, req.length);
            } catch {
              error = NBD_EIO;
            }
          }
          socket.write(encodeSimpleReply({ error, handle: req.handle }));
          if (payload && error === 0) socket.write(payload);
          break;
        }
        case NBD_CMD_WRITE: {
          const payload = await take(req.length); // consume even on error
          let error = 0;
          if (device.readOnly) error = NBD_EPERM;
          else if (!validRange(device, offset, req.length)) error = NBD_EINVAL;
          else {
            try {
              await device.write(offset, payload);
            } catch {
              error = NBD_EIO;
            }
          }
          socket.write(encodeSimpleReply({ error, handle: req.handle }));
          break;
        }
        case NBD_CMD_FLUSH: {
          let error = 0;
          try {
            await device.flush();
          } catch {
            error = NBD_EIO;
          }
          socket.write(encodeSimpleReply({ error, handle: req.handle }));
          break;
        }
        default:
          socket.write(encodeSimpleReply({ error: NBD_EINVAL, handle: req.handle }));
      }
    }
  } finally {
    dispose();
  }
}

function validRange(device: BlockDevice, offset: number, length: number): boolean {
  return (
    offset >= 0 &&
    length > 0 &&
    offset + length <= device.sizeBytes &&
    offset % SECTOR_SIZE === 0 &&
    length % SECTOR_SIZE === 0
  );
}

function u32(value: number): Buffer {
  const buf = Buffer.alloc(4);
  buf.writeUInt32BE(value, 0);
  return buf;
}

function optionReply(option: number, type: number, data: Buffer): Buffer {
  const header = Buffer.alloc(20);
  header.writeBigUInt64BE(NBD_OPT_REPLY_MAGIC, 0);
  header.writeUInt32BE(option, 8);
  header.writeUInt32BE(type >>> 0, 12);
  header.writeUInt32BE(data.length, 16);
  return data.length > 0 ? Buffer.concat([header, data]) : header;
}
