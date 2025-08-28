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
});
