declare interface Window {
  libraryAPI: {
    openAskDirectory: () => Promise<any>;
    getGamesFiles: (dirPath: string) => Promise<any>;
    checkOplStructure: (dirPath: string) => Promise<{
      success: boolean;
      existing?: string[];
      missing?: string[];
      message?: string;
    }>;
    createOplFolders: (
      dirPath: string,
      folders: string[],
    ) => Promise<{ success: boolean; created?: string[]; message?: string }>;
    getULGames: (dirPath: string) => Promise<any>;
    getArtFolder: (dirPath: string) => Promise<any>;
    renameGamefile: (
      dirPath: string,
      gameId: string,
      gameName: string,
      nameOnly?: boolean,
    ) => Promise<any>;
    renamePs1LauncherStep1: (
      vcdPath: string,
      gameId: string,
      newTitle: string,
    ) => Promise<{
      success: boolean;
      newVcdPath?: string;
      oldElfFile?: string;
      newElfFile?: string;
      newCfgContent?: string;
      newAppsFolder?: string;
      safeNewTitle?: string;
      message?: string;
    }>;
    renamePs1LauncherStep2: (params: {
      newAppsFolder: string;
      oldElfFile?: string;
      newElfFile?: string;
      newCfgContent?: string;
      newTitle: string;
    }) => Promise<{ success: boolean; message?: string }>;
    onRenamePs1Progress: (
      callback: (progress: { percent: number; stage: string }) => void,
    ) => void;
    removeAllRenamePs1ProgressListeners: () => void;
    downloadArtByGameId: (
      dirPath: string,
      gameId: string,
      system?: 'PS1' | 'PS2',
      saveAsName?: string,
    ) => Promise<any>;
    checkArtFilesExist: (
      artDir: string,
      filenames: string[],
    ) => Promise<string[]>;
    tryDetermineGameIdFromHex: (filepath: string) => Promise<any>;
    resolveIsoGameId: (filepath: string) => Promise<{
      success: boolean;
      gameId?: string;
      gameName?: string;
      message?: string;
    }>;
    openAskGameFiles: (isGameCd: boolean, isGameDvd: boolean) => Promise<any>;
    tryDeterminePs1GameIdFromHex: (filepath: string) => Promise<any>;
    tryDeterminePs1GameIdFromVcd: (filepath: string) => Promise<{
      success: boolean;
      gameId?: string;
      formattedGameId?: string;
      gameName?: string;
      message?: string;
    }>;
    importPs1Game: (
      cueFilePath: string,
      oplRoot: string,
      elfPrefix: string,
      downloadArtwork: boolean,
    ) => Promise<any>;
    onPs1ImportProgress: (
      callback: (progress: { percent: number; stage: string }) => void,
    ) => void;
    removeAllPs1ImportProgressListeners: () => void;
    importPs2CdGame: (
      cueFilePath: string,
      oplRoot: string,
      gameId: string | undefined,
      gameName: string | undefined,
      downloadArtwork: boolean,
    ) => Promise<any>;
    onPs2CdImportProgress: (
      callback: (progress: { percent: number; stage: string }) => void,
    ) => void;
    removeAllPs2CdImportProgressListeners: () => void;
    compressIsoToZso: (
      isoPath: string,
      zsoPath: string,
      deleteOriginal: boolean,
    ) => Promise<any>;
    onZsoCompressProgress: (
      callback: (progress: { percent: number; stage: string }) => void,
    ) => void;
    removeAllZsoCompressProgressListeners: () => void;
    getApps: (oplRoot: string) => Promise<{
      success: boolean;
      apps: {
        folder: string;
        title: string;
        boot: string;
        path: string;
        sizeBytes: number;
      }[];
      message?: string;
    }>;
    getPs1Launchers: (oplRoot: string) => Promise<{
      success: boolean;
      launchers: {
        folder: string;
        title: string;
        boot: string;
        path: string;
        sizeBytes: number;
      }[];
      message?: string;
    }>;
    updatePs1TitleCfg: (
      launcherPath: string,
      newTitle: string,
    ) => Promise<{ success: boolean; message?: string }>;
    openAskElfFiles: () => Promise<any>;
    importApp: (
      oplRoot: string,
      elfPath: string,
      title: string,
    ) => Promise<{ success: boolean; folder?: string; message?: string }>;
    deleteApp: (
      oplRoot: string,
      folder: string,
    ) => Promise<{ success: boolean; message?: string }>;
    listVmc: (oplRoot: string) => Promise<{
      success: boolean;
      cards: { name: string; sizeBytes: number; sizeMb: number }[];
      message?: string;
    }>;
    checkPopsVmc: (
      oplRoot: string,
      gameTitle: string,
    ) => Promise<{
      success: boolean;
      slot0: string | null;
      slot1: string | null;
    }>;
    createVmc: (
      oplRoot: string,
      name: string,
      sizeMb: number,
    ) => Promise<{ success: boolean; name?: string; message?: string }>;
    deleteVmc: (
      oplRoot: string,
      name: string,
    ) => Promise<{ success: boolean; message?: string }>;
    readGameCfg: (
      oplRoot: string,
      gameId: string,
    ) => Promise<{
      success: boolean;
      entries: Record<string, string>;
      message?: string;
    }>;
    writeGameCfg: (
      oplRoot: string,
      gameId: string,
      entries: Record<string, string>,
    ) => Promise<{ success: boolean; message?: string }>;
    deleteGameAndRelatedFiles: (
      gamePath: string,
      artDir: string,
      gameId: string,
      launcherFolder?: string,
    ) => Promise<any>;
    moveFile: (sourcePath: string, destPath: string) => Promise<any>;
    onMoveFileProgress: (
      callback: (progress: {
        percent: number;
        copiedMB: number;
        totalMB: number;
        elapsed: number;
      }) => void,
    ) => void;
    removeAllMoveFileProgressListeners: () => void;
    onMainLog: (
      callback: (entry: {
        level: string;
        location?: string;
        message: string;
        timestamp: string;
      }) => void,
    ) => void;
    removeAllMainLogListeners: () => void;
    setLoadingState: (isLoading: boolean) => void;
    getSettings: () => Promise<AppSettings>;
    setSetting: <K extends keyof AppSettings>(
      key: K,
      value: AppSettings[K],
    ) => Promise<AppSettings>;
    directoryExists: (dirPath: string) => Promise<boolean>;
    checkForUpdates: () => Promise<UpdateCheckResult>;
    openExternal: (url: string) => Promise<boolean>;
  };
}

declare interface UpdateCheckResult {
  updateAvailable: boolean;
  currentVersion: string;
  latestVersion?: string;
  releaseUrl?: string;
  releaseName?: string;
  error?: string;
}

declare interface AppSettings {
  lastDirectory?: string;
  autoReconnect: boolean;
}
