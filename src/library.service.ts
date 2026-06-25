import { dialog, OpenDialogOptions } from "electron";
import * as fs from "fs/promises";
import * as fsSync from "fs";
import path from "path";
import https from "https";
import { getCachedGameId, setCachedGameId } from "./iso-cache.service";
import { createLogger, formatBytes } from "./logger";

const log = createLogger("library");

const PS1_GAME_ID_PREFIXES = [
  "SCUS",
  "SLUS",
  "SCES",
  "SLES",
  "SCPS",
  "SLPS",
  "SLPM",
  "SIPS",
  "SCAJ",
  "PAPX",
  "PCPX",
  "SCED",
  "SLED",
];

const PS1_GAME_ID_REGEX = new RegExp(
  `(?:${PS1_GAME_ID_PREFIXES.join("|")})[_-][0-9]{3}\\.[0-9]{2}`,
  "g"
);

const PS1_GAMES_LIST_CANDIDATE_PATHS = [
  path.resolve(__dirname, "../assets/ps1-gameslist.txt"),
  path.resolve(__dirname, "../../assets/ps1-gameslist.txt"),
  path.resolve(process.cwd(), "assets/ps1-gameslist.txt"),
];

let cachedPs1GamesList: Map<string, string> | null = null;
let attemptedToLoadPs1GamesList = false;

async function loadPs1GamesList() {
  if (attemptedToLoadPs1GamesList) {
    return cachedPs1GamesList;
  }

  attemptedToLoadPs1GamesList = true;

  for (const candidate of PS1_GAMES_LIST_CANDIDATE_PATHS) {
    try {
      const content = await fs.readFile(candidate, "utf-8");
      const map = new Map<string, string>();

      content.split(/\r?\n/).forEach((line) => {
        const trimmed = line.trim();
        if (!trimmed) {
          return;
        }

        const [id, ...nameParts] = trimmed.split(/\s+/);
        if (!id || nameParts.length === 0) {
          return;
        }

        map.set(id.toUpperCase(), nameParts.join(" "));
      });

      if (map.size > 0) {
        cachedPs1GamesList = map;
        log.verbose(`Loaded PS1 games list (${map.size} titles) from ${candidate}`);
        return cachedPs1GamesList;
      }
    } catch (err) {
      // Intentionally ignore missing file/location attempts.
      log.verbose(`PS1 games list not at ${candidate}, trying next candidate`);
    }
  }

  cachedPs1GamesList = null;
  log.warn("PS1 games list not found in any candidate path — titles will fall back to filenames");
  return cachedPs1GamesList;
}

async function findPs1GameName(gameId: string) {
  const list = await loadPs1GamesList();
  if (!list) {
    return undefined;
  }

  return list.get(gameId.toUpperCase());
}

const PS2_GAME_ID_PREFIXES = [
  "SLUS",
  "SCUS",
  "SLES",
  "SCES",
  "SLPM",
  "SLPS",
  "SCPS",
  "SCPM",
  "SLAJ",
  "SCAJ",
  "SLKA",
  "SCKA",
  "SCED",
  "SCCS",
];

const PS2_GAME_ID_REGEX = new RegExp(
  `(?:${PS2_GAME_ID_PREFIXES.join("|")})_[0-9]{3}\\.[0-9]{2}(?:;1)?`,
  "g"
);

const FILE_SCAN_CHUNK_BYTES = 1024 * 1024; // 1 MB chunks keep memory usage predictable.
const FILE_SCAN_OVERLAP_BYTES = 64; // Overlap to catch IDs spanning chunk boundaries.
const PS2_GAMES_LIST_CANDIDATE_PATHS = [
  path.resolve(__dirname, "../assets/ps2-gameslist.txt"),
  path.resolve(__dirname, "../../assets/ps2-gameslist.txt"),
  path.resolve(process.cwd(), "assets/ps2-gameslist.txt"),
];

let cachedPs2GamesList: Map<string, string> | null = null;
let attemptedToLoadPs2GamesList = false;

function normaliseGameIdForLookup(rawId: string) {
  return rawId.replace("_", "-").replace(/\./g, "").toUpperCase();
}

async function loadPs2GamesList() {
  if (attemptedToLoadPs2GamesList) {
    return cachedPs2GamesList;
  }

  attemptedToLoadPs2GamesList = true;

  for (const candidate of PS2_GAMES_LIST_CANDIDATE_PATHS) {
    try {
      const content = await fs.readFile(candidate, "utf-8");
      const map = new Map<string, string>();

      content.split(/\r?\n/).forEach((line) => {
        const trimmed = line.trim();
        if (!trimmed) {
          return;
        }

        const [id, ...nameParts] = trimmed.split(/\s+/);
        if (!id || nameParts.length === 0) {
          return;
        }

        map.set(id.toUpperCase(), nameParts.join(" "));
      });

      if (map.size > 0) {
        cachedPs2GamesList = map;
        log.verbose(`Loaded PS2 games list (${map.size} titles) from ${candidate}`);
        return cachedPs2GamesList;
      }
    } catch (err) {
      // Intentionally ignore missing file/location attempts.
      log.verbose(`PS2 games list not at ${candidate}, trying next candidate`);
    }
  }

  cachedPs2GamesList = null;
  log.warn("PS2 games list not found in any candidate path — titles will fall back to filenames");
  return cachedPs2GamesList;
}

async function findPs2GameName(gameId: string) {
  const list = await loadPs2GamesList();
  if (!list) {
    return undefined;
  }

  return list.get(gameId.toUpperCase());
}

export async function openAskDirectory(options: any) {
  const defaultOptions = {
    properties: ["openDirectory"],
    title: "Select OPL Root Directory",
  };

  const result = await dialog.showOpenDialog({
    ...defaultOptions,
    ...options,
  });

  return result;
}

// Standard OPL folder structure this toolbox manages. A valid OPL root is
// expected to contain these subdirectories; OPL itself relies on them too.
export const STANDARD_OPL_DIRS = [
  "APPS",
  "ART",
  "CD",
  "CFG",
  "DVD",
  "POPS",
  "VCD",
  "VMC",
];

// Inspect a directory and report which of the standard OPL folders are
// present and which are missing, so the caller can warn the user before
// mounting a folder that isn't actually an OPL root.
export async function checkOplStructure(dirPath: string) {
  try {
    const entries = await fs.readdir(dirPath, { withFileTypes: true });
    const dirNames = new Set(
      entries.filter((e) => e.isDirectory()).map((e) => e.name)
    );
    const existing = STANDARD_OPL_DIRS.filter((d) => dirNames.has(d));
    const missing = STANDARD_OPL_DIRS.filter((d) => !dirNames.has(d));
    log.verbose(
      `OPL structure check for ${dirPath} — present: [${existing.join(", ")}], ` +
        `missing: [${missing.join(", ")}]`
    );
    return { success: true, existing, missing };
  } catch (err) {
    log.error(`Failed to check OPL structure in ${dirPath}:`, err);
    return { success: false, message: String(err) };
  }
}

// Create the given standard OPL subdirectories under the OPL root, used to
// repair a directory that is missing folders. Only known standard folder
// names are honoured.
export async function createOplFolders(dirPath: string, folders: string[]) {
  try {
    const created: string[] = [];
    for (const folder of folders) {
      if (!STANDARD_OPL_DIRS.includes(folder)) continue;
      await fs.mkdir(path.join(dirPath, folder), { recursive: true });
      created.push(folder);
    }
    log.info(`Created OPL folder(s) under ${dirPath}: [${created.join(", ")}]`);
    return { success: true, created };
  } catch (err) {
    log.error(`Failed to create OPL folders in ${dirPath}:`, err);
    return { success: false, message: String(err) };
  }
}

