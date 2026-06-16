import * as fs from "fs/promises";
import * as lz4 from "lz4js";
import { createLogger, formatBytes } from "./logger";

const log = createLogger("zso");

/**
 * ISO -> ZSO (ZISO) compressor.
 *
 * ZISO is the format Open PS2 Loader reads for compressed images: a small
 * header, a block-offset index, then a sequence of independently-compressed
 * 2 KiB blocks (raw LZ4 *block* format, not the LZ4 frame format). Each block
 * is compressed on its own so OPL can seek to and decompress any block in
 * isolation — matches must never cross a block boundary.
 *
 * Reference: maxcso / ziso.py.
 */

const ZISO_MAGIC = 0x4f53495a; // "ZISO"
const HEADER_SIZE = 0x18; // 24 bytes
const BLOCK_SIZE = 2048;
const VERSION = 1;
const NOT_COMPRESSED = 0x80000000;
const HASH_SIZE = 1 << 16;
const READ_BLOCKS_PER_CHUNK = 2048; // read ~4 MiB of source at a time

export interface ZsoResult {
  success: boolean;
  message?: string;
  zsoPath?: string;
  originalBytes?: number;
  compressedBytes?: number;
}

function alignUp(value: number, align: number): number {
  if (align === 0) return value;
  const unit = 1 << align;
  return Math.ceil(value / unit) * unit;
}

/**
 * Picks the smallest alignment shift such that every block offset fits in the
 * 31 usable bits of an index entry (the top bit is the "uncompressed" flag).
 * align=0 caps at 2 GiB; PS2 DVD images can exceed that, so we scale up.
 */
function chooseAlign(maxPossibleOffset: number): number {
  let align = 0;
  while (Math.floor(maxPossibleOffset / Math.pow(2, align)) >= 0x80000000) {
    align++;
  }
  return align;
}

