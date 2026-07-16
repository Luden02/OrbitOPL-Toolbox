/**
 * Block-device abstraction the whole HDD feature is built on.
 *
 * Every transport (OPL's NBD server over the network, a locally attached
 * PS2 drive served by the elevated helper, an in-memory image in tests)
 * implements this one interface, so the APA/HDL logic above it never knows
 * where the sectors actually live.
 *
 * All offsets and lengths are in bytes but must be multiples of the 512-byte
 * sector size — PS2 APA disks always use 512-byte logical sectors.
 */

export const SECTOR_SIZE = 512;

export interface BlockDevice {
  /** Total device size in bytes (always a multiple of 512). */
  readonly sizeBytes: number;
  readonly readOnly: boolean;
  /** `offsetBytes` and `lengthBytes` must be 512-byte aligned. */
  read(offsetBytes: number, lengthBytes: number): Promise<Buffer>;
  write(offsetBytes: number, data: Buffer): Promise<void>;
  flush(): Promise<void>;
  close(): Promise<void>;
}

export function assertAligned(offsetBytes: number, lengthBytes: number): void {
  if (offsetBytes % SECTOR_SIZE !== 0 || lengthBytes % SECTOR_SIZE !== 0) {
    throw new Error(
      `Unaligned block access: offset=${offsetBytes} length=${lengthBytes} ` +
        `(must be multiples of ${SECTOR_SIZE})`
    );
  }
  if (offsetBytes < 0 || lengthBytes < 0) {
    throw new Error(
      `Negative block access: offset=${offsetBytes} length=${lengthBytes}`
    );
  }
}

/**
 * Sparse in-memory block device used by unit tests and fixtures. Storage is
 * chunked so a "2 TiB disk" only costs memory for the regions actually
 * written; unwritten regions read back as zeros (matching a blank disk).
 */
export class MemoryBlockDevice implements BlockDevice {
  private static readonly CHUNK = 1024 * 1024; // 1 MiB backing chunks
  private readonly chunks = new Map<number, Buffer>();
  public readonly readOnly: boolean;

  constructor(
    public readonly sizeBytes: number,
    opts?: { readOnly?: boolean }
  ) {
    if (sizeBytes % SECTOR_SIZE !== 0) {
      throw new Error(`Device size ${sizeBytes} is not sector-aligned`);
    }
    this.readOnly = opts?.readOnly ?? false;
  }

  private checkBounds(offsetBytes: number, lengthBytes: number): void {
    assertAligned(offsetBytes, lengthBytes);
    if (offsetBytes + lengthBytes > this.sizeBytes) {
      throw new Error(
        `Block access beyond device end: offset=${offsetBytes} ` +
          `length=${lengthBytes} size=${this.sizeBytes}`
      );
    }
  }

  public async read(offsetBytes: number, lengthBytes: number): Promise<Buffer> {
    this.checkBounds(offsetBytes, lengthBytes);
    const out = Buffer.alloc(lengthBytes);
    let done = 0;
    while (done < lengthBytes) {
      const abs = offsetBytes + done;
      const chunkIndex = Math.floor(abs / MemoryBlockDevice.CHUNK);
      const within = abs % MemoryBlockDevice.CHUNK;
      const n = Math.min(lengthBytes - done, MemoryBlockDevice.CHUNK - within);
      const chunk = this.chunks.get(chunkIndex);
      if (chunk) chunk.copy(out, done, within, within + n);
      done += n;
    }
    return out;
  }

  public async write(offsetBytes: number, data: Buffer): Promise<void> {
    if (this.readOnly) throw new Error("Device is read-only");
    this.checkBounds(offsetBytes, data.length);
    let done = 0;
    while (done < data.length) {
      const abs = offsetBytes + done;
      const chunkIndex = Math.floor(abs / MemoryBlockDevice.CHUNK);
      const within = abs % MemoryBlockDevice.CHUNK;
      const n = Math.min(data.length - done, MemoryBlockDevice.CHUNK - within);
      let chunk = this.chunks.get(chunkIndex);
      if (!chunk) {
        chunk = Buffer.alloc(MemoryBlockDevice.CHUNK);
        this.chunks.set(chunkIndex, chunk);
      }
      data.copy(chunk, within, done, done + n);
      done += n;
    }
  }

  public async flush(): Promise<void> {}
  public async close(): Promise<void> {}
}