export async function getGamesFiles(dirPath: string) {
  try {
    log.verbose(`Scanning game folders under ${dirPath} (CD, DVD, VCD, POPS)`);
    const [items_cd, items_dvd, items_vcd, items_pops] = await Promise.all([
      fs.readdir(path.join(dirPath, "CD"), { withFileTypes: true }).catch(() => []),
      fs.readdir(path.join(dirPath, "DVD"), { withFileTypes: true }).catch(() => []),
      fs.readdir(path.join(dirPath, "VCD"), { withFileTypes: true }).catch(() => []),
      fs.readdir(path.join(dirPath, "POPS"), { withFileTypes: true }).catch(() => []),
    ]);
    log.verbose(
      `Raw directory entries — CD: ${items_cd.length}, DVD: ${items_dvd.length}, ` +
        `VCD: ${items_vcd.length}, POPS: ${items_pops.length}`
    );
    // Only include files, skip directories
    const items = [
      ...items_cd.map((item) =>
        Object.assign(item, { parentDir: path.join(dirPath, "CD") })
      ),
      ...items_dvd.map((item) =>
        Object.assign(item, { parentDir: path.join(dirPath, "DVD") })
      ),
      ...items_vcd.map((item) =>
        Object.assign(item, { parentDir: path.join(dirPath, "VCD") })
      ),
      ...items_pops.map((item) =>
        Object.assign(item, { parentDir: path.join(dirPath, "POPS") })
      ),
    ].filter((item) => {
      if (!item.isFile() || item.name.startsWith(".")) return false;
      const lower = item.name.toLowerCase();
      return (
        lower.endsWith(".iso") ||
        lower.endsWith(".zso") ||
        lower.endsWith(".vcd")
      );
    });

    const files = [];

    for (const item of items) {
      const fullPath = path.join(item.parentDir, item.name);
      const stats = await fs.stat(fullPath);

      const itemInfo = {
        extension: path.extname(item.name),
        name: path.parse(item.name).name,
        parentPath: item.parentDir,
        path: fullPath,
        stats,
      };

      files.push(itemInfo);
    }
    log.info(`Found ${files.length} disc image file(s) under ${dirPath}`);
    return { success: true, data: files };
  } catch (err) {
    log.error(`Failed to scan game files in ${dirPath}:`, err);
    return { success: false, message: err };
  }
}

// CRC32 lookup table for UL fragment filename matching
const CRC32_TABLE = new Uint32Array(256);
for (let i = 0; i < 256; i++) {
  let crc = i;
  for (let j = 0; j < 8; j++) {
    crc = crc & 1 ? (crc >>> 1) ^ 0xedb88320 : crc >>> 1;
  }
  CRC32_TABLE[i] = crc;
}

function crc32(str: string): number {
  let crc = 0xffffffff;
  for (let i = 0; i < str.length; i++) {
    crc = (crc >>> 8) ^ CRC32_TABLE[(crc ^ str.charCodeAt(i)) & 0xff];
  }
  return (crc ^ 0xffffffff) >>> 0;
}

export async function getULGames(dirPath: string) {
  try {
    const ulCfgPath = path.join(dirPath, "ul.cfg");

    // Check if ul.cfg exists
    try {
      await fs.access(ulCfgPath);
    } catch {
      log.verbose(`No ul.cfg in ${dirPath} — no UL (split) games present`);
      return { success: true, data: [] };
    }

    const buffer = await fs.readFile(ulCfgPath);
    const RECORD_SIZE = 64;

    if (buffer.length === 0) {
      log.verbose("ul.cfg is empty — no UL games to parse");
      return { success: true, data: [] };
    }

    const recordCount = Math.floor(buffer.length / RECORD_SIZE);
    log.verbose(`Parsing ul.cfg: ${buffer.length} bytes → ${recordCount} record(s)`);
    const entries: {
      name: string;
      gameId: string;
      numParts: number;
      mediaType: string;
      totalSize: number;
    }[] = [];

    // Read all files in the root directory once for fragment matching
    const rootFiles = await fs
      .readdir(dirPath, { withFileTypes: true })
      .catch(() => []);
    const ulFiles = rootFiles.filter(
      (f) => f.isFile() && f.name.startsWith("ul.")
    );

    for (let i = 0; i < recordCount; i++) {
      const offset = i * RECORD_SIZE;
      const record = buffer.subarray(offset, offset + RECORD_SIZE);

      // Bytes 0-31: game name (null-terminated ASCII)
      const nameRaw = record.subarray(0, 32);
      const nameEnd = nameRaw.indexOf(0);
      const name = nameRaw
        .subarray(0, nameEnd === -1 ? 32 : nameEnd)
        .toString("ascii")
        .trim();

      // Bytes 32-46: game ID (null-terminated ASCII)
      const idRaw = record.subarray(32, 47);
      const idEnd = idRaw.indexOf(0);
      const gameIdRaw = idRaw
        .subarray(0, idEnd === -1 ? 15 : idEnd)
        .toString("ascii")
        .trim();

      if (!name || !gameIdRaw) {
        continue;
      }

      // Normalize game ID to XXXX_###.## format
      // Handles: SLUS12345, SLUS_12345, SLUS-12345, SLUS_123.45, SLUS-123.45
      // Also strips leading "ul" prefix if present (e.g. ul.SLUS_12345 -> SLUS_123.45)
      let normalized = gameIdRaw.trim();
      normalized = normalized.replace(/^ul[._-]?/i, "");
      const cleaned = normalized.replace(/[^A-Za-z0-9]/g, "");
      const idMatch = cleaned.match(/^([A-Za-z]{4})(\d{5})$/);
      const gameId = idMatch
        ? `${idMatch[1].toUpperCase()}_${idMatch[2].slice(0, 3)}.${idMatch[2].slice(3)}`
        : normalized;

      // Byte 47: number of parts
      const numParts = record[47];

      // Bytes 48-51: media type (little-endian uint32)
      const mediaTypeRaw = record.readUInt32LE(48);
      const mediaType = mediaTypeRaw === 0x12 ? "CD" : "DVD";

      // Match fragment files using multiple naming conventions
      // OPL format:   ul.<CRC32>.<GAMEID>.<PART>
      // USBExtreme:   ul.<GAMEID>.<PART>
      // PS2-ISO-Util: ul.<CRC32>.<GAMEID>.<PART>
      const hash = crc32(name).toString(16).padStart(8, "0").toUpperCase();
      const prefixByCrc = `ul.${hash}`;

      // Normalise game ID for matching (strip dots: SLUS_123.45 -> SLUS_12345)
      const gameIdNoDot = gameId.replace(/\./g, "").toUpperCase();
      const prefixById = `ul.${gameIdNoDot}`;

      let totalSize = 0;
      for (const f of ulFiles) {
        const upperName = f.name.toUpperCase();
        if (upperName.startsWith(prefixByCrc) || upperName.startsWith(prefixById)) {
          try {
            const stat = await fs.stat(path.join(dirPath, f.name));
            totalSize += stat.size;
          } catch {
            // Fragment file inaccessible, skip
          }
        }
      }

      log.verbose(
        `UL entry: ${gameId} "${name}" — ${numParts} part(s), ${mediaType}, ${formatBytes(totalSize)}`
      );
      entries.push({ name, gameId, numParts, mediaType, totalSize });
    }

    if (entries.length > 0) {
      log.info(`Parsed ${entries.length} UL (split) game(s) from ul.cfg`);
    }
    return { success: true, data: entries };
  } catch (err) {
    log.error(`Failed to read UL games from ${dirPath}:`, err);
    return { success: false, message: err };
  }
}

