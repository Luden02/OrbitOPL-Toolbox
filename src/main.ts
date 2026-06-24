import {
  app,
  BrowserWindow,
  dialog,
  globalShortcut,
  ipcMain,
  Menu,
  shell,
} from "electron";
import path from "path";
import * as fs from "fs/promises";
import electronReloader from "electron-reloader";
import PackageInfo from "../package.json";
import {
  checkOplStructure,
  createOplFolders,
  deleteGameAndRelatedFiles,
  downloadArtByGameId,
  getArtFolder,
  getGamesFiles,
  getULGames,
  moveFile,
  openAskDirectory,
  openAskElfFiles,
  openAskGameFiles,
  resolveIsoGameId,
  renameGamefile,
  renamePs1LauncherStep1,
  renamePs1LauncherStep2,
  tryDetermineGameIdFromHex,
  tryDeterminePs1GameIdFromHex,
  tryDeterminePs1GameIdFromVcd,
} from "./library.service";
import { importPs1Game } from "./pops.service";
import { importPs2CdGame } from "./cd.service";
import {
  AppSettings,
  directoryExists,
  getSettings,
  setSetting,
} from "./settings.service";
import { checkForUpdates } from "./update.service";
import { compressIsoToZso } from "./zso.service";
import { GameCfg, readGameCfg, writeGameCfg } from "./cfg.service";
import { checkPopsVmc, createVmc, deleteVmc, listVmc } from "./vmc.service";
import { deleteApp, getApps, getPs1Launchers, importApp, updatePs1TitleCfg } from "./apps.service";
import { createLogger, setLogWindow } from "./logger";

const log = createLogger("main");

const size = { minWidth: 800, minHeight: 600 };

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

  // Forward this window's log entries into the in-app Logs viewer, and stop
  // once it's gone so we never write to a destroyed webContents.
  setLogWindow(win);
  win.on("closed", () => setLogWindow(null));

  win.on("close", (event) => {
    if (!rendererIsLoading || forceCloseRequested) {
      return;
    }
    log.warn("Close requested while an action is still running");
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

  // Safety net: forward any stray console.* output (third-party libs, Electron
  // internals, legacy call sites) into the renderer's Logs viewer. Scoped logs
  // go through ./logger instead, which captured the originals below before this
  // wrapper was installed — so logger entries are never forwarded twice.
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

  log.info(
    `Launching OrbitOPL Toolbox v${PackageInfo.version} (${
      serve ? "dev/serve" : "packaged"
    } mode) on ${process.platform}`
  );

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
    log.verbose("Blocked reload shortcut (Cmd/Ctrl+R)");
  });
  globalShortcut.register("F5", () => {
    log.verbose("Blocked reload shortcut (F5)");
  });
});

app.on("browser-window-blur", function () {
  globalShortcut.unregister("CommandOrControl+R");
  globalShortcut.unregister("F5");
});

// Electron exposed APIs

ipcMain.on("set-loading-state", (_event, isLoading: boolean) => {
  rendererIsLoading = !!isLoading;
  log.verbose(`Renderer loading state -> ${rendererIsLoading ? "busy" : "idle"}`);
});

ipcMain.handle("get-settings", async () => {
  return getSettings();
});

ipcMain.handle(
  "set-setting",
  async <K extends keyof AppSettings>(
    _event: unknown,
    key: K,
    value: AppSettings[K]
  ) => {
    return setSetting(key, value);
  }
);

ipcMain.handle("directory-exists", async (_event, dirPath: string) => {
  return directoryExists(dirPath);
});

ipcMain.handle("check-for-updates", async () => {
  return checkForUpdates();
});

ipcMain.handle("open-external", async (_event, url: string) => {
  // Only allow http(s) links to be opened externally.
  if (/^https?:\/\//i.test(url)) {
    await shell.openExternal(url);
    return true;
  }
  return false;
});

ipcMain.handle("open-ask-directory", async (options) => {
  return openAskDirectory(options);
});

ipcMain.handle("get-games-files", async (event, dirPath: string) => {
  return getGamesFiles(dirPath);
});

ipcMain.handle("check-opl-structure", async (event, dirPath: string) => {
  return checkOplStructure(dirPath);
});

ipcMain.handle(
  "create-opl-folders",
  async (event, dirPath: string, folders: string[]) => {
    return createOplFolders(dirPath, folders);
  }
);

ipcMain.handle("get-ul-games", async (event, dirPath: string) => {
  return getULGames(dirPath);
});

ipcMain.handle("get-art-folder", async (event, dirPath: string) => {
  return getArtFolder(dirPath);
});

ipcMain.handle(
  "rename-gamefile",
  async (
    event,
    dirPath: string,
    gameId: string,
    gameName: string,
    nameOnly?: boolean
  ) => {
    return renameGamefile(dirPath, gameId, gameName, !!nameOnly);
  }
);

