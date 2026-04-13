import * as fs from "fs/promises";
import * as fsSync from "fs";
import path from "path";
import {
  parseCueSheet,
  msfToSectors,
  sectorsToMsf,
  CueSheet,
  CueTrack,
} from "./cue-parser";

const SECTOR_SIZE = 2352;
const HEADER_SIZE = 1048576; // 1 MB = 0x100000
const SIGNATURE = Buffer.from([0x6b, 0x48, 0x6e, 0x20]); // "kHn "

function toBcd(value: number): number {
  return Math.floor(value / 10) * 16 + (value % 10);
}

function isDataTrack(track: CueTrack): boolean {
  return track.type.startsWith("MODE");
}

function trackTypeByte(track: CueTrack): number {
  return isDataTrack(track) ? 0x41 : 0x01;
}

interface MsfBcd {
  mm: number;
  ss: number;
  ff: number;
}

function addSeconds(
  mm: number,
  ss: number,
  ff: number,
  addSec: number
): { mm: number; ss: number; ff: number } {
  const totalFrames = mm * 60 * 75 + ss * 75 + ff + addSec * 75;
  return {
    mm: Math.floor(totalFrames / (60 * 75)),
    ss: Math.floor((totalFrames % (60 * 75)) / 75),
    ff: totalFrames % 75,
  };
}

function buildHeader(cueSheet: CueSheet, binSize: number): Buffer {
  const header = Buffer.alloc(HEADER_SIZE, 0);

  const allTracks: CueTrack[] = [];
  for (const file of cueSheet.files) {
    allTracks.push(...file.tracks);
  }

  const trackCount = allTracks.length;
  const firstTrack = allTracks[0];
  const lastTrack = allTracks[trackCount - 1];
  const lastTrackType = trackTypeByte(lastTrack);

  // Count pregaps and postgaps
  let pregapCount = 0;
  let postgapCount = 0;
  for (const track of allTracks) {
    if (track.pregap) pregapCount++;
    if (track.postgap) postgapCount++;
  }

  // Calculate sector count and lead-out
  const sectorCount =
    Math.floor(binSize / SECTOR_SIZE) +
    150 * (pregapCount + postgapCount);
  const leadOutSectors = sectorCount + 150;
  const leadOut = sectorsToMsf(leadOutSectors);

  // Detect CDRWIN-style CUE (exactly 1 pregap, 0 postgap)
  const isCdrwin = pregapCount === 1 && postgapCount === 0;

  // --- Descriptor A0 (bytes 0-9): Disc Type ---
  header[0] = trackTypeByte(firstTrack);
  header[1] = 0x00;
  header[2] = 0xa0;
  header[3] = 0x00;
  header[4] = 0x00;
  header[5] = 0x00;
  header[6] = 0x00;
  header[7] = 0x01; // first track number
  header[8] = 0x20; // CD-XA
  header[9] = 0x00;

  // --- Descriptor A1 (bytes 10-19): Content ---
  header[10] = lastTrackType;
  header[11] = 0x00;
  header[12] = 0xa1;
  header[13] = 0x00;
  header[14] = 0x00;
  header[15] = 0x00;
  header[16] = 0x00;
  header[17] = toBcd(trackCount);
  header[18] = 0x00;
  header[19] = 0x00;

  // --- Descriptor A2 (bytes 20-29): Lead-Out ---
  header[20] = lastTrackType;
  header[21] = 0x00;
  header[22] = 0xa2;
  header[23] = 0x00;
  header[24] = 0x00;
  header[25] = 0x00;
  header[26] = 0x00;
  header[27] = toBcd(leadOut.minutes);
  header[28] = toBcd(leadOut.seconds);
  header[29] = toBcd(leadOut.frames);

  // --- Track entries (starting at byte 30, 10 bytes each) ---
  for (let i = 0; i < allTracks.length; i++) {
    const track = allTracks[i];
    const offset = 30 + i * 10;
    const type = trackTypeByte(track);

    // Find INDEX 00 and INDEX 01
    const idx00 = track.indexes.find((idx) => idx.number === 0);
    const idx01 = track.indexes.find((idx) => idx.number === 1);

    let i00mm = idx00?.minutes ?? 0;
    let i00ss = idx00?.seconds ?? 0;
    let i00ff = idx00?.frames ?? 0;
    let i01mm = idx01?.minutes ?? 0;
    let i01ss = idx01?.seconds ?? 0;
    let i01ff = idx01?.frames ?? 0;

    // Apply +2 second adjustment
    if (i === 0) {
      // Track 1: only adjust INDEX 01
      const adj01 = addSeconds(i01mm, i01ss, i01ff, 2);
      i01mm = adj01.mm;
      i01ss = adj01.ss;
      i01ff = adj01.ff;
    } else {
      // Other tracks: adjust both INDEX 00 and INDEX 01
      const addSec = isCdrwin ? 4 : 2;
      const adj00 = addSeconds(i00mm, i00ss, i00ff, addSec);
      i00mm = adj00.mm;
      i00ss = adj00.ss;
      i00ff = adj00.ff;
      const adj01 = addSeconds(i01mm, i01ss, i01ff, addSec);
      i01mm = adj01.mm;
      i01ss = adj01.ss;
      i01ff = adj01.ff;
    }

    header[offset + 0] = type;
    header[offset + 1] = 0x00;
    header[offset + 2] = toBcd(track.number);
    header[offset + 3] = toBcd(i00mm);
    header[offset + 4] = toBcd(i00ss);
    header[offset + 5] = toBcd(i00ff);
    header[offset + 6] = 0x00;
    header[offset + 7] = toBcd(i01mm);
    header[offset + 8] = toBcd(i01ss);
    header[offset + 9] = toBcd(i01ff);
  }

  // --- Signature at byte 1024 ---
  SIGNATURE.copy(header, 1024);

  // --- Sector count at bytes 1032 and 1036 (LE uint32) ---
  header.writeUInt32LE(sectorCount, 1032);
  header.writeUInt32LE(sectorCount, 1036);

  return header;
}