export async function getArtFolder(dirpath: string) {
  try {
    const artDir = path.join(dirpath, "ART");
    const items = await fs.readdir(artDir, { withFileTypes: true });
    const artFiles = await Promise.all(
      items
        .filter(
          (item) =>
            item.isFile() &&
            !item.name.startsWith(".") &&
            (item.name.toLowerCase().endsWith(".jpg") ||
              item.name.toLowerCase().endsWith(".png"))
        )
        .map(async (item) => {
          const filePath = path.join(artDir, item.name);
          const fileBuffer = await fs.readFile(filePath);
          const baseName = path.parse(item.name).name;
          // Art type (COV/ICO/SCR) is always the last _-separated segment
          const lastUnderscoreIdx = baseName.lastIndexOf("_");
          const type = lastUnderscoreIdx >= 0 ? baseName.slice(lastUnderscoreIdx + 1) : "";
          const nameBeforeType = lastUnderscoreIdx >= 0 ? baseName.slice(0, lastUnderscoreIdx) : baseName;
          // Extract gameId (XXXX_###.##) from the start of the filename
          const idMatch = nameBeforeType.match(/([A-Z]{4}_\d{3}\.\d{2})/i);
          const gameId = idMatch ? idMatch[1] : nameBeforeType;
          return {
            name: baseName,
            extension: path.extname(item.name),
            path: filePath,
            gameId,
            type,
            base64: fileBuffer.toString("base64"),
          };
        })
    );
    log.verbose(`Loaded ${artFiles.length} artwork file(s) from ${artDir}`);
    return { success: true, data: artFiles };
  } catch (err) {
    // ART folder is optional; a missing one is expected on fresh libraries.
    log.verbose(`No artwork loaded from ${path.join(dirpath, "ART")}: ${(err as Error)?.message || err}`);
    return { success: false, message: err };
  }
}

export async function downloadArtByGameId(
  dirPath: string,
  gameId: string,
  system: "PS1" | "PS2" = "PS2",
  saveAsName?: string,
  artTypes?: string[]
) {
  const baseUrl = `https://raw.githubusercontent.com/Luden02/psx-ps2-opl-art-database/refs/heads/main/${system}`;
  const types = artTypes ?? ["COV", "ICO", "SCR"];
  const results: any[] = [];
  const localName = saveAsName || gameId;

  log.info(
    `Downloading ${system} artwork for ${gameId} (${types.join(", ")}) into ${dirPath}`
  );

  for (const type of types) {
    const fileName = `${gameId}_${type}.png`;
    const url = `${baseUrl}/${gameId}/${fileName}`;
    log.verbose(`GET ${url}`);

    try {
      const buffer = await new Promise<Buffer>((resolve, reject) => {
        https
          .get(url, (res) => {
            if (res.statusCode !== 200) {
              return reject(
                new Error(`Failed to download ${fileName}: ${res.statusCode}`)
              );
            }
            const data: Buffer[] = [];
            res.on("data", (chunk) => data.push(chunk));
            res.on("end", () => resolve(Buffer.concat(data)));
          })
          .on("error", reject);
      });

      const savePath = path.join(dirPath, `${localName}_${type}.png`);
      await fs.writeFile(savePath, buffer);
      log.verbose(`Saved ${type} artwork (${formatBytes(buffer.length)}) → ${savePath}`);
      results.push({
        name: localName,
        type,
        url,
        savedPath: savePath,
      });
    } catch (err: any) {
      log.verbose(`${type} artwork unavailable for ${gameId}: ${err.message}`);
      results.push({
        name: localName,
        type,
        url,
        error: err.message,
      });
    }
  }

  const saved = results.filter((r) => r.savedPath).length;
  log.info(`Artwork for ${gameId}: ${saved}/${types.length} file(s) downloaded`);
  if (saved === 0) {
    const msg = `No artwork found for ${gameId} in ${system} database.`;
    log.warn(msg);
    return { success: false, data: results, message: msg };
  }
  return { success: true, data: results };
}

// Reserved device names on Windows that cannot be used as filenames (case-insensitive,
// with or without an extension). Matched after sanitisation.
const WINDOWS_RESERVED_NAMES = new Set([
  "CON", "PRN", "AUX", "NUL",
  "COM1", "COM2", "COM3", "COM4", "COM5", "COM6", "COM7", "COM8", "COM9",
  "LPT1", "LPT2", "LPT3", "LPT4", "LPT5", "LPT6", "LPT7", "LPT8", "LPT9",
]);

/**
 * Strips characters from `name` that are illegal in filenames on Windows, macOS, or Linux.
 * - Removes: < > : " / \ | ? * and ASCII control characters (0x00–0x1F)
 * - Collapses whitespace and trims leading/trailing dots and spaces (Windows trims these silently)
 * - Renames Windows reserved device names by appending an underscore
 * - Returns an underscore if the result would otherwise be empty
 *
 * Intended for the *name* portion only — do not pass a full path, and re-append the extension yourself.
 */
