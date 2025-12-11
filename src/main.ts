import { app, BrowserWindow, globalShortcut, ipcMain, Menu } from "electron";
import path from "path";
import electronReloader from "electron-reloader";
import PackageInfo from "../package.json";
import {
  convertBinToIso,
  downloadArtByGameId,
  getArtFolder,
  getGamesFiles,
  moveFile,
  openAskDirectory,
  openAskGameFile,
  renameGamefile,
  tryDetermineGameIdFromHex,
} from "./library.service";

const size = { minWidth: 1280, minHeight: 720 };

function createWindow() {
  const win = new BrowserWindow({
    width: size.minWidth,
    height: size.minHeight,
    minWidth: size.minWidth,
    minHeight: size.minHeight,
    title: `OrbitOPL Toolbox (${PackageInfo.version})`,
    icon: path.join(__dirname, "assets", "applogo", "icon_512x512.png"),
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
    },
  });

  win.removeMenu();
  Menu.setApplicationMenu(
    Menu.buildFromTemplate([
      {
        label: "OrbitOPL Toolbox",
        submenu: [
          {
            label: "Quit",
            accelerator: "CmdOrCtrl+Q",
            click: () => {
              app.quit();
            },
          },
        ],
      },
    ])
  );

  const args = process.argv.slice(1);
  const serve = args.includes("--serve");

  if (serve) {
    electronReloader(module);
    win.loadURL("http://localhost:4200");
    win.webContents.openDevTools();
  } else {
    win.loadFile(
      path.join(__dirname, "..", "angular", "browser", "index.html")
    );
  }
}

app.whenReady().then(createWindow);

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit();
  }
});

app.on("activate", () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    createWindow();
  }
});

app.on("browser-window-focus", function () {
  globalShortcut.register("CommandOrControl+R", () => {
    console.log("CommandOrControl+R is pressed: Shortcut Disabled");
  });
  globalShortcut.register("F5", () => {
    console.log("F5 is pressed: Shortcut Disabled");
  });
});

app.on("browser-window-blur", function () {
  globalShortcut.unregister("CommandOrControl+R");
  globalShortcut.unregister("F5");
});

// Electron exposed APIs

ipcMain.handle("open-ask-directory", async (options) => {
  return openAskDirectory(options);
});

ipcMain.handle("get-games-files", async (event, dirPath: string) => {
  return getGamesFiles(dirPath);
});

ipcMain.handle("get-art-folder", async (event, dirPath: string) => {
  return getArtFolder(dirPath);
});

ipcMain.handle(
  "rename-gamefile",
  async (event, dirPath: string, gameId: string, gameName: string) => {
    return renameGamefile(dirPath, gameId, gameName);
  }
);

ipcMain.handle(
  "download-art-by-gameid",
  async (event, dirPath: string, gameId: string) => {
    return downloadArtByGameId(dirPath, gameId);
  }
);

ipcMain.handle(
  "try-determine-gameid-from-hex",
  async (event, filepath: string) => {
    const result = await tryDetermineGameIdFromHex(filepath);
    return result;
  }
);

ipcMain.handle(
  "convert-bin-to-iso",
  async (event, cueFilePath: string, outputDir: string) => {
    return convertBinToIso(cueFilePath, outputDir);
  }
);

ipcMain.handle(
  "open-ask-game-file",
  async (event, isGameCd: boolean, isGameDvd: boolean) => {
    return openAskGameFile(isGameCd, isGameDvd);
  }
);

ipcMain.handle(
  "move-file",
  async (event, sourcePath: string, destPath: string) => {
    return moveFile(sourcePath, destPath, (progress) => {
      // Send progress updates to the renderer process
      event.sender.send("move-file-progress", progress);
    });
  }
);
