import * as fs from "fs/promises";
import * as fsSync from "fs";
import path from "path";
import {
  parseCueSheet,
  getBlockSize,
  getCueDirectory,
  msfToSectors,
  sectorsToMsf,
  CueSheet,
} from "./cue-parser";

export interface MergeResult {
  mergedBinPath: string;
  mergedCuePath: string;
  cueSheet: CueSheet;
}

export async function mergeMultiBin(
  cueFilePath: string,
  outputDir: string,
  onProgress?: (percent: number, stage: string) => void
): Promise<MergeResult> {
  const cueSheet = await parseCueSheet(cueFilePath);
  const cueDir = getCueDirectory(cueFilePath);

  // Single-file CUE: no merge needed
  if (cueSheet.files.length <= 1) {
    const binPath = path.join(cueDir, cueSheet.files[0].filename);
    return {
      mergedBinPath: binPath,
      mergedCuePath: cueFilePath,
      cueSheet,
    };
  }

  // Determine block size from first track
  const firstTrackType = cueSheet.files[0].tracks[0]?.type || "MODE2/2352";
  const blockSize = getBlockSize(firstTrackType);

  const baseName = path.parse(cueFilePath).name;
  const mergedBinPath = path.join(outputDir, `${baseName}.bin`);
  const mergedCuePath = path.join(outputDir, `${baseName}.cue`);

  // Concatenate all BIN files
  const writeStream = fsSync.createWriteStream(mergedBinPath);
  let cumulativeOffset = 0;
  const fileOffsets: number[] = [];

  // Calculate total size for progress
  let totalSize = 0;
  for (const file of cueSheet.files) {
    const binPath = path.join(cueDir, file.filename);
    const stat = await fs.stat(binPath);
    totalSize += stat.size;
  }

  let writtenBytes = 0;

  for (let i = 0; i < cueSheet.files.length; i++) {
    const file = cueSheet.files[i];
    const binPath = path.join(cueDir, file.filename);
    fileOffsets.push(cumulativeOffset);

    const stat = await fs.stat(binPath);
    cumulativeOffset += Math.floor(stat.size / blockSize);

    await new Promise<void>((resolve, reject) => {
      const readStream = fsSync.createReadStream(binPath);
      readStream.on("data", (chunk: Buffer) => {
        writtenBytes += chunk.length;
        if (onProgress && totalSize > 0) {
          onProgress(
            Math.round((writtenBytes / totalSize) * 100),
            `Merging BIN files (${i + 1}/${cueSheet.files.length})`
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

  // Build merged CUE with recalculated offsets
  const mergedCueSheet: CueSheet = {
    files: [
      {
        filename: path.basename(mergedBinPath),
        filetype: "BINARY",
        tracks: [],
      },
    ],
  };

  for (let i = 0; i < cueSheet.files.length; i++) {
    const file = cueSheet.files[i];
    const offsetSectors = fileOffsets[i];

    for (const track of file.tracks) {
      const newTrack = { ...track, indexes: [...track.indexes] };
      newTrack.indexes = track.indexes.map((idx) => {
        const originalSectors = msfToSectors(
          idx.minutes,
          idx.seconds,
          idx.frames
        );
        const newSectors = originalSectors + offsetSectors;
        const msf = sectorsToMsf(newSectors);
        return { number: idx.number, ...msf };
      });
      mergedCueSheet.files[0].tracks.push(newTrack);
    }
  }

  // Write the new CUE file
  let cueContent = `FILE "${path.basename(mergedBinPath)}" BINARY\r\n`;
  for (const track of mergedCueSheet.files[0].tracks) {
    cueContent += `  TRACK ${String(track.number).padStart(2, "0")} ${track.type}\r\n`;
    if (track.pregap) {
      cueContent += `    PREGAP ${formatMsf(track.pregap.minutes, track.pregap.seconds, track.pregap.frames)}\r\n`;
    }
    for (const idx of track.indexes) {
      cueContent += `    INDEX ${String(idx.number).padStart(2, "0")} ${formatMsf(idx.minutes, idx.seconds, idx.frames)}\r\n`;
    }
    if (track.postgap) {
      cueContent += `    POSTGAP ${formatMsf(track.postgap.minutes, track.postgap.seconds, track.postgap.frames)}\r\n`;
    }
  }

  await fs.writeFile(mergedCuePath, cueContent, "utf-8");

  return {
    mergedBinPath,
    mergedCuePath,
    cueSheet: mergedCueSheet,
  };
}

function formatMsf(
  minutes: number,
  seconds: number,
  frames: number
): string {
  return `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}:${String(frames).padStart(2, "0")}`;
}
