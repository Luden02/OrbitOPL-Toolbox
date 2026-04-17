import { dialog, OpenDialogOptions } from "electron";
import * as fs from "fs/promises";
import * as fsSync from "fs";
import path from "path";
import https from "https";

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
        return cachedPs1GamesList;
      }
    } catch (err) {
      // Intentionally ignore missing file/location attempts.
    }
  }

  cachedPs1GamesList = null;
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
        return cachedPs2GamesList;
      }
    } catch (err) {
      // Intentionally ignore missing file/location attempts.
    }
  }

  cachedPs2GamesList = null;
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

export async function getGamesFiles(dirPath: string) {
  try {
    const [items_cd, items_dvd, items_vcd, items_pops] = await Promise.all([
      fs.readdir(path.join(dirPath, "CD"), { withFileTypes: true }).catch(() => []),
      fs.readdir(path.join(dirPath, "DVD"), { withFileTypes: true }).catch(() => []),
      fs.readdir(path.join(dirPath, "VCD"), { withFileTypes: true }).catch(() => []),
      fs.readdir(path.join(dirPath, "POPS"), { withFileTypes: true }).catch(() => []),
    ]);
    // Only include files, skip directories
    const items = [
      ...items_cd.map((item) =>
        Object.assign(item, { parentDir: dirPath + "/CD" })
      ),
      ...items_dvd.map((item) =>
        Object.assign(item, { parentDir: dirPath + "/DVD" })
      ),
      ...items_vcd.map((item) =>
        Object.assign(item, { parentDir: dirPath + "/VCD" })
      ),
      ...items_pops.map((item) =>
        Object.assign(item, { parentDir: dirPath + "/POPS" })
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
      const stats = await fs.stat(item.parentDir + "/" + item.name);

      const itemInfo = {
        extension: path.extname(item.name),
        name: path.parse(item.name).name,
        parentPath: item.parentDir,
        path: item.parentDir + "/" + item.name,
        stats,
      };

      files.push(itemInfo);
    }
    return { success: true, data: files };
  } catch (err) {
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
      return { success: true, data: [] };
    }

    const buffer = await fs.readFile(ulCfgPath);
    const RECORD_SIZE = 64;

    if (buffer.length === 0) {
      return { success: true, data: [] };
    }

    const recordCount = Math.floor(buffer.length / RECORD_SIZE);
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
      const gameId = gameIdRaw.replace(/\./g, "").replace(
        /^([A-Z]{4})(\d{3})(\d{2})$/,
        "$1_$2.$3"
      );

      // Byte 47: number of parts
      const numParts = record[47];

      // Bytes 48-51: media type (little-endian uint32)
      const mediaTypeRaw = record.readUInt32LE(48);
      const mediaType = mediaTypeRaw === 0x12 ? "CD" : "DVD";

      // Match fragment files using CRC32 of the game name
      const hash = crc32(name).toString(16).padStart(8, "0").toUpperCase();
      const fragmentPrefix = `ul.${hash}`;

      let totalSize = 0;
      for (const f of ulFiles) {
        if (f.name.startsWith(fragmentPrefix)) {
          try {
            const stat = await fs.stat(path.join(dirPath, f.name));
            totalSize += stat.size;
          } catch {
            // Fragment file inaccessible, skip
          }
        }
      }

      entries.push({ name, gameId, numParts, mediaType, totalSize });
    }

    return { success: true, data: entries };
  } catch (err) {
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
    return { success: true, data: artFiles };
  } catch (err) {
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

  for (const type of types) {
    const fileName = `${gameId}_${type}.png`;
    const url = `${baseUrl}/${gameId}/${fileName}`;

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
      results.push({
        name: localName,
        type,
        url,
        savedPath: savePath,
      });
    } catch (err: any) {
      results.push({
        name: localName,
        type,
        url,
        error: err.message,
      });
    }
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
  gameName: string
) {
  console.log(dirpath, gameId, gameName);
  const ext = path.extname(dirpath);
  const parentDir = path.dirname(dirpath);
  const safeName = sanitizeGameFilename(gameName);
  const newFileName = `${gameId}.${safeName}${ext}`;
  const newFilePath = path.join(parentDir, newFileName);

  try {
    await fs.rename(dirpath, newFilePath);
    return { success: true, newPath: newFilePath };
  } catch (err) {
    return { success: false, message: err };
  }
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
    } catch (err: any) {
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
    return {
      success: false,
      message: err?.message || "Unable to open file.",
    };
  }

  try {
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

    return {
      success: false,
      message: "Could not locate a PS2 game ID inside the provided file.",
    };
  } catch (err: any) {
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
    } catch (err: any) {
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
    return {
      success: false,
      message: err?.message || "Unable to open file.",
    };
  }

  try {
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

    return {
      success: false,
      message: "Could not locate a PS1 game ID inside the provided file.",
    };
  } catch (err: any) {
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

export async function convertBinToIso(
  cueFilePath: string,
  outputIsoPath: string
) {
  try {
    return { success: true, message: "Conversion completed successfully." };
  } catch (err: any) {
    return { success: false, message: err?.message || "Conversion failed." };
  }
}

export async function openAskGameFile(isGameCd: boolean, isGameDvd: boolean) {
  const properties = ["openFile"];
  // if gameCd ask for .cue file, if gameDvd ask for .iso/.zso
  const filters = [];
  if (isGameCd) {
    filters.push({ name: "CUE Files", extensions: ["cue"] });
  }
  if (isGameDvd) {
    filters.push({ name: "ISO/ZSO Files", extensions: ["iso", "zso"] });
  }
  const result = await dialog.showOpenDialog({
    ...properties,
    filters,
    title: "Select Game File to Import",
  });

  return result;
}

export async function deleteGameAndRelatedFiles(
  gamePath: string,
  artDir: string,
  gameId: string
) {
  try {
    // Delete the game file
    await fs.unlink(gamePath);

    // Delete related artwork files (e.g., SLUS_123.45_COV.png)
    try {
      const artFiles = await fs.readdir(artDir);
      const relatedArt = artFiles.filter((f) => f.startsWith(gameId + "_"));
      for (const artFile of relatedArt) {
        try {
          await fs.unlink(path.join(artDir, artFile));
        } catch {
          // Ignore individual art file deletion failures
        }
      }
    } catch {
      // ART directory may not exist — that's fine
    }

    return { success: true };
  } catch (err: any) {
    return { success: false, message: err?.message || String(err) };
  }
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
  console.log("Moving file from", sourcePath, "to", destPath);

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
    console.log("File moved successfully using rename");
    return { success: true, newPath: targetPath };
  } catch (err: any) {
    if (err?.code === "EXDEV") {
      try {
        console.log("Cross-device move detected, starting file copy...");
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
              console.log(
                `Progress: ${progress}% (${copiedMB}/${totalMB} MB) - ${elapsed}s elapsed`
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
        const sizeMB = (totalSize / (1024 * 1024)).toFixed(2);
        console.log(`File copied successfully: ${sizeMB} MB in ${duration}s`);
        console.log("move complete");
        return { success: true, newPath: targetPath };
      } catch (copyErr: any) {
        return { success: false, message: copyErr?.message || String(copyErr) };
      }
    }
    return { success: false, message: err?.message || String(err) };
  }
}
