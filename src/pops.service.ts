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

const POPSTARTER_ELF_CANDIDATE_PATHS = [
  path.resolve(__dirname, "../assets/POPSTARTER.ELF"),
  path.resolve(__dirname, "../../assets/POPSTARTER.ELF"),
  path.resolve(process.cwd(), "assets/POPSTARTER.ELF"),
];

async function findPopstarterElf(): Promise<string | null> {
  for (const candidate of POPSTARTER_ELF_CANDIDATE_PATHS) {
    try {
      await fs.access(candidate);
      return candidate;
    } catch {
      // Try next candidate
    }
  }
  return null;
}

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
  elfPrefix: string,
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

    // Step 5: Copy POPStarter ELF with XX. prefix
    if (onProgress) onProgress(86, "Setting up Popstarter launcher");

    const popstarterElf = await findPopstarterElf();
    if (!popstarterElf) {
      return {
        success: false,
        message:
          "POPSTARTER.ELF not found in assets. Please place the Popstarter ELF file at assets/POPSTARTER.ELF.",
      };
    }

    const vcdBasename = vcdFilename.replace(/\.VCD$/i, "");
    const elfFilename = elfPrefix
      ? `${elfPrefix}${vcdBasename}.ELF`
      : `${vcdBasename}.ELF`;
    const appsFolderName = `POPS_${sanitizedName}`;
    const appsGameDir = path.join(oplRoot, "APPS", appsFolderName);
    await fs.mkdir(appsGameDir, { recursive: true });
    await fs.copyFile(popstarterElf, path.join(appsGameDir, elfFilename));
    await fs.writeFile(
      path.join(appsGameDir, "title.cfg"),
      `title=${gameName}\nboot=${elfFilename}\n`,
      "utf-8"
    );

    // Step 7: Download artwork
    if (downloadArtwork) {
      if (onProgress) onProgress(93, "Downloading artwork");
      try {
        await downloadArtByGameId(artDir, gameId, "PS1", vcdBasename);
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