export async function compressIsoToZso(
  isoPath: string,
  zsoPath: string,
  deleteOriginal: boolean,
  onProgress?: (percent: number, stage: string) => void
): Promise<ZsoResult> {
  let input: fs.FileHandle | null = null;
  let output: fs.FileHandle | null = null;

  try {
    input = await fs.open(isoPath, "r");
    const stat = await input.stat();
    const totalBytes = stat.size;

    if (totalBytes === 0) {
      log.error(`Source ISO is empty: ${isoPath}`);
      return { success: false, message: "Source ISO is empty." };
    }

    const numBlocks = Math.ceil(totalBytes / BLOCK_SIZE);
    const indexSize = (numBlocks + 1) * 4;
    const worstCaseEnd = HEADER_SIZE + indexSize + totalBytes + numBlocks; // raw + padding slack
    const align = chooseAlign(worstCaseEnd);

    log.info(
      `Compressing ISO → ZSO: ${isoPath} (${formatBytes(totalBytes)}, ` +
        `${numBlocks} × ${BLOCK_SIZE}B blocks)`
    );
    log.verbose(
      `ZISO params: align=${align} (unit ${1 << align}B), index ${formatBytes(indexSize)}, ` +
        `output ${zsoPath}`
    );

    output = await fs.open(zsoPath, "w");

    // Block index, filled as we stream; written out at the end.
    const index = new Uint32Array(numBlocks + 1);

    const hashTable = new Uint32Array(HASH_SIZE);
    const blockBuf = new Uint8Array(BLOCK_SIZE);
    const compBuf = new Uint8Array(lz4.compressBound(BLOCK_SIZE));
    const readBuf = Buffer.alloc(BLOCK_SIZE * READ_BLOCKS_PER_CHUNK);

    let writePos = alignUp(HEADER_SIZE + indexSize, align);
    let readPos = 0;
    let blockIndex = 0;
    let lastProgress = -1;
    let lastVerboseMilestone = 0;

    while (readPos < totalBytes) {
      const { bytesRead } = await input.read(
        readBuf,
        0,
        readBuf.length,
        readPos
      );
      if (bytesRead === 0) break;

      let chunkOffset = 0;
      while (chunkOffset < bytesRead) {
        const remainingInChunk = bytesRead - chunkOffset;
        const thisBlockBytes = Math.min(BLOCK_SIZE, remainingInChunk);

        // Copy the block, zero-padding the final short block to BLOCK_SIZE.
        blockBuf.fill(0);
        readBuf.copy(
          blockBuf,
          0,
          chunkOffset,
          chunkOffset + thisBlockBytes
        );

        hashTable.fill(0);
        const compSize = lz4.compressBlock(
          blockBuf,
          compBuf,
          0,
          BLOCK_SIZE,
          hashTable
        );

        const alignedPos = alignUp(writePos, align);
        let stored: Uint8Array;
        let isCompressed: boolean;

        if (compSize > 0 && compSize < BLOCK_SIZE) {
          stored = compBuf.subarray(0, compSize);
          isCompressed = true;
        } else {
          stored = blockBuf;
          isCompressed = false;
        }

        await output.write(
          Buffer.from(stored.buffer, stored.byteOffset, stored.length),
          0,
          stored.length,
          alignedPos
        );

        let entry = Math.floor(alignedPos / Math.pow(2, align));
        if (!isCompressed) entry += NOT_COMPRESSED;
        index[blockIndex] = entry >>> 0;

        writePos = alignedPos + stored.length;
        blockIndex++;
        chunkOffset += thisBlockBytes;
      }

      readPos += bytesRead;

      const percent = Math.floor((readPos / totalBytes) * 100);
      if (onProgress && percent !== lastProgress) {
        lastProgress = percent;
        onProgress(percent, "Compressing to ZSO");
      }
      if (percent >= lastVerboseMilestone + 25) {
        lastVerboseMilestone = percent - (percent % 25);
        log.verbose(
          `ZSO compression ${lastVerboseMilestone}% — ${blockIndex}/${numBlocks} blocks, ` +
            `${formatBytes(writePos)} written so far`
        );
      }
    }

    // End marker: offset just past the last block.
    const endPos = alignUp(writePos, align);
    index[numBlocks] = Math.floor(endPos / Math.pow(2, align)) >>> 0;

    // Write the header.
    const header = Buffer.alloc(HEADER_SIZE);
    header.writeUInt32LE(ZISO_MAGIC, 0x00);
    header.writeUInt32LE(HEADER_SIZE, 0x04);
    header.writeBigUInt64LE(BigInt(totalBytes), 0x08);
    header.writeUInt32LE(BLOCK_SIZE, 0x10);
    header.writeUInt8(VERSION, 0x14);
    header.writeUInt8(align, 0x15);
    await output.write(header, 0, HEADER_SIZE, 0);

    // Write the index.
    const indexBuf = Buffer.from(
      index.buffer,
      index.byteOffset,
      index.byteLength
    );
    await output.write(indexBuf, 0, indexBuf.length, HEADER_SIZE);

    const compressedBytes = (await output.stat()).size;

    // Close the output handle before deleting the source so the new file is
    // fully flushed and we never remove the original on a failed write.
    await output.close();
    output = null;
    await input.close();
    input = null;

    if (deleteOriginal) {
      await fs.unlink(isoPath);
      log.verbose(`Deleted source ISO after successful compression: ${isoPath}`);
    }

    if (onProgress) onProgress(100, "ZSO complete");

    const ratio = ((compressedBytes / totalBytes) * 100).toFixed(1);
    log.info(
      `ZSO complete: ${formatBytes(totalBytes)} → ${formatBytes(compressedBytes)} ` +
        `(${ratio}% of original, saved ${formatBytes(totalBytes - compressedBytes)})`
    );

    return {
      success: true,
      zsoPath,
      originalBytes: totalBytes,
      compressedBytes,
    };
  } catch (err: any) {
    log.error(`ZSO compression failed for ${isoPath}:`, err?.message || err);
    return { success: false, message: err?.message || String(err) };
  } finally {
    await input?.close().catch(() => {});
    await output?.close().catch(() => {});
  }
}

/**
 * Decompresses a single raw LZ4 block, stopping once `dstLen` output bytes have
 * been produced rather than when the input is exhausted. ZISO aligns blocks on
 * 2^align boundaries, so the bytes between a block's compressed payload and the
 * next block are padding — relying on input exhaustion (as lz4js.decompressBlock
 * does) would misread that padding as more LZ4 sequences. Each ZISO block
 * decompresses to a known fixed size, so bounding on output is exact and safe.
 */
