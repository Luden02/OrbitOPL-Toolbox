import * as fs from "fs/promises";
import path from "path";

export interface CueIndex {
  number: number; // 0 or 1
  minutes: number;
  seconds: number;
  frames: number;
}

export interface CueTrack {
  number: number;
  type: string; // e.g., "MODE2/2352", "AUDIO"
  indexes: CueIndex[];
  pregap?: { minutes: number; seconds: number; frames: number };
  postgap?: { minutes: number; seconds: number; frames: number };
}

export interface CueFile {
  filename: string;
  filetype: string; // e.g., "BINARY"
  tracks: CueTrack[];
}

export interface CueSheet {
  files: CueFile[];
}

function parseMsf(msfStr: string): {
  minutes: number;
  seconds: number;
  frames: number;
} {
  const parts = msfStr.split(":");
  return {
    minutes: parseInt(parts[0], 10),
    seconds: parseInt(parts[1], 10),
    frames: parseInt(parts[2], 10),
  };
}

export function msfToSectors(
  minutes: number,
  seconds: number,
  frames: number
): number {
  return minutes * 60 * 75 + seconds * 75 + frames;
}

export function sectorsToMsf(sectors: number): {
  minutes: number;
  seconds: number;
  frames: number;
} {
  const minutes = Math.floor(sectors / 4500);
  const seconds = Math.floor((sectors % 4500) / 75);
  const frames = sectors % 75;
  return { minutes, seconds, frames };
}

export async function parseCueSheet(cueFilePath: string): Promise<CueSheet> {
  const content = await fs.readFile(cueFilePath, "utf-8");
  const lines = content.split(/\r?\n/);

  const cueSheet: CueSheet = { files: [] };
  let currentFile: CueFile | null = null;
  let currentTrack: CueTrack | null = null;

  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line) continue;

    if (line.startsWith("FILE ")) {
      // FILE "filename.bin" BINARY
      const match = line.match(/^FILE\s+"([^"]+)"\s+(\S+)/);
      if (!match) continue;

      if (currentTrack && currentFile) {
        currentFile.tracks.push(currentTrack);
        currentTrack = null;
      }

      currentFile = {
        filename: match[1],
        filetype: match[2],
        tracks: [],
      };
      cueSheet.files.push(currentFile);
    } else if (line.startsWith("TRACK ")) {
      // TRACK 01 MODE2/2352
      const match = line.match(/^TRACK\s+(\d+)\s+(.+)/);
      if (!match || !currentFile) continue;

      if (currentTrack) {
        currentFile.tracks.push(currentTrack);
      }

      currentTrack = {
        number: parseInt(match[1], 10),
        type: match[2].trim(),
        indexes: [],
      };
    } else if (line.startsWith("INDEX ")) {
      // INDEX 01 00:00:00
      const match = line.match(/^INDEX\s+(\d+)\s+(\d+:\d+:\d+)/);
      if (!match || !currentTrack) continue;

      const msf = parseMsf(match[2]);
      currentTrack.indexes.push({
        number: parseInt(match[1], 10),
        ...msf,
      });
    } else if (line.startsWith("PREGAP ")) {
      const match = line.match(/^PREGAP\s+(\d+:\d+:\d+)/);
      if (!match || !currentTrack) continue;
      currentTrack.pregap = parseMsf(match[1]);
    } else if (line.startsWith("POSTGAP ")) {
      const match = line.match(/^POSTGAP\s+(\d+:\d+:\d+)/);
      if (!match || !currentTrack) continue;
      currentTrack.postgap = parseMsf(match[1]);
    }
    // REM and other directives are ignored
  }

  // Push the last track
  if (currentTrack && currentFile) {
    currentFile.tracks.push(currentTrack);
  }

  return cueSheet;
}

export function getBlockSize(trackType: string): number {
  if (trackType.startsWith("MODE1/2048")) return 2048;
  if (trackType.startsWith("MODE1/2352")) return 2352;
  if (trackType.startsWith("MODE2/2352")) return 2352;
  if (trackType === "AUDIO") return 2352;
  return 2352; // default
}

export function getCueDirectory(cueFilePath: string): string {
  return path.dirname(cueFilePath);
}
