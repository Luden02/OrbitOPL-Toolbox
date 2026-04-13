import * as fs from "fs/promises";
import path from "path";
import { mergeMultiBin } from "./binmerge";
import { parseCueSheet, getCueDirectory } from "./cue-parser";
import {
  tryDetermineGameIdFromHex,
  downloadArtByGameId,
  sanitizeGameFilename,
} from "./library.service";

export interface ImportPs2CdResult {
  success: boolean;
  message?: string;
  isoPath?: string;
  gameId?: string;
  gameName?: string;
}

const RAW_SECTOR_SIZE = 2352;
const ISO_SECTOR_SIZE = 2048;
const COPY_BUFFER_BYTES = 64 * RAW_SECTOR_SIZE; // ~150 KB chunks of whole sectors

/**
 * Determine the byte offset within a 2352-byte raw sector where the 2048-byte
 * user data begins. Different track modes lay sectors out differently.
 */
function userDataOffsetForTrackType(trackType: string): number | null {
  const t = trackType.toUpperCase();
  if (t.startsWith("MODE1/2048")) return 0; // already cooked, just copy
  if (t.startsWith("MODE1/2352")) return 16; // sync(12) + header(4)
  if (t.startsWith("MODE2/2352")) return 24; // sync(12) + header(4) + subheader(8) — assumes Form1
  if (t.startsWith("MODE2/2336")) return 8; // subheader(8)
  return null;
}

/**
 * Convert a raw BIN (CD image) of the first data track into a 2048 byte/sector ISO.
 * Reads in whole-sector chunks, extracts the 2048 user-data bytes, writes them to disk.
 */
async function binToIso(
  binPath: string,
  isoPath: string,
  trackType: string,
  onProgress?: (percent: number) => void
): Promise<void> {
  const offset = userDataOffsetForTrackType(trackType);
  if (offset === null) {
    throw new Error(`Unsupported track type for ISO conversion: ${trackType}`);
  }

  // MODE1/2048 is already a cooked ISO — fast path
  if (offset === 0 && trackType.toUpperCase().startsWith("MODE1/2048")) {
    await fs.copyFile(binPath, isoPath);
    if (onProgress) onProgress(100);
    return;
  }

  const stat = await fs.stat(binPath);
  const totalSectors = Math.floor(stat.size / RAW_SECTOR_SIZE);
  if (totalSectors === 0) {
    throw new Error("BIN file is empty or smaller than one sector.");
  }

  const inHandle = await fs.open(binPath, "r");
  const outHandle = await fs.open(isoPath, "w");

  try {
    const readBuffer = Buffer.alloc(COPY_BUFFER_BYTES);
    const sectorsPerChunk = Math.floor(COPY_BUFFER_BYTES / RAW_SECTOR_SIZE);
    const writeBuffer = Buffer.alloc(sectorsPerChunk * ISO_SECTOR_SIZE);

    let position = 0;
    let processedSectors = 0;
    let lastReportedPercent = -1;

    while (position < stat.size) {
      const bytesToRead = Math.min(COPY_BUFFER_BYTES, stat.size - position);
      const wholeSectors = Math.floor(bytesToRead / RAW_SECTOR_SIZE);
      if (wholeSectors === 0) break;

      const { bytesRead } = await inHandle.read(
        readBuffer,
        0,
        wholeSectors * RAW_SECTOR_SIZE,
        position
      );
      if (bytesRead === 0) break;

      const sectorsRead = Math.floor(bytesRead / RAW_SECTOR_SIZE);
      for (let i = 0; i < sectorsRead; i++) {
        readBuffer.copy(
          writeBuffer,
          i * ISO_SECTOR_SIZE,
          i * RAW_SECTOR_SIZE + offset,
          i * RAW_SECTOR_SIZE + offset + ISO_SECTOR_SIZE
        );
      }

      await outHandle.write(writeBuffer, 0, sectorsRead * ISO_SECTOR_SIZE);

      position += sectorsRead * RAW_SECTOR_SIZE;
      processedSectors += sectorsRead;

      if (onProgress) {
        const percent = Math.floor((processedSectors / totalSectors) * 100);
        if (percent !== lastReportedPercent) {
          onProgress(percent);
          lastReportedPercent = percent;
        }
      }
    }
  } finally {
    await inHandle.close();
    await outHandle.close();
  }
}