export function sanitizeGameFilename(name: string): string {
  if (!name) return "_";

  let cleaned = name
    .replace(/[<>:"/\\|?*\u0000-\u001F]/g, "")
    .replace(/\s+/g, " ")
    .replace(/^[.\s]+|[.\s]+$/g, "");

  if (!cleaned) return "_";

  const upper = cleaned.toUpperCase();
  const baseUpper = upper.split(".")[0];
  if (WINDOWS_RESERVED_NAMES.has(baseUpper)) {
    cleaned = `${cleaned}_`;
  }

  return cleaned;
}

export async function renameGamefile(
  dirpath: string,
  gameId: string,
  gameName: string,
  nameOnly: boolean = false
) {
  const ext = path.extname(dirpath);
  const parentDir = path.dirname(dirpath);
  const safeName = sanitizeGameFilename(gameName);
  // "New" OPL convention: drop the GAMEID. prefix so the file is just
  // "<Title>.iso". OPL reads the game ID from SYSTEM.CNF on its own.
  const newFileName = nameOnly
    ? `${safeName}${ext}`
    : `${gameId}.${safeName}${ext}`;
  const newFilePath = path.join(parentDir, newFileName);

  log.verbose(
    `Renaming (${nameOnly ? "new" : "old"} convention): ${path.basename(dirpath)} → ${newFileName}`
  );

  try {
    await fs.rename(dirpath, newFilePath);
    log.info(`Renamed ${gameId} → ${newFileName}`);
    return { success: true, newPath: newFilePath };
  } catch (err) {
    log.error(`Failed to rename ${path.basename(dirpath)} → ${newFileName}:`, err);
    return { success: false, message: err };
  }
}

// ── PS1 rename progress percentages ──────────────────────────────
const PROGRESS_APPS_WAIT = 10;
const PROGRESS_VCD_RENAME = 15;
const PROGRESS_POPS_SUBFOLDER = 25;
const PROGRESS_READ_APPS = 35;
const PROGRESS_ELF_RENAME = 40;
const PROGRESS_APPS_RENAME = 50;
const PROGRESS_CFG_WRITE = 70;
const PROGRESS_DONE = 100;

// ── PS1 rename retry timing (ms) ─────────────────────────────────
const RENAME_STEP2_RETRY_MAX = 10;
const RENAME_STEP2_RETRY_DELAY_MS = 500;
const RENAME_ELF_RETRY_MAX = 5;
const RENAME_ELF_RETRY_DELAY_MS = 300;
const TITLE_CFG_POST_WRITE_DELAY_MS = 800;

function deriveOldTitle(vcdPath: string, gameId: string): string | null {
  const vcdBasename = path.basename(vcdPath);
  const vcdExt = path.extname(vcdBasename);
  const vcdStem = vcdBasename.slice(0, -vcdExt.length);
  const prefix = `${gameId}.`;
  const oldTitle = vcdStem.startsWith(prefix) ? vcdStem.slice(prefix.length) : vcdStem;
  return oldTitle || null;
}

async function renameVcdFile(
  vcdPath: string,
  newVcdPath: string,
  vcdBasename: string,
  newVcdBasename: string,
  onProgress?: (percent: number, stage: string) => void,
): Promise<string | null> {
  onProgress?.(PROGRESS_VCD_RENAME, `Renaming VCD: ${vcdBasename} → ${newVcdBasename}`);
  log.info(`Renaming VCD: ${vcdBasename} → ${newVcdBasename}`);
  try {
    await fs.rename(vcdPath, newVcdPath);
    log.info(`VCD renamed: ${vcdBasename} → ${newVcdBasename}`);
    return null;
  } catch (err: unknown) {
    const msg = `Failed to rename VCD: ${err instanceof Error ? err.message : String(err)}`;
    log.error(msg);
    return msg;
  }
}

async function renamePopsSubfolder(
  popsDir: string,
  oldTitle: string,
  safeNewTitle: string,
  onProgress?: (percent: number, stage: string) => void,
): Promise<void> {
  onProgress?.(PROGRESS_POPS_SUBFOLDER, `Renaming VMC folder: ${oldTitle}/ → ${safeNewTitle}/`);
  log.info(`Renaming VMC folder: ${oldTitle}/ → ${safeNewTitle}/`);
  try {
    await fs.access(path.join(popsDir, oldTitle));
    await fs.rename(path.join(popsDir, oldTitle), path.join(popsDir, safeNewTitle));
    log.verbose(`POPS VMC subfolder renamed`);
  } catch (err: unknown) {
    if (err instanceof Error && 'code' in err && (err as NodeJS.ErrnoException).code === 'ENOENT') {
      log.verbose(`POPS VMC subfolder does not exist — skipping`);
    } else {
      log.warn(`Failed to rename POPS VMC subfolder: ${err instanceof Error ? err.message : String(err)}`);
    }
  }
}

interface AppsFolderContents {
  oldElfFile?: string;
  oldTitleCfgContent: string;
}

async function readAppsFolderContents(oldAppsFolder: string): Promise<AppsFolderContents | null> {
  for (let attempt = 0; attempt < 5; attempt++) {
    try {
      const files = await fs.readdir(oldAppsFolder);
      const oldElfFile = files.find((f) => /\.ELF$/i.test(f));
      let oldTitleCfgContent = "";
      try {
        oldTitleCfgContent = await fs.readFile(path.join(oldAppsFolder, "title.cfg"), "utf-8");
      } catch { /* no title.cfg — fine */ }
      return { oldElfFile, oldTitleCfgContent };
    } catch {
      if (attempt < 4) await new Promise((r) => setTimeout(r, 200));
    }
  }
  return null;
}

function computeNewElfName(
  oldElfFile: string | undefined,
  gameId: string,
  oldTitle: string,
  safeNewTitle: string,
): string | undefined {
  if (!oldElfFile || !/\.ELF$/i.test(oldElfFile)) return undefined;

  const elfExt = path.extname(oldElfFile);
  const elfStem = oldElfFile.slice(0, -elfExt.length);
  const gIdx = elfStem.indexOf(gameId);
  if (gIdx !== -1) {
    return `${elfStem.slice(0, gIdx)}${gameId}.${safeNewTitle}${elfExt}`;
  }

  const tIdx = elfStem.lastIndexOf(oldTitle);
  if (tIdx !== -1) {
    const newName = `${elfStem.slice(0, tIdx)}${safeNewTitle}${elfExt}`;
    log.verbose(`ELF name derived via oldTitle fallback: ${oldElfFile} → ${newName}`);
    return newName;
  }

  log.warn(`ELF name lacks gameId "${gameId}" and oldTitle "${oldTitle}" — keeping existing`);
  return oldElfFile;
}

interface CfgBuildResult {
  content: string;
  bootVal?: string;
}

function buildNewCfgContent(
  oldTitleCfgContent: string,
  newTitle: string,
  newElfFile: string | undefined,
  gameId: string,
): CfgBuildResult {
  const bootVal = newElfFile ? `boot=${newElfFile}` : undefined;
  const seenKeys = new Map<string, string>();

  const cfgLines = oldTitleCfgContent.split("\n").map((line) => {
    const t = line.trimEnd();
    const eq = t.indexOf("=");
    if (eq === -1) return line;
    const k = t.slice(0, eq).trim();
    const lower = k.toLowerCase();
    if (!seenKeys.has(lower)) seenKeys.set(lower, k);
    if (lower === "title") {
      return k === "Title" ? `Title=${newTitle}` : `title=${newTitle}`;
    }
    if (lower === "boot" && bootVal) return bootVal;
    return line;
  });

  const add: string[] = [];
  // OPL's title.cfg parser may look for either casing — add both for compatibility
  if (!seenKeys.has("title")) { add.push(`title=${newTitle}`); add.push(`Title=${newTitle}`); }
  if (!seenKeys.has("boot") && bootVal) add.push(bootVal);
  if (!seenKeys.has("gameid")) add.push(`GameID=${gameId}`);

  const content =
    add.length > 0
      ? cfgLines.join("\n") + (cfgLines.length && cfgLines[cfgLines.length - 1] !== "" ? "\n" : "") + add.join("\n") + "\n"
      : cfgLines.join("\n");

  return { content, bootVal };
}

export async function renamePs1LauncherStep1(
  vcdPath: string,
  gameId: string,
  newTitle: string,
  onProgress?: (percent: number, stage: string) => void
): Promise<{
  success: boolean;
  newVcdPath?: string;
  oldElfFile?: string;
  newElfFile?: string;
  newCfgContent?: string;
  newAppsFolder?: string;
  safeNewTitle?: string;
  message?: string;
}> {
  const safeNewTitle = sanitizeGameFilename(newTitle);
  if (!safeNewTitle) {
    return { success: false, message: "The new name is empty or invalid after sanitization." };
  }

  const popsDir = path.dirname(vcdPath);
  const oplRoot = path.resolve(popsDir, "..");

  const oldTitle = deriveOldTitle(vcdPath, gameId);
  if (!oldTitle) {
    return { success: false, message: "Could not derive the current game title from the VCD filename." };
  }
  if (oldTitle === safeNewTitle) {
    return { success: false, message: "The new name is identical to the current name." };
  }

  log.info(`PS1 rename step 1: "${oldTitle}" → "${safeNewTitle}" (gameId=${gameId})`);

  const vcdBasename = path.basename(vcdPath);
  const vcdExt = path.extname(vcdBasename);
  const newVcdBasename = `${safeNewTitle}${vcdExt}`;
  const newVcdPath = path.join(popsDir, newVcdBasename);
  const appsDir = path.join(oplRoot, "APPS");
  const oldAppsFolder = path.join(appsDir, `POPS_${oldTitle}`);
  const newAppsFolder = path.join(appsDir, `POPS_${safeNewTitle}`);

  // ── Rename the VCD file ─────────────────────────────────────────────
  const vcdError = await renameVcdFile(vcdPath, newVcdPath, vcdBasename, newVcdBasename, onProgress);
  if (vcdError) return { success: false, message: vcdError };

  // ── Rename POPS VMC subfolder (if exists) ───────────────────────────
  await renamePopsSubfolder(popsDir, oldTitle, safeNewTitle, onProgress);

  // ── Read OLD APPS folder contents before renaming ──────────────────
  onProgress?.(PROGRESS_READ_APPS, "Reading APPS launcher folder contents…");
  const appsContents = await readAppsFolderContents(oldAppsFolder);
  if (!appsContents) {
    return { success: false, message: `Cannot read APPS folder "${oldAppsFolder}".` };
  }

  // ── Pre-compute new values ──────────────────────────────────────────
  const newElfFile = computeNewElfName(appsContents.oldElfFile, gameId, oldTitle, safeNewTitle);

  const { content: newCfgContent } = buildNewCfgContent(
    appsContents.oldTitleCfgContent,
    newTitle,
    newElfFile,
    gameId,
  );

  // ── Rename the APPS launcher folder ─────────────────────────────────
  onProgress?.(PROGRESS_APPS_RENAME, `Renaming APPS folder: POPS_${oldTitle}/ → POPS_${safeNewTitle}/`);
  log.info(`Renaming APPS folder: POPS_${oldTitle}/ → POPS_${safeNewTitle}/`);
  try {
    await fs.rename(oldAppsFolder, newAppsFolder);
    log.info(`APPS folder renamed: POPS_${oldTitle}/ → POPS_${safeNewTitle}/`);
  } catch (err: unknown) {
    const msg = `Failed to rename APPS launcher folder: ${err instanceof Error ? err.message : String(err)}`;
    log.error(msg);
    return { success: false, message: msg };
  }

  log.info(`PS1 rename step 1 complete for "${oldTitle}" → "${safeNewTitle}"`);
  return {
    success: true,
    newVcdPath,
    oldElfFile: appsContents.oldElfFile,
    newElfFile,
    newCfgContent,
    newAppsFolder,
    safeNewTitle,
  };
}

export async function renamePs1LauncherStep2(
  params: {
    newAppsFolder: string;
    oldElfFile?: string;
    newElfFile?: string;
    newCfgContent?: string;
    newTitle: string;
  },
  onProgress?: (percent: number, stage: string) => void
): Promise<{
  success: boolean;
  message?: string;
}> {
  const { newAppsFolder, oldElfFile, newElfFile, newCfgContent, newTitle } = params;

  log.info(`PS1 rename step 2: applying internal changes to ${newAppsFolder}`);

  // ── Wait for the folder to be fully accessible ──────────────────────
  onProgress?.(PROGRESS_APPS_WAIT, "Waiting for APPS folder to be ready…");
  await new Promise((r) => setTimeout(r, TITLE_CFG_POST_WRITE_DELAY_MS));

  let appsReady = false;
  for (let attempt = 0; attempt < RENAME_STEP2_RETRY_MAX; attempt++) {
    try {
      await fs.access(newAppsFolder, fs.constants.F_OK);
      const files = await fs.readdir(newAppsFolder);
      if (oldElfFile && !files.some((f) => /\.ELF$/i.test(f))) {
        throw new Error("ELF not yet visible");
      }
      appsReady = true;
      break;
    } catch {
      if (attempt < RENAME_STEP2_RETRY_MAX - 1) await new Promise((r) => setTimeout(r, RENAME_STEP2_RETRY_DELAY_MS));
    }
  }
  if (!appsReady) {
    return { success: false, message: `APPS folder "${newAppsFolder}" is not ready.` };
  }

  // ── Rename the ELF file ────────────────────────────────────────────
  if (oldElfFile && newElfFile && oldElfFile !== newElfFile) {
    onProgress?.(PROGRESS_ELF_RENAME, `Renaming ELF: ${oldElfFile} → ${newElfFile}`);
    log.info(`Renaming ELF: ${oldElfFile} → ${newElfFile}`);
    const oldPath = path.join(newAppsFolder, oldElfFile);
    const newPath = path.join(newAppsFolder, newElfFile);
    let done = false;
    for (let attempt = 0; attempt < RENAME_ELF_RETRY_MAX; attempt++) {
      try {
        await fs.rename(oldPath, newPath);
        await fs.access(newPath, fs.constants.F_OK);
        done = true;
        break;
      } catch {
        if (attempt < RENAME_ELF_RETRY_MAX - 1) await new Promise((r) => setTimeout(r, RENAME_ELF_RETRY_DELAY_MS));
      }
    }
    if (!done) {
      log.error(`ELF rename failed after retries: ${oldElfFile} → ${newElfFile}`);
      return { success: false, message: `Failed to rename ELF after multiple attempts.` };
    }
    log.info(`ELF renamed: ${oldElfFile} → ${newElfFile}`);
  }

  // ── Write title.cfg ─────────────────────────────────────────────────
  if (newCfgContent !== undefined) {
    onProgress?.(PROGRESS_CFG_WRITE, "Updating title.cfg (title, Title, boot)");
    log.info("Updating title.cfg (title, Title, boot)");
    const cfgPath = path.join(newAppsFolder, "title.cfg");
    let done = false;
    for (let attempt = 0; attempt < RENAME_ELF_RETRY_MAX; attempt++) {
      try {
        await fs.writeFile(cfgPath, newCfgContent, "utf-8");
        const verify = await fs.readFile(cfgPath, "utf-8");
        if (verify === newCfgContent) {
          done = true;
          break;
        }
      } catch {
        if (attempt < RENAME_ELF_RETRY_MAX - 1) await new Promise((r) => setTimeout(r, RENAME_ELF_RETRY_DELAY_MS));
      }
    }
    if (!done) {
      log.error(`title.cfg write failed after retries`);
      return { success: false, message: `Failed to update title.cfg after multiple attempts.` };
    }
    log.info(`title.cfg updated`);
  }

  onProgress?.(PROGRESS_DONE, "Rename complete");
  log.info(`PS1 rename step 2 complete`);
  return { success: true };
}

/**
 * Turns a low-level fs error into a message that explains the likely cause.
 * The common one on macOS: the user picks a .cue in the file dialog (granting
 * access to that file only), but the app is then denied access to the sibling
 * .bin it references — surfacing as EPERM/EACCES.
 */
export function describeFileAccessError(err: any, fallbackPath?: string): string {
  const code = err?.code;
  const target = err?.path ?? fallbackPath ?? "the file";

  if (code === "EPERM" || code === "EACCES") {
    const base = `The system blocked access to "${target}" (${code}).`;
    if (process.platform === "darwin") {
      return (
        `${base} macOS lets the app read the .cue you selected but not the .bin next to it. ` +
        `Move the game files into a normal folder inside your home directory (not Desktop, Documents, ` +
        `Downloads, iCloud Drive, or an external drive), or grant the app Full Disk Access under ` +
        `System Settings → Privacy & Security, then try again.`
      );
    }
    return `${base} Check that the file is readable and not in a restricted location, then try again.`;
  }

  if (code === "ENOENT") {
    return (
      `Could not find "${target}". The .cue references a .bin that isn't beside it — ` +
      `make sure every .bin track sits in the same folder as the .cue.`
    );
  }

  return err?.message || String(err);
}

/**
 * Resolves the PS2 game ID for an ISO that doesn't carry the GAMEID prefix
 * in its filename (the "new" OPL naming convention — OPL reads the ID from
 * the disc's SYSTEM.CNF). Results are cached per (path, size, mtime) so
 * library scans only pay the hex-scan cost the first time.
 */
export async function resolveIsoGameId(
  filepath: string
): Promise<{
  success: boolean;
  gameId?: string;
  gameName?: string;
  message?: string;
}> {
  let stat;
  try {
    stat = await fs.stat(filepath);
  } catch (err: any) {
    log.error(`Cannot stat ${filepath} for ID resolution:`, err?.message || err);
    return { success: false, message: describeFileAccessError(err, filepath) };
  }

  const cached = getCachedGameId(filepath, stat.size, stat.mtimeMs);
  if (cached) {
    log.verbose(`Resolved ${path.basename(filepath)} from cache → ${cached.gameId}`);
    return { success: true, gameId: cached.gameId, gameName: cached.gameName };
  }

  // ZSO images are LZ4-compressed, so a raw byte scan can't see the game ID.
  // Decompress on the fly and scan the inflated stream instead.
  const isZso = path.extname(filepath).toLowerCase() === ".zso";
  log.verbose(
    `Cache miss for ${path.basename(filepath)} (${formatBytes(stat.size)}) — ` +
      `scanning ${isZso ? "decompressed ZSO" : "raw image"} for game ID`
  );
  const result = isZso
    ? await tryDetermineGameIdFromZso(filepath)
    : await tryDetermineGameIdFromHex(filepath);
  if (result && (result as any).success) {
    const r = result as any;
    setCachedGameId(filepath, stat.size, stat.mtimeMs, r.gameId, r.gameName);
    const titleSuffix = r.gameName ? ` (${r.gameName})` : "";
    log.info(`Resolved ${path.basename(filepath)} → ${r.gameId}${titleSuffix}`);
    return { success: true, gameId: r.gameId, gameName: r.gameName };
  }
  log.warn(`Could not resolve a game ID for ${path.basename(filepath)}`);
  return {
    success: false,
    message: (result as any)?.message || "Could not resolve game ID.",
  };
}

export async function tryDetermineGameIdFromHex(filepath: string) {
  let scanPath = filepath;

  // If a .cue was provided, resolve to its first BIN — the game ID lives in the disc image, not the cue sheet.
  if (path.extname(filepath).toLowerCase() === ".cue") {
    try {
      const { parseCueSheet, getCueDirectory } = await import("./cue-parser");
      const cueSheet = await parseCueSheet(filepath);
      const firstFile = cueSheet.files[0]?.filename;
      if (!firstFile) {
        return {
          success: false,
          message: "CUE sheet does not reference any BIN files.",
        };
      }
      scanPath = path.join(getCueDirectory(filepath), firstFile);
      log.verbose(`PS2 hex scan: resolved CUE to first BIN ${firstFile}`);
    } catch (err: any) {
      log.error(`PS2 hex scan: failed to parse CUE ${filepath}:`, err?.message || err);
      return {
        success: false,
        message: err?.message || "Failed to parse CUE sheet.",
      };
    }
  }

  let fileHandle: fs.FileHandle | undefined;

  try {
    fileHandle = await fs.open(scanPath, "r");
  } catch (err: any) {
    log.error(`PS2 hex scan: cannot open ${scanPath}:`, err?.code || err?.message || err);
    return {
      success: false,
      message: describeFileAccessError(err, scanPath),
    };
  }

  try {
    log.verbose(`PS2 hex scan: reading ${path.basename(scanPath)} in ${FILE_SCAN_CHUNK_BYTES / 1024}KB chunks`);
    const buffer = Buffer.alloc(FILE_SCAN_CHUNK_BYTES);
    let position = 0;
    let carry = "";

    while (true) {
      const { bytesRead } = await fileHandle.read(
        buffer,
        0,
        FILE_SCAN_CHUNK_BYTES,
        position
      );

      if (bytesRead === 0) {
        break;
      }

      position += bytesRead;

      const chunk = carry + buffer.subarray(0, bytesRead).toString("latin1");
      PS2_GAME_ID_REGEX.lastIndex = 0;
      const matches = chunk.match(PS2_GAME_ID_REGEX);

      if (matches && matches.length > 0) {
        const gameId = matches[0].replace(/;1$/, "");
        const lookupId = normaliseGameIdForLookup(gameId);
        const gameName = await findPs2GameName(lookupId);

        log.verbose(
          `PS2 hex scan: matched ${gameId} within first ${formatBytes(position)}` +
            (gameName ? ` (${gameName})` : " (no title in games list)")
        );
        return {
          success: true,
          gameId,
          formattedGameId: lookupId,
          ...(gameName ? { gameName } : {}),
        };
      }

      carry =
        chunk.length > FILE_SCAN_OVERLAP_BYTES
          ? chunk.slice(-FILE_SCAN_OVERLAP_BYTES)
          : chunk;
    }

    log.verbose(`PS2 hex scan: no game ID found after reading ${formatBytes(position)}`);
    return {
      success: false,
      message: "Could not locate a PS2 game ID inside the provided file.",
    };
  } catch (err: any) {
    log.error(`PS2 hex scan: read error on ${path.basename(scanPath)}:`, err?.message || err);
    return {
      success: false,
      message: err?.message || "Failed while reading file contents.",
    };
  } finally {
    if (fileHandle) {
      await fileHandle.close();
    }
  }
}

/**
 * Resolves a PS2 game ID from a ZSO (compressed ISO) by inflating the image
 * block by block and scanning the decompressed stream for the ID — the same
 * pattern tryDetermineGameIdFromHex matches on a raw ISO. The game ID is carried
 * in the disc's root directory (the boot ELF is named after it), so the scan
 * stops almost immediately on a valid disc; the byte cap bounds the cost when no
 * ID is present.
 */
export async function tryDetermineGameIdFromZso(filepath: string) {
  const { streamZsoContents } = await import("./zso.service");

  const SCAN_FLUSH_BYTES = FILE_SCAN_CHUNK_BYTES; // scan in ~1 MB windows
  const SCAN_LIMIT_BYTES = 64 * 1024 * 1024; // safety bound for ID-less images
  let pending = "";
  let foundId: string | null = null;

  const scan = (text: string): boolean => {
    PS2_GAME_ID_REGEX.lastIndex = 0;
    const matches = text.match(PS2_GAME_ID_REGEX);
    if (matches && matches.length > 0) {
      foundId = matches[0].replace(/;1$/, "");
      return true;
    }
    return false;
  };

  const result = await streamZsoContents(
    filepath,
    (chunk) => {
      pending += chunk.toString("latin1");
      if (pending.length < SCAN_FLUSH_BYTES) {
        return false;
      }
      if (scan(pending)) {
        return true;
      }
      // Keep a small tail so an ID straddling two windows still matches.
      pending = pending.slice(-FILE_SCAN_OVERLAP_BYTES);
      return false;
    },
    SCAN_LIMIT_BYTES
  );

  // Scan whatever is left in the final, sub-window buffer.
  if (!foundId && pending) {
    scan(pending);
  }

  if (foundId) {
    const lookupId = normaliseGameIdForLookup(foundId);
    const gameName = await findPs2GameName(lookupId);
    log.verbose(
      `ZSO scan: matched ${foundId}` +
        (gameName ? ` (${gameName})` : " (no title in games list)")
    );
    return {
      success: true,
      gameId: foundId,
      formattedGameId: lookupId,
      ...(gameName ? { gameName } : {}),
    };
  }

  if (!result.success) {
    log.error(`ZSO scan: failed to read ${path.basename(filepath)}: ${result.message}`);
    return {
      success: false,
      message: result.message || "Failed while reading ZSO contents.",
    };
  }

  log.verbose(`ZSO scan: no game ID found in ${path.basename(filepath)}`);
  return {
    success: false,
    message: "Could not locate a PS2 game ID inside the ZSO image.",
  };
}

const VCD_HEADER_SIZE = 1048576; // 1 MB — VCD header before disc data

/**
 * Resolves a PS1 game ID from a VCD file by scanning the disc image data
 * embedded after the 1 MB VCD header.
 *
 * VCD = POPStarter's container format: 1 MB TOC header followed by raw
 * 2352-byte sectors from the original BIN. The PS1 game ID string lives in
 * the ISO9660 volume descriptors / directory records of those sectors, so
 * we scan from offset VCD_HEADER_SIZE using the same regex used for BIN files.
 */
export async function tryDeterminePs1GameIdFromVcd(
  filepath: string
): Promise<{
  success: boolean;
  gameId?: string;
  formattedGameId?: string;
  gameName?: string;
  message?: string;
}> {
  let fileHandle: fs.FileHandle | undefined;

  try {
    fileHandle = await fs.open(filepath, "r");
  } catch (err: any) {
    log.error(`PS1 VCD scan: cannot open ${filepath}:`, err?.code || err?.message || err);
    return {
      success: false,
      message: describeFileAccessError(err, filepath),
    };
  }

  try {
    log.verbose(`PS1 VCD scan: reading ${path.basename(filepath)} from offset 1 MB (VCD header skip)`);
    const buffer = Buffer.alloc(FILE_SCAN_CHUNK_BYTES);
    let position = VCD_HEADER_SIZE;
    let carry = "";
    const fileSize = (await fs.stat(filepath)).size;

    while (position < fileSize) {
      const { bytesRead } = await fileHandle.read(
        buffer,
        0,
        FILE_SCAN_CHUNK_BYTES,
        position
      );

      if (bytesRead === 0) {
        break;
      }

      position += bytesRead;

      const chunk = carry + buffer.subarray(0, bytesRead).toString("latin1");
      PS1_GAME_ID_REGEX.lastIndex = 0;
      const matches = chunk.match(PS1_GAME_ID_REGEX);

      if (matches && matches.length > 0) {
        const rawId = matches[0];
        const gameId = rawId.replace("-", "_");
        const lookupId = normaliseGameIdForLookup(gameId);
        const gameName = await findPs1GameName(lookupId);

        log.verbose(
          `PS1 VCD scan: matched ${gameId} at offset ${position - bytesRead}` +
            (gameName ? ` (${gameName})` : " (no title in games list)")
        );
        return {
          success: true,
          gameId,
          formattedGameId: lookupId,
          ...(gameName ? { gameName } : {}),
        };
      }

      carry =
        chunk.length > FILE_SCAN_OVERLAP_BYTES
          ? chunk.slice(-FILE_SCAN_OVERLAP_BYTES)
          : chunk;

      // Safety bound — don't scan more than 64 MB of disc data for an ID
      if (position - VCD_HEADER_SIZE > 64 * 1024 * 1024) {
        log.verbose(`PS1 VCD scan: hit 64 MB safety bound for ${path.basename(filepath)}`);
        break;
      }
    }

    log.verbose(`PS1 VCD scan: no game ID found in ${path.basename(filepath)}`);
    return {
      success: false,
      message: "Could not locate a PS1 game ID inside the VCD disc data.",
    };
  } catch (err: any) {
    log.error(`PS1 VCD scan: read error on ${path.basename(filepath)}:`, err?.message || err);
    return {
      success: false,
      message: err?.message || "Failed while reading VCD file contents.",
    };
  } finally {
    if (fileHandle) {
      await fileHandle.close();
    }
  }
}

export async function tryDeterminePs1GameIdFromHex(filepath: string) {
  let scanPath = filepath;

  // If a .cue was provided, resolve it to its first BIN — the PS1 game ID lives in the disc image, not the cue sheet.
  if (path.extname(filepath).toLowerCase() === ".cue") {
    try {
      const { parseCueSheet, getCueDirectory } = await import("./cue-parser");
      const cueSheet = await parseCueSheet(filepath);
      const firstFile = cueSheet.files[0]?.filename;
      if (!firstFile) {
        return {
          success: false,
          message: "CUE sheet does not reference any BIN files.",
        };
      }
      scanPath = path.join(getCueDirectory(filepath), firstFile);
      log.verbose(`PS1 hex scan: resolved CUE to first BIN ${firstFile}`);
    } catch (err: any) {
      log.error(`PS1 hex scan: failed to parse CUE ${filepath}:`, err?.message || err);
      return {
        success: false,
        message: err?.message || "Failed to parse CUE sheet.",
      };
    }
  }

  let fileHandle: fs.FileHandle | undefined;

  try {
    fileHandle = await fs.open(scanPath, "r");
  } catch (err: any) {
    log.error(`PS1 hex scan: cannot open ${scanPath}:`, err?.code || err?.message || err);
    return {
      success: false,
      message: describeFileAccessError(err, scanPath),
    };
  }

  try {
    log.verbose(`PS1 hex scan: reading ${path.basename(scanPath)} in ${FILE_SCAN_CHUNK_BYTES / 1024}KB chunks`);
    const buffer = Buffer.alloc(FILE_SCAN_CHUNK_BYTES);
    let position = 0;
    let carry = "";

    while (true) {
      const { bytesRead } = await fileHandle.read(
        buffer,
        0,
        FILE_SCAN_CHUNK_BYTES,
        position
      );

      if (bytesRead === 0) {
        break;
      }

      position += bytesRead;

      const chunk = carry + buffer.subarray(0, bytesRead).toString("latin1");
      PS1_GAME_ID_REGEX.lastIndex = 0;
      const matches = chunk.match(PS1_GAME_ID_REGEX);

      if (matches && matches.length > 0) {
        const rawId = matches[0];
        // Normalize to underscore format: SCUS_123.45
        const gameId = rawId.replace("-", "_");
        const lookupId = normaliseGameIdForLookup(gameId);
        const gameName = await findPs1GameName(lookupId);

        log.verbose(
          `PS1 hex scan: matched ${gameId} within first ${formatBytes(position)}` +
            (gameName ? ` (${gameName})` : " (no title in games list)")
        );
        return {
          success: true,
          gameId,
          formattedGameId: lookupId,
          ...(gameName ? { gameName } : {}),
        };
      }

      carry =
        chunk.length > FILE_SCAN_OVERLAP_BYTES
          ? chunk.slice(-FILE_SCAN_OVERLAP_BYTES)
          : chunk;
    }

    log.verbose(`PS1 hex scan: no game ID found after reading ${formatBytes(position)}`);
    return {
      success: false,
      message: "Could not locate a PS1 game ID inside the provided file.",
    };
  } catch (err: any) {
    log.error(`PS1 hex scan: read error on ${path.basename(scanPath)}:`, err?.message || err);
    return {
      success: false,
      message: err?.message || "Failed while reading file contents.",
    };
  } finally {
    if (fileHandle) {
      await fileHandle.close();
    }
  }
}

export async function openAskElfFiles() {
  const result = await dialog.showOpenDialog({
    properties: ["openFile", "multiSelections"],
    filters: [{ name: "PS2 ELF / Homebrew", extensions: ["elf", "ELF"] }],
    title: "Select homebrew ELF(s) to import",
  });
  return result;
}

export async function openAskGameFiles(
  isGameCd: boolean,
  isGameDvd: boolean
) {
  const filters = [];
  if (isGameCd) {
    filters.push({ name: "CUE Files", extensions: ["cue"] });
  }
  if (isGameDvd) {
    filters.push({ name: "ISO/ZSO Files", extensions: ["iso", "zso"] });
  }
  const result = await dialog.showOpenDialog({
    properties: ["openFile", "multiSelections"],
    filters,
    title: "Select Game Files to Import",
  });

  return result;
}

export interface DeleteEntry {
  label: string;
  path?: string;
  success: boolean;
  error?: string;
}

export interface DeleteGameResult {
  success: boolean;
  message?: string;
  entries: DeleteEntry[];
}

export async function deleteGameAndRelatedFiles(
  gamePath: string,
  artDir: string,
  gameId: string,
  launcherFolder?: string,
  onProgress?: (entry: DeleteEntry) => void,
  bootName?: string,
): Promise<DeleteGameResult> {
  log.info(`Deleting ${gameId} and related files: ${gamePath}`);
  const entries: DeleteEntry[] = [];

  const addEntry = (label: string, success: boolean, path?: string, error?: string) => {
    const entry: DeleteEntry = { label, path, success, error };
    entries.push(entry);
    if (onProgress) onProgress(entry);
  };

  const oplRoot = path.dirname(artDir);

  // Helper: show path relative to OPL root
  const rel = (p: string) => path.relative(oplRoot, p);

  // 1. Delete the game file (VCD in POPS/)
  let hasCriticalError = false;
  try {
    await fs.unlink(gamePath);
    log.verbose(`Removed game file ${path.basename(gamePath)}`);
    addEntry("VCD", true, rel(gamePath));
  } catch (err: any) {
    hasCriticalError = true;
    log.error(`Failed to remove game file ${path.basename(gamePath)}:`, err?.message || err);
    addEntry("VCD", false, rel(gamePath), err?.message || String(err));
  }

  // 2. Delete POPStarter launcher folder (APPS/POPS_<name>/)
  if (launcherFolder) {
    const appsBase = path.join(oplRoot, "APPS");
    const resolved = path.resolve(appsBase, launcherFolder);
    if (!resolved.startsWith(appsBase + path.sep)) {
      log.warn(`Path traversal attempt blocked: "${launcherFolder}" — refusing to delete`);
      addEntry("Launcher folder", false, launcherFolder, "Path traversal blocked");
    } else {
      try {
        await fs.rm(resolved, { recursive: true, force: true });
        log.verbose(`Removed launcher folder ${rel(resolved)}`);
        addEntry("Launcher folder", true, rel(resolved));
      } catch (err: any) {
        log.error(`Failed to remove launcher ${rel(resolved)}:`, err?.message || err);
        addEntry("Launcher folder", false, rel(resolved), err?.message || String(err));
      }
    }
  }

  // 4. Delete per-game POPS subfolder (POPS/<title>/) containing VMC files etc.
  if (launcherFolder) {
    const vcdName = path.basename(gamePath);
    const ext = path.extname(vcdName);
    const gameTitle = vcdName.slice(0, -ext.length);
    const popsDir = path.dirname(gamePath);
    const popsSubdir = path.join(popsDir, gameTitle);

    try {
      await fs.access(popsSubdir);
      // Folder exists — enumerate and delete each file inside
      const files = await fs.readdir(popsSubdir);
      for (const f of files) {
        const filePath = path.join(popsSubdir, f);
        try {
          await fs.unlink(filePath);
          log.verbose(`Removed file ${rel(filePath)}`);
          addEntry("POPS subfolder file", true, rel(filePath));
        } catch (err: any) {
          addEntry("POPS subfolder file", false, rel(filePath), err?.message || String(err));
        }
      }
      // Remove the now-empty folder
      try {
        await fs.rmdir(popsSubdir);
        log.verbose(`Removed POPS subfolder ${rel(popsSubdir)}`);
        addEntry("POPS subfolder", true, rel(popsSubdir));
      } catch (err: any) {
        addEntry("POPS subfolder", false, rel(popsSubdir), err?.message || String(err));
      }
    } catch {
      // Folder doesn't exist — not an error
      addEntry("POPS subfolder", true, "Not present");
    }
  }

  // 4. Delete related artwork files
  //    Disc games match by gameId prefix (XXXX_###.##_TYPE.png),
  //    PS1 launcher apps match by bootName prefix (boot.ELF_TYPE.png).
  //    For PS1 launchers, skip artwork unless bootName is explicitly provided.
  if (launcherFolder && !bootName) {
    // Artwork intentionally omitted — user unchecked the option.
  } else {
    const artPrefix = bootName || gameId;
    try {
      const artFiles = await fs.readdir(artDir);
      const relatedArt = artFiles.filter((f) => {
        const base = path.parse(f).name;
        return f.startsWith(artPrefix + "_") && !f.startsWith(".");
      });
      if (relatedArt.length > 0) {
        log.verbose(`Removing ${relatedArt.length} artwork file(s) for ${artPrefix}`);
        for (const artFile of relatedArt) {
          const artPath = path.join(artDir, artFile);
          try {
            await fs.unlink(artPath);
            addEntry("Artwork", true, rel(artPath));
          } catch (err: any) {
            addEntry("Artwork", false, rel(artPath), err?.message || String(err));
          }
        }
      } else {
        addEntry("Artwork", true, "None found");
      }
    } catch {
      addEntry("Artwork", true, "No artwork directory");
    }
  }

  if (hasCriticalError) {
    log.error(`Failed to delete game file for ${gameId}`);
    return { success: false, message: entries.find((e) => e.label === "VCD")?.error ?? "VCD deletion failed", entries };
  }

  const allSuccess = entries.every((e) => e.success);
  if (!allSuccess) {
    log.info(`Deleted ${gameId} with some non-critical errors`);
  } else {
    log.info(`Deleted ${gameId} successfully`);
  }
  return { success: true, entries };
}

export async function moveFile(
  sourcePath: string,
  destPath: string,
  onProgress?: (progress: {
    percent: number;
    copiedMB: number;
    totalMB: number;
    elapsed: number;
  }) => void
) {
  log.info(`Moving file: ${sourcePath} → ${destPath}`);

  let targetPath = destPath;

  try {
    const destStats = await fs.stat(destPath);
    if (destStats.isDirectory()) {
      targetPath = path.join(destPath, path.basename(sourcePath));
    }
  } catch (statErr: any) {
    if (statErr?.code !== "ENOENT") {
      return { success: false, message: statErr?.message || String(statErr) };
    }
  }

  try {
    await fs.mkdir(path.dirname(targetPath), { recursive: true });
  } catch (mkdirErr: any) {
    if (mkdirErr?.code !== "EEXIST") {
      return { success: false, message: mkdirErr?.message || String(mkdirErr) };
    }
  }

  try {
    await fs.rename(sourcePath, targetPath);
    log.verbose(`Moved instantly via rename (same volume) → ${targetPath}`);
    return { success: true, newPath: targetPath };
  } catch (err: any) {
    if (err?.code === "EXDEV") {
      try {
        log.verbose("Cross-device move (EXDEV) — falling back to streamed copy");
        const stats = await fs.stat(sourcePath);
        const totalSize = stats.size;
        const startTime = Date.now();

        // Use streams for progress tracking
        await new Promise<void>((resolve, reject) => {
          const readStream = fsSync.createReadStream(sourcePath);
          const writeStream = fsSync.createWriteStream(targetPath);

          let copiedBytes = 0;
          let lastLogTime = Date.now();
          const LOG_INTERVAL_MS = 1000; // Log every second

          readStream.on("data", (chunk: string | Buffer) => {
            copiedBytes += Buffer.isBuffer(chunk)
              ? chunk.length
              : Buffer.byteLength(chunk);
            const now = Date.now();

            if (now - lastLogTime >= LOG_INTERVAL_MS) {
              const progress = ((copiedBytes / totalSize) * 100).toFixed(1);
              const copiedMB = (copiedBytes / (1024 * 1024)).toFixed(2);
              const totalMB = (totalSize / (1024 * 1024)).toFixed(2);
              const elapsed = ((now - startTime) / 1000).toFixed(1);
              log.verbose(
                `Copy progress: ${progress}% (${copiedMB}/${totalMB} MB) — ${elapsed}s elapsed`
              );

              if (onProgress) {
                onProgress({
                  percent: parseFloat(progress),
                  copiedMB: parseFloat(copiedMB),
                  totalMB: parseFloat(totalMB),
                  elapsed: parseFloat(elapsed),
                });
              }

              lastLogTime = now;
            }
          });

          readStream.on("error", reject);
          writeStream.on("error", reject);
          writeStream.on("finish", resolve);

          readStream.pipe(writeStream);
        });

        const duration = ((Date.now() - startTime) / 1000).toFixed(2);
        log.info(`Copied ${formatBytes(totalSize)} in ${duration}s → ${targetPath}`);
        return { success: true, newPath: targetPath };
      } catch (copyErr: any) {
        log.error(`Cross-device copy failed (${sourcePath}):`, copyErr?.message || copyErr);
        return { success: false, message: copyErr?.message || String(copyErr) };
      }
    }
    log.error(`Failed to move ${sourcePath} → ${targetPath}:`, err?.message || err);
    return { success: false, message: err?.message || String(err) };
  }
}
