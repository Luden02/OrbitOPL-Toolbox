import * as fs from "fs/promises";
import * as fsSync from "fs";
import path from "path";
import { mergeMultiBin } from "./binmerge";
import { convertToVcd } from "./cue2pops";
import { parseCueSheet, getCueDirectory } from "./cue-parser";
import {
  tryDeterminePs1GameIdFromHex,
  downloadArtByGameId,
  sanitizeGameFilename,
} from "./library.service";

export interface ImportPs1Result {
  success: boolean;
  message?: string;
  vcdPath?: string;
  gameId?: string;
  gameName?: string;
}

export async function importPs1Game(
  cueFilePath: string,
  oplRoot: string,
  updateConfApps: boolean,
  downloadArtwork: boolean,
  onProgress?: (percent: number, stage: string) => void
): Promise<ImportPs1Result> {
  try {
    const popsDir = path.join(oplRoot, "POPS");
    const artDir = path.join(oplRoot, "ART");

    // Ensure POPS directory exists
    await fs.mkdir(popsDir, { recursive: true });
    await fs.mkdir(artDir, { recursive: true });

    if (onProgress) onProgress(0, "Parsing CUE sheet");

    // Step 1: Check if multi-BIN and merge if needed
    const cueSheet = await parseCueSheet(cueFilePath);
    let binPath: string;
    let cuePath: string;
    let tempDir: string | null = null;

    if (cueSheet.files.length > 1) {
      if (onProgress) onProgress(5, "Merging multi-BIN files");

      // Create temp directory for merged output
      tempDir = path.join(popsDir, `.tmp_merge_${Date.now()}`);
      await fs.mkdir(tempDir, { recursive: true });

      const mergeResult = await mergeMultiBin(
        cueFilePath,
        tempDir,
        onProgress
      );
      binPath = mergeResult.mergedBinPath;
      cuePath = mergeResult.mergedCuePath;
    } else {
      binPath = path.join(getCueDirectory(cueFilePath), cueSheet.files[0].filename);
      cuePath = cueFilePath;
    }

    // Step 2: Determine game ID from BIN
    if (onProgress) onProgress(30, "Detecting PS1 game ID");

    const idResult = await tryDeterminePs1GameIdFromHex(binPath);
    if (!idResult.success || !("gameId" in idResult)) {
      return {
        success: false,
        message: idResult.message || "Could not determine PS1 game ID from the disc image.",
      };
    }

    const gameId = idResult.gameId;
    const gameName = idResult.gameName || "Unknown";

    // Step 3: Convert BIN/CUE to VCD
    if (onProgress) onProgress(35, "Converting to VCD format");

    const sanitizedName = sanitizeGameFilename(gameName);
    const vcdFilename = `${gameId}.${sanitizedName}.VCD`;
    const vcdPath = path.join(popsDir, vcdFilename);

    await convertToVcd(binPath, cuePath, vcdPath, (percent, stage) => {
      if (onProgress) {
        // Map the 0-100 range from convertToVcd to 35-85 of our overall progress
        const mappedPercent = 35 + Math.round(percent * 0.5);
        onProgress(mappedPercent, stage);
      }
    });

    // Step 4: Clean up temp directory if we created one
    if (tempDir) {
      try {
        await fs.rm(tempDir, { recursive: true, force: true });
      } catch {
        // Non-critical cleanup failure
      }
    }

    // Step 5: Update conf_apps.cfg if requested
    if (updateConfApps) {
      if (onProgress) onProgress(88, "Updating conf_apps.cfg");
      await updateConfAppsCfg(oplRoot, vcdFilename, gameName);
    }

    // Step 6: Download artwork
    if (downloadArtwork) {
      if (onProgress) onProgress(92, "Downloading artwork");
      try {
        await downloadArtByGameId(artDir, gameId, "PS1");
      } catch {
        // Art download failure is non-critical
      }
    }

    if (onProgress) onProgress(100, "Import complete");

    return {
      success: true,
      vcdPath,
      gameId,
      gameName,
    };
  } catch (err: any) {
    return {
      success: false,
      message: err?.message || String(err),
    };
  }
}

async function updateConfAppsCfg(
  oplRoot: string,
  vcdFilename: string,
  gameTitle: string
): Promise<void> {
  const cfgPath = path.join(oplRoot, "conf_apps.cfg");

  // The entry format expected by OPL POPS
  const entry = `${vcdFilename}=${gameTitle}`;

  try {
    let content = "";
    try {
      content = await fs.readFile(cfgPath, "utf-8");
    } catch {
      // File doesn't exist, start fresh
    }

    // Check if entry already exists
    const lines = content.split(/\r?\n/);
    const existingIndex = lines.findIndex((line) =>
      line.startsWith(vcdFilename + "=")
    );

    if (existingIndex >= 0) {
      lines[existingIndex] = entry;
    } else {
      // Add to end, ensure there's a newline before
      if (content.length > 0 && !content.endsWith("\n")) {
        lines.push("");
      }
      lines.push(entry);
    }

    await fs.writeFile(cfgPath, lines.join("\n"), "utf-8");
  } catch (err: any) {
    console.error("Failed to update conf_apps.cfg:", err?.message);
  }
}