ipcMain.handle(
  "rename-ps1-launcher-step1",
  async (
    event,
    vcdPath: string,
    gameId: string,
    newTitle: string
  ) => {
    return renamePs1LauncherStep1(vcdPath, gameId, newTitle, (percent, stage) => {
      event.sender.send("rename-ps1-progress", { percent, stage });
    });
  }
);

ipcMain.handle(
  "rename-ps1-launcher-step2",
  async (
    event,
    params: {
      newAppsFolder: string;
      oldElfFile?: string;
      newElfFile?: string;
      newCfgContent?: string;
      newTitle: string;
    }
  ) => {
    return renamePs1LauncherStep2(params, (percent, stage) => {
      event.sender.send("rename-ps1-progress", { percent, stage });
    });
  }
);

ipcMain.handle(
  "download-art-by-gameid",
  async (event, dirPath: string, gameId: string, system?: "PS1" | "PS2", saveAsName?: string) => {
    return downloadArtByGameId(dirPath, gameId, system || "PS2", saveAsName);
  }
);

ipcMain.handle("check-art-files-exist", async (_event, artDir: string, filenames: string[]) => {
  const existing: string[] = [];
  for (const name of filenames) {
    try {
      await fs.access(path.join(artDir, name));
      existing.push(name);
    } catch {
      // File does not exist — skip.
    }
  }
  return existing;
});

ipcMain.handle("resolve-iso-gameid", async (_event, filepath: string) => {
  return resolveIsoGameId(filepath);
});

ipcMain.handle(
  "try-determine-gameid-from-hex",
  async (event, filepath: string) => {
    const result = await tryDetermineGameIdFromHex(filepath);
    return result;
  }
);

ipcMain.handle(
  "open-ask-game-files",
  async (event, isGameCd: boolean, isGameDvd: boolean) => {
    return openAskGameFiles(isGameCd, isGameDvd);
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
    elfPrefix: string,
    downloadArtwork: boolean
  ) => {
    return importPs1Game(
      cueFilePath,
      oplRoot,
      elfPrefix,
      downloadArtwork,
      (percent, stage) => {
        event.sender.send("ps1-import-progress", { percent, stage });
      }
    );
  }
);

ipcMain.handle(
  "compress-iso-to-zso",
  async (
    event,
    isoPath: string,
    zsoPath: string,
    deleteOriginal: boolean
  ) => {
    return compressIsoToZso(isoPath, zsoPath, deleteOriginal, (percent, stage) => {
      event.sender.send("zso-compress-progress", { percent, stage });
    });
  }
);

ipcMain.handle(
  "read-game-cfg",
  async (_event, oplRoot: string, gameId: string) => {
    return readGameCfg(oplRoot, gameId);
  }
);

ipcMain.handle(
  "write-game-cfg",
  async (_event, oplRoot: string, gameId: string, entries: GameCfg) => {
    return writeGameCfg(oplRoot, gameId, entries);
  }
);

ipcMain.handle("get-apps", async (_event, oplRoot: string) => {
  return getApps(oplRoot);
});

ipcMain.handle("get-ps1-launchers", async (_event, oplRoot: string) => {
  return getPs1Launchers(oplRoot);
});

ipcMain.handle(
  "update-ps1-title-cfg",
  async (_event, launcherPath: string, newTitle: string, gameId?: string) => {
    return updatePs1TitleCfg(launcherPath, newTitle, gameId);
  }
);

ipcMain.handle("try-determine-ps1-gameid-from-vcd", async (_event, filepath: string) => {
  return tryDeterminePs1GameIdFromVcd(filepath);
});

ipcMain.handle("open-ask-elf-files", async () => {
  return openAskElfFiles();
});

ipcMain.handle(
  "import-app",
  async (_event, oplRoot: string, elfPath: string, title: string) => {
    return importApp(oplRoot, elfPath, title);
  }
);

ipcMain.handle("delete-app", async (_event, oplRoot: string, folder: string) => {
  return deleteApp(oplRoot, folder);
});

ipcMain.handle("list-vmc", async (_event, oplRoot: string) => {
  return listVmc(oplRoot);
});

ipcMain.handle("check-pops-vmc", async (_event, oplRoot: string, gameTitle: string) => {
  return checkPopsVmc(oplRoot, gameTitle);
});

ipcMain.handle(
  "create-vmc",
  async (_event, oplRoot: string, name: string, sizeMb: number) => {
    return createVmc(oplRoot, name, sizeMb);
  }
);

ipcMain.handle("delete-vmc", async (_event, oplRoot: string, name: string) => {
  return deleteVmc(oplRoot, name);
});

ipcMain.handle(
  "delete-game-and-related-files",
  async (_event, gamePath: string, artDir: string, gameId: string, launcherFolder?: string) => {
    return deleteGameAndRelatedFiles(gamePath, artDir, gameId, launcherFolder);
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
