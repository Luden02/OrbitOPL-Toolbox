import { app, BrowserWindow, dialog, globalShortcut, ipcMain, Menu } from "electron";
import path from "path";
import electronReloader from "electron-reloader";
import PackageInfo from "../package.json";
import {
  convertBinToIso,
  deleteGameAndRelatedFiles,
  downloadArtByGameId,
  getArtFolder,
  getGamesFiles,
  getULGames,
  moveFile,
  openAskDirectory,
  openAskGameFile,
  renameGamefile,
  tryDetermineGameIdFromHex,
  tryDeterminePs1GameIdFromHex,
} from "./library.service";
import { importPs1Game } from "./pops.service";
import { importPs2CdGame } from "./cd.service";

const size = { minWidth: 1280, minHeight: 720 };

// Tracks whether the renderer has a long-running action in progress.
// Updated via the "set-loading-state" IPC channel from LibraryService.
let rendererIsLoading = false;
let forceCloseRequested = false;

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

  win.on("close", (event) => {
    if (!rendererIsLoading || forceCloseRequested) {
      return;
    }
    event.preventDefault();
    const choice = dialog.showMessageBoxSync(win, {
      type: "warning",
      buttons: ["Cancel", "Close anyway"],
      defaultId: 0,
      cancelId: 0,
      title: "Action in progress",
      message:
        "An action is still running. Closing now may leave files in an inconsistent state.",
      detail: "Do you want to close the application anyway?",
    });
    if (choice === 1) {
      forceCloseRequested = true;
      win.destroy();
    }
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

  // Forward main process console output to renderer
  const origLog = console.log;
  const origError = console.error;
  const origWarn = console.warn;

  const sendLog = (level: string, args: any[]) => {
    try {
      if (win && !win.isDestroyed()) {
        win.webContents.send("main-log", {
          level,
          message: args.map((a) => (typeof a === "string" ? a : JSON.stringify(a))).join(" "),
          timestamp: new Date().toISOString(),
        });
      }
    } catch {
      // Ignore errors during log forwarding
    }
  };

  console.log = (...args: any[]) => {
    origLog.apply(console, args);
    sendLog("INF", args);
  };
  console.error = (...args: any[]) => {
    origError.apply(console, args);
    sendLog("ERR", args);
  };
  console.warn = (...args: any[]) => {
    origWarn.apply(console, args);
    sendLog("INF", args);
  };

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

ipcMain.on("set-loading-state", (_event, isLoading: boolean) => {
  rendererIsLoading = !!isLoading;
});

ipcMain.handle("open-ask-directory", async (options) => {
  return openAskDirectory(options);
});

ipcMain.handle("get-games-files", async (event, dirPath: string) => {
  return getGamesFiles(dirPath);
});

ipcMain.handle("get-ul-games", async (event, dirPath: string) => {
  return getULGames(dirPath);
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
  async (event, dirPath: string, gameId: string, system?: "PS1" | "PS2") => {
    return downloadArtByGameId(dirPath, gameId, system || "PS2");
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
  "try-determine-ps1-gameid-from-hex",
  async (event, filepath: string) => {
    return tryDeterminePs1GameIdFromHex(filepath);
  }
);

ipcMain.handle(
  "import-ps2-cd-game",
  async (
    event,
    cueFilePath: string,
    oplRoot: string,
    gameId: string | undefined,
    gameName: string | undefined,
    downloadArtwork: boolean
  ) => {
    return importPs2CdGame(
      cueFilePath,
      oplRoot,
      gameId,
      gameName,
      downloadArtwork,
      (percent, stage) => {
        event.sender.send("ps2-cd-import-progress", { percent, stage });
      }
    );
  }
);

ipcMain.handle(
  "import-ps1-game",
  async (
    event,
    cueFilePath: string,
    oplRoot: string,
    updateConfApps: boolean,
    downloadArtwork: boolean
  ) => {
    return importPs1Game(
      cueFilePath,
      oplRoot,
      updateConfApps,
      downloadArtwork,
      (percent, stage) => {
        event.sender.send("ps1-import-progress", { percent, stage });
      }
    );
  }
);

ipcMain.handle(
  "delete-game-and-related-files",
  async (_event, gamePath: string, artDir: string, gameId: string) => {
    return deleteGameAndRelatedFiles(gamePath, artDir, gameId);
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