export async function convertToVcd(
  binPath: string,
  cuePath: string,
  outputVcdPath: string,
  onProgress?: (percent: number, stage: string) => void
): Promise<void> {
  const cueSheet = await parseCueSheet(cuePath);

  // Verify single-file CUE
  if (cueSheet.files.length !== 1) {
    throw new Error(
      "CUE must reference a single BIN file. Use binmerge first for multi-BIN CUEs."
    );
  }

  const binStat = await fs.stat(binPath);
  const binSize = binStat.size;

  if (onProgress) onProgress(5, "Building VCD header");

  // Build header
  const header = buildHeader(cueSheet, binSize);

  // Check CDRWIN-style and whether we need gap insertion
  const allTracks: CueTrack[] = [];
  for (const file of cueSheet.files) {
    allTracks.push(...file.tracks);
  }

  let pregapCount = 0;
  let postgapCount = 0;
  for (const track of allTracks) {
    if (track.pregap) pregapCount++;
    if (track.postgap) postgapCount++;
  }
  const isCdrwin = pregapCount === 1 && postgapCount === 0;

  // Find gap insertion point for CDRWIN fix
  let gapInsertOffset = -1;
  if (isCdrwin && allTracks.length > 1) {
    // Insert 150 sectors of zeros between data track and first audio track
    const firstAudioTrack = allTracks.find((t) => !isDataTrack(t));
    if (firstAudioTrack) {
      const idx01 = firstAudioTrack.indexes.find((idx) => idx.number === 1);
      if (idx01) {
        const sectors = msfToSectors(idx01.minutes, idx01.seconds, idx01.frames);
        gapInsertOffset = sectors * SECTOR_SIZE;
      }
    }
  }

  if (onProgress) onProgress(10, "Writing VCD file");

  // Write output: header + BIN data (with optional gap insertion)
  const writeStream = fsSync.createWriteStream(outputVcdPath);

  // Write header
  await new Promise<void>((resolve, reject) => {
    writeStream.write(header, (err) => {
      if (err) reject(err);
      else resolve();
    });
  });

  // Stream BIN data
  const totalBytes = binSize;
  let writtenBytes = 0;

  if (gapInsertOffset > 0 && gapInsertOffset < binSize) {
    // CDRWIN fix: insert 150 sectors of zeros at the gap point
    const gapSize = 150 * SECTOR_SIZE; // 352800 bytes

    // Write first part of BIN
    await new Promise<void>((resolve, reject) => {
      const part1 = fsSync.createReadStream(binPath, {
        start: 0,
        end: gapInsertOffset - 1,
      });
      part1.on("data", (chunk: Buffer) => {
        writtenBytes += chunk.length;
        if (onProgress) {
          onProgress(
            10 + Math.round((writtenBytes / totalBytes) * 85),
            "Writing VCD data"
          );
        }
      });
      part1.on("error", reject);
      part1.on("end", resolve);
      part1.pipe(writeStream, { end: false });
    });

    // Write gap (zeros)
    const gapBuffer = Buffer.alloc(gapSize, 0);
    await new Promise<void>((resolve, reject) => {
      writeStream.write(gapBuffer, (err) => {
        if (err) reject(err);
        else resolve();
      });
    });

    // Write remaining BIN data
    await new Promise<void>((resolve, reject) => {
      const part2 = fsSync.createReadStream(binPath, {
        start: gapInsertOffset,
      });
      part2.on("data", (chunk: Buffer) => {
        writtenBytes += chunk.length;
        if (onProgress) {
          onProgress(
            10 + Math.round((writtenBytes / totalBytes) * 85),
            "Writing VCD data"
          );
        }
      });
      part2.on("error", reject);
      part2.on("end", resolve);
      part2.pipe(writeStream, { end: false });
    });
  } else {
    // Standard: just stream the whole BIN
    await new Promise<void>((resolve, reject) => {
      const readStream = fsSync.createReadStream(binPath);
      readStream.on("data", (chunk: Buffer) => {
        writtenBytes += chunk.length;
        if (onProgress) {
          onProgress(
            10 + Math.round((writtenBytes / totalBytes) * 85),
            "Writing VCD data"
          );
        }
      });
      readStream.on("error", reject);
      readStream.on("end", resolve);
      readStream.pipe(writeStream, { end: false });
    });
  }

  writeStream.end();
  await new Promise<void>((resolve, reject) => {
    writeStream.on("finish", resolve);
    writeStream.on("error", reject);
  });

  if (onProgress) onProgress(100, "Conversion complete");
}
