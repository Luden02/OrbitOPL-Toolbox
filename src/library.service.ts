import { dialog } from "electron";
import * as fs from "fs/promises";
import path from "path";
import https from "https";

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
