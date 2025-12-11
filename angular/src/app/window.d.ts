declare interface Window {
  libraryAPI: {
    openAskDirectory: () => Promise<any>;
    getGamesFiles: (dirPath: string) => Promise<any>;
    getArtFolder: (dirPath: string) => Promise<any>;
    renameGamefile: (
      dirPath: string,
      gameId: string,
      gameName: string
    ) => Promise<any>;
    downloadArtByGameId: (dirPath: string, gameId: string) => Promise<any>;
    tryDetermineGameIdFromHex: (filepath: string) => Promise<any>;
    convertBinToIso: (cueFilePath: string, outputDir: string) => Promise<any>;
    openAskGameFile: (isGameCd: boolean, isGameDvd: boolean) => Promise<any>;
    moveFile: (sourcePath: string, destPath: string) => Promise<any>;
    onMoveFileProgress: (
      callback: (progress: {
        percent: number;
        copiedMB: number;
        totalMB: number;
        elapsed: number;
      }) => void
    ) => void;
    removeAllMoveFileProgressListeners: () => void;
  };
}