function decompressLz4BlockBounded(
  src: Buffer,
  dst: Buffer,
  dstLen: number
): void {
  const MIN_MATCH = 4;
  let s = 0;
  let d = 0;

  while (d < dstLen) {
    const token = src[s++];

    let literalCount = token >> 4;
    if (literalCount === 0xf) {
      let b: number;
      do {
        b = src[s++];
        literalCount += b;
      } while (b === 0xff);
    }
    for (let i = 0; i < literalCount; i++) {
      dst[d++] = src[s++];
    }

    if (d >= dstLen) break;

    const mOffset = src[s++] | (src[s++] << 8);

    let matchLength = token & 0xf;
    if (matchLength === 0xf) {
      let b: number;
      do {
        b = src[s++];
        matchLength += b;
      } while (b === 0xff);
    }
    matchLength += MIN_MATCH;

    let matchPos = d - mOffset;
    for (let i = 0; i < matchLength && d < dstLen; i++) {
      dst[d++] = dst[matchPos++];
    }
  }
}

export interface ZsoStreamResult {
  success: boolean;
  message?: string;
}

/**
 * Streams the decompressed contents of a ZSO (ZISO) image to `onData`, block by
 * block in order. Return `true` from `onData` to stop early — used to scan a
 * compressed image for its embedded game ID without inflating the whole disc.
 * `maxBytes` caps how much is decompressed before giving up (a safety bound for
 * images where the sought data is never found; real PS2 discs carry the ID in
 * the root directory, well within the first megabyte).
 */
export async function streamZsoContents(
  filepath: string,
  onData: (chunk: Buffer) => boolean | void,
  maxBytes: number = Number.POSITIVE_INFINITY
): Promise<ZsoStreamResult> {
  let handle: fs.FileHandle | null = null;

  try {
    handle = await fs.open(filepath, "r");

    const header = Buffer.alloc(HEADER_SIZE);
    await handle.read(header, 0, HEADER_SIZE, 0);
    if (header.readUInt32LE(0x00) !== ZISO_MAGIC) {
      log.verbose(`Not a ZISO image (bad magic): ${filepath}`);
      return { success: false, message: "Not a ZSO (ZISO) image." };
    }

    const headerSize = header.readUInt32LE(0x04);
    const totalBytes = Number(header.readBigUInt64LE(0x08));
    const blockSize = header.readUInt32LE(0x10);
    const align = header.readUInt8(0x15);

    if (!blockSize || !totalBytes) {
      log.error(`Malformed ZISO header in ${filepath}`);
      return { success: false, message: "ZSO header is malformed." };
    }

    const numBlocks = Math.ceil(totalBytes / blockSize);
    log.verbose(
      `Streaming ZISO ${filepath}: ${formatBytes(totalBytes)} uncompressed, ` +
        `${numBlocks} blocks of ${blockSize}B, align=${align}` +
        (Number.isFinite(maxBytes) ? `, cap ${formatBytes(maxBytes)}` : "")
    );
    const indexSize = (numBlocks + 1) * 4;
    const indexBuf = Buffer.alloc(indexSize);
    await handle.read(indexBuf, 0, indexSize, headerSize);

    const unit = Math.pow(2, align);
    const srcBuf = Buffer.alloc(blockSize + unit + 16);
    const dstBuf = Buffer.alloc(blockSize);
    let produced = 0;

    for (let i = 0; i < numBlocks; i++) {
      const rawEntry = indexBuf.readUInt32LE(i * 4) >>> 0;
      const rawNext = indexBuf.readUInt32LE((i + 1) * 4) >>> 0;
      const isCompressed = (rawEntry & NOT_COMPRESSED) === 0;
      const offset = (rawEntry & 0x7fffffff) * unit;
      const nextOffset = (rawNext & 0x7fffffff) * unit;
      const readLen = nextOffset - offset;
      if (readLen <= 0) continue;

      const cappedLen = Math.min(readLen, srcBuf.length);
      await handle.read(srcBuf, 0, cappedLen, offset);

      const outLen = Math.min(blockSize, totalBytes - produced);
      let chunk: Buffer;
      if (isCompressed) {
        decompressLz4BlockBounded(srcBuf, dstBuf, outLen);
        chunk = dstBuf.subarray(0, outLen);
      } else {
        chunk = srcBuf.subarray(0, outLen);
      }
      produced += outLen;

      if (onData(chunk) === true) {
        return { success: true };
      }
      if (produced >= maxBytes) {
        return { success: true };
      }
    }

    return { success: true };
  } catch (err: any) {
    log.error(`Failed while streaming ZISO ${filepath}:`, err?.message || err);
    return { success: false, message: err?.message || String(err) };
  } finally {
    await handle?.close().catch(() => {});
  }
}
