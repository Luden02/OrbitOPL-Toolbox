import * as fs from "fs/promises";
import path from "path";
import { createLogger } from "./logger";

const log = createLogger("vmc");

/**
 * Virtual Memory Card (VMC) management.
 *
 * OPL stores VMCs as raw memory-card images in `VMC/<name>.bin`. A card is
 * just a zero-filled file of the chosen size (8/16/32/64 MiB) — OPL detects an
 * unformatted image and formats it on first boot. Per-game assignment lives in
 * the game's CFG file under `$VMC_0` / `$VMC_1` (the name without extension).
 */

const MIB = 1024 * 1024;
const VALID_SIZES_MB = [8, 16, 32, 64];
const ZERO_CHUNK = Buffer.alloc(MIB); // 1 MiB of zeros, reused per write

export interface VmcInfo {
  name: string;
  sizeBytes: number;
  sizeMb: number;
}

/** Keep names filesystem- and OPL-safe. */
export function sanitizeVmcName(name: string): string {
  return name
    .trim()
    .replace(/\.bin$/i, "")
    .replace(/[^A-Za-z0-9._-]/g, "_")
    .slice(0, 32);
}

function vmcDir(oplRoot: string): string {
  return path.join(oplRoot, "VMC");
}

/**
 * Check for per-game POPStarter VMC files in POPS/<subfolder>/.
 * POPStarter stores VMCs as SLOT0.VMC / SLOT1.VMC (or .bin) inside a
 * subfolder named after the game, directly under the POPS directory at
 * the device root — NOT under VMC/POPS/.
 */
export async function checkPopsVmc(
  oplRoot: string,
  subfolder: string
): Promise<{ success: boolean; slot0: string | null; slot1: string | null }> {
  try {
    const dir = path.join(oplRoot, "POPS", subfolder);
    // Accept .VMC or .bin — both are used by POPStarter setups
    const files = await fs.readdir(dir).catch(() => []);
    const slot0 = files.find((f) => /^SLOT0\.(VMC|BIN)$/i.test(f)) ?? null;
    const slot1 = files.find((f) => /^SLOT1\.(VMC|BIN)$/i.test(f)) ?? null;
    log.verbose(`POPS VMC check for "${subfolder}": slot0="${slot0}", slot1="${slot1}" (dir=${dir})`);
    return { success: true, slot0, slot1 };
  } catch (err: any) {
    log.verbose(`POPS VMC check for "${subfolder}" failed: ${err?.message || err}`);
    return { success: false, slot0: null, slot1: null };
  }
}

export async function listVmc(
  oplRoot: string
): Promise<{ success: boolean; cards: VmcInfo[]; message?: string }> {
  try {
    const dir = vmcDir(oplRoot);
    const items = await fs.readdir(dir, { withFileTypes: true }).catch(() => []);
    const cards: VmcInfo[] = [];
    for (const item of items) {
      if (!item.isFile() || !/\.bin$/i.test(item.name)) continue;
      // Skip macOS AppleDouble sidecars (`._name.bin`) created when writing to
      // FAT/exFAT cards, plus any other hidden files — they aren't real VMCs.
      if (item.name.startsWith(".")) continue;
      const stat = await fs.stat(path.join(dir, item.name));
      cards.push({
        name: item.name.replace(/\.bin$/i, ""),
        sizeBytes: stat.size,
        sizeMb: Math.round(stat.size / MIB),
      });
    }
    cards.sort((a, b) => a.name.localeCompare(b.name));
    log.verbose(`Listed ${cards.length} VMC(s) in ${dir}`);
    return { success: true, cards };
  } catch (err: any) {
    log.error(`Failed to list VMCs in ${vmcDir(oplRoot)}:`, err?.message || err);
    return { success: false, cards: [], message: err?.message || String(err) };
  }
}

export async function createVmc(
  oplRoot: string,
  rawName: string,
  sizeMb: number
): Promise<{ success: boolean; name?: string; message?: string }> {
  try {
    const name = sanitizeVmcName(rawName);
    if (!name) return { success: false, message: "Invalid card name." };
    if (!VALID_SIZES_MB.includes(sizeMb)) {
      return { success: false, message: `Unsupported size: ${sizeMb} MB.` };
    }

    const dir = vmcDir(oplRoot);
    await fs.mkdir(dir, { recursive: true });
    const target = path.join(dir, `${name}.bin`);

    try {
      await fs.access(target);
      return { success: false, message: `A card named "${name}" already exists.` };
    } catch {
      // Does not exist — good to create.
    }

    log.info(`Creating ${sizeMb} MB VMC "${name}" → ${target}`);
    const handle = await fs.open(target, "w");
    try {
      for (let written = 0; written < sizeMb; written++) {
        await handle.write(ZERO_CHUNK, 0, MIB);
      }
    } finally {
      await handle.close();
    }
    log.info(`Created VMC "${name}" (${sizeMb} MB)`);
    return { success: true, name };
  } catch (err: any) {
    log.error(`Failed to create VMC "${rawName}":`, err?.message || err);
    return { success: false, message: err?.message || String(err) };
  }
}

export async function deleteVmc(
  oplRoot: string,
  name: string
): Promise<{ success: boolean; message?: string }> {
  try {
    const safe = sanitizeVmcName(name);
    if (!safe) return { success: false, message: "Invalid card name." };
    await fs.rm(path.join(vmcDir(oplRoot), `${safe}.bin`), { force: true });
    log.info(`Deleted VMC "${safe}"`);
    return { success: true };
  } catch (err: any) {
    log.error(`Failed to delete VMC "${name}":`, err?.message || err);
    return { success: false, message: err?.message || String(err) };
  }
}
