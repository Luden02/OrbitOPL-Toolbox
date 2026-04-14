declare interface Window {
  libraryAPI: {
    openAskDirectory: () => Promise<any>;
    getGamesFiles: (dirPath: string) => Promise<any>;
    getULGames: (dirPath: string) => Promise<any>;
    getArtFolder: (dirPath: string) => Promise<any>;
    renameGamefile: (
      dirPath: string,
      gameId: string,
      gameName: string
    ) => Promise<any>;
    downloadArtByGameId: (
      dirPath: string,
      gameId: string,
      system?: 'PS1' | 'PS2'
    ) => Promise<any>;
    tryDetermineGameIdFromHex: (filepath: string) => Promise<any>;
    convertBinToIso: (cueFilePath: string, outputDir: string) => Promise<any>;
    openAskGameFile: (isGameCd: boolean, isGameDvd: boolean) => Promise<any>;
    tryDeterminePs1GameIdFromHex: (filepath: string) => Promise<any>;
    importPs1Game: (
      cueFilePath: string,
      oplRoot: string,
      elfPrefix: string,
      downloadArtwork: boolean
    ) => Promise<any>;
    onPs1ImportProgress: (
      callback: (progress: { percent: number; stage: string }) => void
    ) => void;
    removeAllPs1ImportProgressListeners: () => void;
    importPs2CdGame: (
      cueFilePath: string,
      oplRoot: string,
      gameId: string | undefined,
      gameName: string | undefined,
      downloadArtwork: boolean
    ) => Promise<any>;
    onPs2CdImportProgress: (
      callback: (progress: { percent: number; stage: string }) => void
    ) => void;
    removeAllPs2CdImportProgressListeners: () => void;
    deleteGameAndRelatedFiles: (
      gamePath: string,
      artDir: string,
      gameId: string
    ) => Promise<any>;
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
    onMainLog: (
      callback: (entry: {
        level: string;
        message: string;
        timestamp: string;
      }) => void
    ) => void;
    removeAllMainLogListeners: () => void;
    setLoadingState: (isLoading: boolean) => void;
  };
}
