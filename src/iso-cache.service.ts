import { app } from "electron";
import fs from "fs";
import path from "path";

/**
 * Persistent cache of resolved game IDs for prefix-less ("new OPL convention")
 * ISO files. Each ISO is hex-scanned at most once across runs — entries are
 * keyed by absolute path AND validated against size + mtime, so renamed,
 * replaced, or modified files automatically miss and get re-scanned.
 */

interface CacheEntry {
  gameId: string;
  gameName?: string;
  size: number;
  mtimeMs: number;
}

type CacheFile = Record<string, CacheEntry>;

function cachePath(): string {
  return path.join(app.getPath("userData"), "iso-gameid-cache.json");
}

function readAll(): CacheFile {
  try {
    return JSON.parse(fs.readFileSync(cachePath(), "utf-8")) as CacheFile;
  } catch {
    return {};
  }
}

function writeAll(data: CacheFile): void {
  try {
    fs.writeFileSync(cachePath(), JSON.stringify(data));
  } catch (error) {
    console.error("Failed to persist ISO ID cache:", error);
  }
}

export function getCachedGameId(
  absPath: string,
  size: number,
  mtimeMs: number
): { gameId: string; gameName?: string } | undefined {
  const entry = readAll()[absPath];
  if (!entry) return undefined;
  // mtime in JS is float; compare with small tolerance to survive FS quantisation.
  if (entry.size !== size || Math.abs(entry.mtimeMs - mtimeMs) > 1) {
    return undefined;
  }
  return { gameId: entry.gameId, gameName: entry.gameName };
}

export function setCachedGameId(
  absPath: string,
  size: number,
  mtimeMs: number,
  gameId: string,
  gameName?: string
): void {
  const data = readAll();
  data[absPath] = { gameId, gameName, size, mtimeMs };
  writeAll(data);
}