export async function importPs2CdGame(
  cueFilePath: string,
  oplRoot: string,
  overrideGameId: string | undefined,
  overrideGameName: string | undefined,
  downloadArtwork: boolean,
  onProgress?: (percent: number, stage: string) => void
): Promise<ImportPs2CdResult> {
  let tempDir: string | null = null;

  try {
    const cdDir = path.join(oplRoot, "CD");
    const artDir = path.join(oplRoot, "ART");
    await fs.mkdir(cdDir, { recursive: true });
    await fs.mkdir(artDir, { recursive: true });

    if (onProgress) onProgress(0, "Parsing CUE sheet");

    // Parse the original cue to find the data track type for sector extraction
    const originalCue = await parseCueSheet(cueFilePath);
    const firstDataTrack = originalCue.files
      .flatMap((f) => f.tracks)
      .find((t) => t.type.toUpperCase().startsWith("MODE"));
    if (!firstDataTrack) {
      return {
        success: false,
        message: "No data track found in CUE sheet — cannot build ISO.",
      };
    }

    // Step 1: Merge multi-bin into a single bin (no-op if already single-file)
    let binPath: string;
    if (originalCue.files.length > 1) {
      if (onProgress) onProgress(5, "Merging multi-BIN files");
      tempDir = path.join(cdDir, `.tmp_merge_${Date.now()}`);
      await fs.mkdir(tempDir, { recursive: true });
      const mergeResult = await mergeMultiBin(cueFilePath, tempDir, (p, s) => {
        if (onProgress) onProgress(5 + Math.round(p * 0.2), s);
      });
      binPath = mergeResult.mergedBinPath;
    } else {
      binPath = path.join(
        getCueDirectory(cueFilePath),
        originalCue.files[0].filename
      );
    }

    // Step 2: Resolve game ID + name (use overrides if provided, else detect)
    let gameId = overrideGameId?.trim();
    let gameName = overrideGameName?.trim();
    if (!gameId || !gameName) {
      if (onProgress) onProgress(28, "Detecting PS2 game ID");
      const idResult = await tryDetermineGameIdFromHex(binPath);
      if (!idResult.success || !("gameId" in idResult)) {
        return {
          success: false,
          message:
            idResult.message || "Could not determine PS2 game ID from BIN.",
        };
      }
      if (!gameId) gameId = idResult.gameId;
      if (!gameName) gameName = idResult.gameName || "Unknown";
    }

    const safeName = sanitizeGameFilename(gameName);
    const isoFilename = `${gameId}.${safeName}.iso`;
    const isoPath = path.join(cdDir, isoFilename);

    // Step 3: Convert BIN → ISO (extract 2048-byte user data per sector)
    if (onProgress) onProgress(30, "Converting BIN to ISO");
    await binToIso(binPath, isoPath, firstDataTrack.type, (percent) => {
      if (onProgress) {
        onProgress(30 + Math.round(percent * 0.6), "Converting BIN to ISO");
      }
    });

    // Step 4: Cleanup temp merge dir
    if (tempDir) {
      try {
        await fs.rm(tempDir, { recursive: true, force: true });
      } catch {
        // non-critical
      }
      tempDir = null;
    }

    // Step 5: Artwork
    if (downloadArtwork) {
      if (onProgress) onProgress(95, "Downloading artwork");
      try {
        await downloadArtByGameId(artDir, gameId, "PS2");
      } catch {
        // non-critical
      }
    }

    if (onProgress) onProgress(100, "Import complete");

    return {
      success: true,
      isoPath,
      gameId,
      gameName,
    };
  } catch (err: any) {
    // Best-effort cleanup of temp directory on failure
    if (tempDir) {
      try {
        await fs.rm(tempDir, { recursive: true, force: true });
      } catch {
        // ignore
      }
    }
    return {
      success: false,
      message: err?.message || String(err),
    };
  }
}

