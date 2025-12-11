import { dialog, OpenDialogOptions } from "electron";
import * as fs from "fs/promises";
import * as fsSync from "fs";
import path from "path";
import https from "https";

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
    const [items_cd, items_dvd] = await Promise.all([
      fs.readdir(path.join(dirPath, "CD"), { withFileTypes: true }),
      fs.readdir(path.join(dirPath, "DVD"), { withFileTypes: true }),
    ]);
    // Only include files, skip directories
    const items = [
      ...items_cd.map((item) =>
        Object.assign(item, { parentDir: dirPath + "/CD" })
      ),
      ...items_dvd.map((item) =>
        Object.assign(item, { parentDir: dirPath + "/DVD" })
      ),
    ].filter(
      (item) =>
        item.isFile() &&
        !item.name.startsWith(".") &&
        (item.name.endsWith(".iso") || item.name.endsWith(".zso"))
    );

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
          return {
            name: path.parse(item.name).name,
            extension: path.extname(item.name),
            path: filePath,
            gameId: item.name.split("_")[0] + "_" + item.name.split("_")[1],
            type: item.name.split("_")[2]?.split(".")[0] || "",
            base64: fileBuffer.toString("base64"),
          };
        })
    );
    return { success: true, data: artFiles };
  } catch (err) {
    return { success: false, message: err };
  }
}

export async function downloadArtByGameId(dirPath: string, gameId: string) {
  const baseUrl =
    "https://raw.githubusercontent.com/Luden02/psx-ps2-opl-art-database/refs/heads/main/PS2";
  const types = ["COV", "ICO", "SCR"];
  const results: any[] = [];

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

      const savePath = path.join(dirPath, `${gameId}_${type}.png`);
      await fs.writeFile(savePath, buffer);
      results.push({
        name: gameId,
        type,
        url,
        savedPath: savePath,
      });
    } catch (err: any) {
      results.push({
        name: gameId,
        type,
        url,
        error: err.message,
      });
    }
  }

  return { success: true, data: results };
}

export async function renameGamefile(
  dirpath: string,
  gameId: string,
  gameName: string
) {
  console.log(dirpath, gameId, gameName);
  const ext = path.extname(dirpath);
  const parentDir = path.dirname(dirpath);
  const newFileName = `${gameId}.${gameName}${ext}`;
  const newFilePath = path.join(parentDir, newFileName);

  try {
    await fs.rename(dirpath, newFilePath);
    return { success: true, newPath: newFilePath };
  } catch (err) {
    return { success: false, message: err };
  }
}

export async function tryDetermineGameIdFromHex(filepath: string) {
  let fileHandle: fs.FileHandle | undefined;

  try {
    fileHandle = await fs.open(filepath, "r");
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
