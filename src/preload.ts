import { contextBridge, ipcRenderer } from "electron";
import { downloadArtByGameId, getArtFolder } from "./library.service";

contextBridge.exposeInMainWorld("libraryAPI", {
  openAskDirectory: () => ipcRenderer.invoke("open-ask-directory"),
  getGamesFiles: (dirPath: string) =>
    ipcRenderer.invoke("get-games-files", dirPath),
  getArtFolder: (dirPath: string) =>
    ipcRenderer.invoke("get-art-folder", dirPath),
  renameGamefile: (dirPath: string, gameId: string, gameName: string) =>
    ipcRenderer.invoke("rename-gamefile", dirPath, gameId, gameName),
  downloadArtByGameId: (dirPath: string, gameId: string) =>
    ipcRenderer.invoke("download-art-by-gameid", dirPath, gameId),
  tryDetermineGameIdFromHex: (filepath: string) =>
    ipcRenderer.invoke("try-determine-gameid-from-hex", filepath),
  convertBinToIso: (cueFilePath: string, outputDir: string) =>
    ipcRenderer.invoke("convert-bin-to-iso", cueFilePath, outputDir),
  openAskGameFile: (isGameCd: boolean, isGameDvd: boolean) =>
    ipcRenderer.invoke("open-ask-game-file", isGameCd, isGameDvd),
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
});
