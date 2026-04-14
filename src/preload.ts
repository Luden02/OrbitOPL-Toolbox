import { contextBridge, ipcRenderer } from "electron";
import { downloadArtByGameId, getArtFolder } from "./library.service";

contextBridge.exposeInMainWorld("libraryAPI", {
  openAskDirectory: () => ipcRenderer.invoke("open-ask-directory"),
  getGamesFiles: (dirPath: string) =>
    ipcRenderer.invoke("get-games-files", dirPath),
  getULGames: (dirPath: string) =>
    ipcRenderer.invoke("get-ul-games", dirPath),
  getArtFolder: (dirPath: string) =>
    ipcRenderer.invoke("get-art-folder", dirPath),
  renameGamefile: (dirPath: string, gameId: string, gameName: string) =>
    ipcRenderer.invoke("rename-gamefile", dirPath, gameId, gameName),
  downloadArtByGameId: (
    dirPath: string,
    gameId: string,
    system?: "PS1" | "PS2"
  ) => ipcRenderer.invoke("download-art-by-gameid", dirPath, gameId, system),
  tryDetermineGameIdFromHex: (filepath: string) =>
    ipcRenderer.invoke("try-determine-gameid-from-hex", filepath),
  convertBinToIso: (cueFilePath: string, outputDir: string) =>
    ipcRenderer.invoke("convert-bin-to-iso", cueFilePath, outputDir),
  openAskGameFile: (isGameCd: boolean, isGameDvd: boolean) =>
    ipcRenderer.invoke("open-ask-game-file", isGameCd, isGameDvd),
  tryDeterminePs1GameIdFromHex: (filepath: string) =>
    ipcRenderer.invoke("try-determine-ps1-gameid-from-hex", filepath),
  importPs1Game: (
    cueFilePath: string,
    oplRoot: string,
    elfPrefix: string,
    downloadArtwork: boolean
  ) =>
    ipcRenderer.invoke(
      "import-ps1-game",
      cueFilePath,
      oplRoot,
      elfPrefix,
      downloadArtwork
    ),
  importPs2CdGame: (
    cueFilePath: string,
    oplRoot: string,
    gameId: string | undefined,
    gameName: string | undefined,
    downloadArtwork: boolean
  ) =>
    ipcRenderer.invoke(
      "import-ps2-cd-game",
      cueFilePath,
      oplRoot,
      gameId,
      gameName,
      downloadArtwork
    ),
  onPs2CdImportProgress: (
    callback: (progress: { percent: number; stage: string }) => void
  ) => {
    ipcRenderer.on("ps2-cd-import-progress", (_event, progress) =>
      callback(progress)
    );
  },
  removeAllPs2CdImportProgressListeners: () => {
    ipcRenderer.removeAllListeners("ps2-cd-import-progress");
  },
  onPs1ImportProgress: (
    callback: (progress: { percent: number; stage: string }) => void
  ) => {
    ipcRenderer.on("ps1-import-progress", (_event, progress) =>
      callback(progress)
    );
  },
  removeAllPs1ImportProgressListeners: () => {
    ipcRenderer.removeAllListeners("ps1-import-progress");
  },
  deleteGameAndRelatedFiles: (
    gamePath: string,
    artDir: string,
    gameId: string
  ) =>
    ipcRenderer.invoke(
      "delete-game-and-related-files",
      gamePath,
      artDir,
      gameId
    ),
  moveFile: (sourcePath: string, destPath: string) =>
    ipcRenderer.invoke("move-file", sourcePath, destPath),
  onMoveFileProgress: (callback: (progress: any) => void) => {
    ipcRenderer.on("move-file-progress", (event, progress) =>
      callback(progress)
    );
  },
  removeAllMoveFileProgressListeners: () => {
    ipcRenderer.removeAllListeners("move-file-progress");
  },
  onMainLog: (
    callback: (entry: {
      level: string;
      message: string;
      timestamp: string;
    }) => void
  ) => {
    ipcRenderer.on("main-log", (_event, entry) => callback(entry));
  },
  removeAllMainLogListeners: () => {
    ipcRenderer.removeAllListeners("main-log");
  },
  setLoadingState: (isLoading: boolean) =>
    ipcRenderer.send("set-loading-state", isLoading),
});
