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
  };
}
