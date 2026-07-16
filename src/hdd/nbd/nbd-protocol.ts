/**
 * NBD (Network Block Device) protocol pieces shared by the client and the
 * minimal server. Implements exactly the subset OPL's lwNBD server speaks:
 * fixed-newstyle negotiation with NBD_OPT_EXPORT_NAME, and the transmission
 * phase with simple replies (no TLS, no structured replies).
 *
 * Reference: https://github.com/NetworkBlockDevice/nbd/blob/master/doc/proto.md
 */

/** "NBDMAGIC" */
export const NBD_INIT_MAGIC = 0x4e42444d41474943n;
/** "IHAVEOPT" */
export const NBD_OPTS_MAGIC = 0x49484156454f5054n;
export const NBD_REQUEST_MAGIC = 0x25609513;
export const NBD_SIMPLE_REPLY_MAGIC = 0x67446698;
/** Option reply magic (server → client during negotiation). */
export const NBD_OPT_REPLY_MAGIC = 0x3e889045565a9n;

/** Handshake flags (server → client, 16 bit). */
export const NBD_FLAG_FIXED_NEWSTYLE = 1 << 0;
export const NBD_FLAG_NO_ZEROES = 1 << 1;

/** Client flags (client → server, 32 bit). */
export const NBD_FLAG_C_FIXED_NEWSTYLE = 1 << 0;
export const NBD_FLAG_C_NO_ZEROES = 1 << 1;

/** Options. */
export const NBD_OPT_EXPORT_NAME = 1;
export const NBD_OPT_ABORT = 2;
export const NBD_OPT_LIST = 3;

/** Option reply types. */
export const NBD_REP_ACK = 1;
export const NBD_REP_SERVER = 2;
export const NBD_REP_ERR_UNSUP = 0x80000001;

/** Transmission flags (per-export, 16 bit). */
export const NBD_FLAG_HAS_FLAGS = 1 << 0;
export const NBD_FLAG_READ_ONLY = 1 << 1;
export const NBD_FLAG_SEND_FLUSH = 1 << 2;

/** Commands. */
export const NBD_CMD_READ = 0;
export const NBD_CMD_WRITE = 1;
export const NBD_CMD_DISC = 2;
export const NBD_CMD_FLUSH = 3;

/** Errors (simple reply `error` field). */
export const NBD_OK = 0;
export const NBD_EPERM = 1;
export const NBD_EIO = 5;
export const NBD_EINVAL = 22;

export const NBD_DEFAULT_PORT = 10809;
export const NBD_REQUEST_BYTES = 28;
export const NBD_SIMPLE_REPLY_BYTES = 16;

export interface NbdRequest {
  flags: number;
  type: number;
  handle: bigint;
  offset: bigint;
  length: number;
}

/** 28-byte transmission request. All integers big-endian per the NBD spec. */
export function encodeRequest(req: NbdRequest): Buffer {
  const buf = Buffer.alloc(NBD_REQUEST_BYTES);
  buf.writeUInt32BE(NBD_REQUEST_MAGIC, 0);
  buf.writeUInt16BE(req.flags, 4);
  buf.writeUInt16BE(req.type, 6);
  buf.writeBigUInt64BE(req.handle, 8);
  buf.writeBigUInt64BE(req.offset, 16);
  buf.writeUInt32BE(req.length, 24);
  return buf;
}

export function decodeRequest(buf: Buffer): NbdRequest {
  if (buf.readUInt32BE(0) !== NBD_REQUEST_MAGIC) {
    throw new Error("Bad NBD request magic");
  }
  return {
    flags: buf.readUInt16BE(4),
    type: buf.readUInt16BE(6),
    handle: buf.readBigUInt64BE(8),
    offset: buf.readBigUInt64BE(16),
    length: buf.readUInt32BE(24),
  };
}

export interface NbdSimpleReply {
  error: number;
  handle: bigint;
}

export function encodeSimpleReply(reply: NbdSimpleReply): Buffer {
  const buf = Buffer.alloc(NBD_SIMPLE_REPLY_BYTES);
  buf.writeUInt32BE(NBD_SIMPLE_REPLY_MAGIC, 0);
  buf.writeUInt32BE(reply.error, 4);
  buf.writeBigUInt64BE(reply.handle, 8);
  return buf;
}

export function decodeSimpleReply(buf: Buffer): NbdSimpleReply {
  if (buf.readUInt32BE(0) !== NBD_SIMPLE_REPLY_MAGIC) {
    throw new Error("Bad NBD reply magic");
  }
  return { error: buf.readUInt32BE(4), handle: buf.readBigUInt64BE(8) };
}

/**
 * Incremental byte accumulator for parsing a TCP stream: push() incoming
 * chunks, take() exact byte counts once available.
 */
export class ByteQueue {
  private chunks: Buffer[] = [];
  private total = 0;

  public push(chunk: Buffer): void {
    this.chunks.push(chunk);
    this.total += chunk.length;
  }

  public get length(): number {
    return this.total;
  }

  /** Returns exactly n bytes, or null if not enough buffered yet. */
  public take(n: number): Buffer | null {
    if (this.total < n) return null;
    const out = Buffer.alloc(n);
    let done = 0;
    while (done < n) {
      const head = this.chunks[0];
      const take = Math.min(head.length, n - done);
      head.copy(out, done, 0, take);
      if (take === head.length) this.chunks.shift();
      else this.chunks[0] = head.subarray(take);
      done += take;
    }
    this.total -= n;
    return out;
  }
}
