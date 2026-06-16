import * as fs from "fs/promises";
import path from "path";
import { createLogger } from "./logger";

const log = createLogger("cfg");

/**
 * Per-game OPL config files (`CFG/<GAMEID>.cfg`).
 *
 * The format is one `KEY=VALUE` pair per line with CRLF endings. Keys carry
 * their sigil as part of the name, e.g. `#Name` (display title), `$Compatibility`
 * (mode bitmask), `$DMA`, `$VMC_0`. We read/write the whole map and never drop
 * keys we don't understand, so settings written by OPL itself (or other tools)
 * survive an edit here.
 */

export type GameCfg = Record<string, string>;

function cfgPath(oplRoot: string, gameId: string): string {
  return path.join(oplRoot, "CFG", `${gameId}.cfg`);
}

export async function readGameCfg(
  oplRoot: string,
  gameId: string
): Promise<{ success: boolean; entries: GameCfg; message?: string }> {
  try {
    const raw = await fs.readFile(cfgPath(oplRoot, gameId), "utf-8");
    const entries: GameCfg = {};
    for (const line of raw.split(/\r?\n/)) {
      if (!line) continue;
      const eq = line.indexOf("=");
      if (eq <= 0) continue;
      const key = line.slice(0, eq);
      entries[key] = line.slice(eq + 1);
    }
    log.verbose(`Read CFG for ${gameId}: ${Object.keys(entries).length} key(s)`);
    return { success: true, entries };
  } catch (err: any) {
    // A missing file simply means "no config yet" — not an error.
    if (err?.code === "ENOENT") {
      log.verbose(`No CFG file for ${gameId} yet`);
      return { success: true, entries: {} };
    }
    log.error(`Failed to read CFG for ${gameId}:`, err?.message || err);
    return { success: false, entries: {}, message: err?.message || String(err) };
  }
}

export async function writeGameCfg(
  oplRoot: string,
  gameId: string,
  entries: GameCfg
): Promise<{ success: boolean; message?: string }> {
  try {
    const target = cfgPath(oplRoot, gameId);
    const keys = Object.keys(entries);

    // An empty config is equivalent to no config — remove the file.
    if (keys.length === 0) {
      await fs.rm(target, { force: true });
      log.info(`Cleared CFG for ${gameId} (no keys left — file removed)`);
      return { success: true };
    }

    await fs.mkdir(path.dirname(target), { recursive: true });
    const body = keys.map((k) => `${k}=${entries[k]}`).join("\r\n") + "\r\n";
    await fs.writeFile(target, body, "utf-8");
    log.info(`Wrote CFG for ${gameId}: ${keys.length} key(s) [${keys.join(", ")}]`);
    return { success: true };
  } catch (err: any) {
    log.error(`Failed to write CFG for ${gameId}:`, err?.message || err);
    return { success: false, message: err?.message || String(err) };
  }
}
