import { Injectable } from '@angular/core';
import { LogsService } from './logs.service';
import { SettingsService } from './settings.service';
import { BehaviorSubject, map, Observable } from 'rxjs';
import { Game, GameFormat, RawGameFile } from '../types/game.type';

@Injectable({
  providedIn: 'root',
})
export class LibraryService {
  private librarySubject = new BehaviorSubject<Game[]>([]);
  public get library$(): Observable<Game[]> {
    return this.librarySubject.asObservable();
  }

  public get totalCdTypeCd$(): Observable<number> {
    return this.countGamesByCdType$('CD');
  }

  public get totalCdTypeDvd$(): Observable<number> {
    return this.countGamesByCdType$('DVD');
  }

  public get totalInvalidFiles$(): Observable<number> {
    return this.invalidFilesCount();
  }

  private invalidFilesSubject = new BehaviorSubject<any[]>([]);
  public get invalidFiles$(): Observable<any[]> {
    return this.invalidFilesSubject.asObservable();
  }

  private loadingSubject = new BehaviorSubject<boolean>(false);
  public get loading$(): Observable<boolean> {
    return this.loadingSubject.asObservable();
  }
  public setLoading(isLoading: boolean) {
    this.loadingSubject.next(isLoading);
    // Keep the Electron main process in sync so it can guard window close
    // against in-progress actions.
    try {
      window.libraryAPI?.setLoadingState?.(isLoading);
    } catch {
      // Ignore — setLoading may run before the preload bridge is ready.
    }
  }

  private currentActionSubject = new BehaviorSubject<string | undefined>(
    undefined
  );
  public get currentAction$(): Observable<string | undefined> {
    return this.currentActionSubject.asObservable();
  }
  public setCurrentAction(action: string | undefined) {
    this.currentActionSubject.next(action);
  }

  private currentDirectory: string | undefined;
  private currentDirectorySubject = new BehaviorSubject<string | undefined>(
    undefined
  );
  public get currentDirectory$(): Observable<string | undefined> {
    return this.currentDirectorySubject.asObservable();
  }

  public get librarySizeGb$(): Observable<number> {
    return this.library$.pipe(
      map((games) =>
        games.reduce((total, game) => total + this.parseSizeToGb(game.size), 0)
      ),
      map((size) => Number(size.toFixed(2)))
    );
  }

  public get hasCurrentDirectory$(): Observable<boolean> {
    return this.currentDirectorySubject
      .asObservable()
      .pipe(map((dir) => !!dir));
  }

  /** Synchronous access to the mounted directory (used by the job queue). */
  public get currentDirectoryValue(): string | undefined {
    return this.currentDirectory;
  }

  private setCurrentDirectory(dir: string | undefined) {
    this.currentDirectory = dir;
    this.currentDirectorySubject.next(dir);
  }

  constructor(
    private readonly _logger: LogsService,
    private readonly _settings: SettingsService
  ) {}

  /**
   * On launch, re-mount the last used directory if auto-reconnect is enabled
   * and the directory still exists (e.g. the external drive is plugged in).
   */
  public async restoreLastDirectory(): Promise<void> {
    const settings = await this._settings.load();
    if (!settings.autoReconnect || !settings.lastDirectory) {
      return;
    }
    const exists = await window.libraryAPI
      .directoryExists(settings.lastDirectory)
      .catch(() => false);
    if (!exists) {
      this._logger.log(
        'libraryService',
        `Skipping auto-reconnect: directory no longer available (${settings.lastDirectory})`
      );
      return;
    }
    this._logger.log(
      'libraryService',
      `Auto-reconnecting last directory: ${settings.lastDirectory}`
    );
    this.setCurrentDirectory(settings.lastDirectory);
    await this.getGamesFiles(settings.lastDirectory);
  }

  private invalidFilesCount(): Observable<number> {
    return this.invalidFiles$.pipe(map((files) => Math.min(files.length, 99)));
  }

  public disconnectCurrentDirectory() {
    this._logger.log(
      'libraryService',
      'User disconnected OPL Library directory'
    );
    this.setCurrentDirectory(undefined);
    this.librarySubject.next([]);
    this.invalidFilesSubject.next([]);
  }

  public openAskDirectory() {
    this._logger.verbose(
      'libraryService',
      'Triggered directory selection pop-up...'
    );
    this.setLoading(true);
    this.setCurrentAction('User choosing directory...');
    return window.libraryAPI.openAskDirectory().then(async (data: any) => {
      if (!data.canceled) {
        this._logger.log(
          'libraryService',
          `Directory has been chosen by user: ${data.filePaths[0]}`
        );
        this.setCurrentDirectory(data.filePaths[0]);
        this._settings.set('lastDirectory', data.filePaths[0]);
        this.setLoading(false);
        this.setCurrentAction('');
        await this.getGamesFiles(data.filePaths[0]);
      } else {
        this._logger.error(
          'libraryService',
          `Directory selection has been cancelled by user.`
        );
        this.setLoading(false);
        this.setCurrentAction('');
      }
    });
  }

  public refreshGamesFiles() {
    if (this.currentDirectory) {
      this.getGamesFiles(this.currentDirectory);
    }
  }

  public getGamesFiles(currentDirectory: string) {
    this.setLoading(true);
    this.setCurrentAction('Retrieving game files from directory...');
    this._logger.log('libraryService', 'Started game files retrieval...');

    if (currentDirectory) {
      return Promise.all([
        window.libraryAPI.getGamesFiles(currentDirectory),
        window.libraryAPI.getULGames(currentDirectory),
        window.libraryAPI.getApps(currentDirectory),
      ]).then(async ([files, ulResult, appsResult]) => {
        if (files.success) {
          this._logger.log(
            'libraryService',
            `Grabbed ${files.data.length} game files, now parsing...`
          );
          this.setCurrentAction('');
          this.setLoading(false);

          const ulGames =
            ulResult?.success && ulResult.data
              ? this.parseULGamesToLibrary(ulResult.data)
              : [];

          if (ulGames.length > 0) {
            this._logger.log(
              'libraryService',
              `Found ${ulGames.length} UL format games`
            );
          }

          const apps =
            appsResult?.success && appsResult.apps
              ? this.parseAppsToLibrary(appsResult.apps)
              : [];

          if (apps.length > 0) {
            this._logger.log('libraryService', `Found ${apps.length} app(s)`);
          }

          await this.parseGameFilesToLibrary(files.data, ulGames, apps);
        } else {
          this._logger.error('libraryService', files.message);
          this.setCurrentAction('');
          this.setLoading(false);
        }
      });
    } else {
      this._logger.error(
        'libraryService',
        'No directory selected for game files retrieval.'
      );
      this.setCurrentAction('');
      this.setLoading(false);
      return Promise.reject(
        new Error(
          'libraryService - No directory selected for game files retrieval.'
        )
      );
    }
  }

  private formatFileSize(size: number) {
    if (size === 0) return '0 B';
    const units = ['B', 'KB', 'MB', 'GB', 'TB'];
    const i = Math.floor(Math.log(size) / Math.log(1024));
    const value = size / Math.pow(1024, i);
    return `${value.toFixed(1)}${units[i]}`;
  }

  private parseSizeToGb(sizeLabel: string | undefined): number {
    if (!sizeLabel) {
      return 0;
    }
    const match = sizeLabel.match(/([\d.]+)\s*(B|KB|MB|GB|TB)/i);
    if (!match) {
      return 0;
    }
    const value = parseFloat(match[1]);
    if (Number.isNaN(value)) {
      return 0;
    }
    const unit = match[2].toUpperCase();
    const factors: Record<string, number> = {
      B: 1 / Math.pow(1024, 3),
      KB: 1 / Math.pow(1024, 2),
      MB: 1 / 1024,
      GB: 1,
      TB: 1024,
    };
    return value * (factors[unit] ?? 0);
  }

  private countGamesByCdType$(expectedType: string): Observable<number> {
    return this.library$.pipe(
      map(
        (games) =>
          games.filter(
            (game) => game.cdType?.toUpperCase() === expectedType.toUpperCase()
          ).length
      )
    );
  }

  private mapGameIdToRegion(gameId: string) {
    if (
      gameId.startsWith('SCES') ||
      gameId.startsWith('SCED') ||
      gameId.startsWith('SLES') ||
      gameId.startsWith('SLED')
    ) {
      return 'PAL';
    }
    if (
      gameId.startsWith('SCUS') ||
      gameId.startsWith('SLUS') ||
      gameId.startsWith('LSP') ||
      gameId.startsWith('PSRM')
    ) {
      return 'NTSC-U';
    }
    if (
      gameId.startsWith('SCPS') ||
      gameId.startsWith('SLPS') ||
      gameId.startsWith('SLPM') ||
      gameId.startsWith('SIPS')
    ) {
      return 'NTSC-J';
    }
    return 'UNKNOWN';
  }

  private extensionToFormat(ext: string): GameFormat {
    switch (ext?.toLowerCase()) {
      case '.zso':
        return 'ZSO';
      case '.vcd':
        return 'VCD';
      default:
        return 'ISO';
    }
  }

  private estimateUlSize(entry: { totalSize: number; numParts: number; mediaType: string }): string {
    if (entry.totalSize > 0) {
      return this.formatFileSize(entry.totalSize);
    }
    // Fallback: estimate from number of parts (~1 GB per fragment)
    if (entry.numParts > 0) {
      const estimatedBytes = entry.numParts * 1073741824;
      return `~${this.formatFileSize(estimatedBytes)}`;
    }
    return '??';
  }

  private parseULGamesToLibrary(
    ulEntries: {
      name: string;
      gameId: string;
      numParts: number;
      mediaType: string;
      totalSize: number;
    }[]
  ): Game[] {
    return ulEntries.map((entry) => {
      // Normalize gameId to XXXX_###.## format (safety net)
      // Strips leading "ul" prefix if present, then formats digits
      let rawId = entry.gameId;
      rawId = rawId.replace(/^ul[._-]?/i, '');
      const cleaned = rawId.replace(/[^A-Za-z0-9]/g, '');
      const idMatch = cleaned.match(/^([A-Za-z]{4})(\d{5})$/);
      const gameId = idMatch
        ? `${idMatch[1].toUpperCase()}_${idMatch[2].slice(0, 3)}.${idMatch[2].slice(3)}`
        : rawId;

      return {
        filename: `ul.${gameId}.${entry.name}`,
        title: entry.name,
        cdType: entry.mediaType,
        gameId: gameId,
        region: this.mapGameIdToRegion(gameId),
        path: '',
        extension: 'UL',
        parentPath: '',
        format: 'UL' as GameFormat,
        size: this.estimateUlSize(entry),
      };
    });
  }

  private parseAppsToLibrary(
    apps: {
      folder: string;
      title: string;
      boot: string;
      path: string;
      sizeBytes: number;
    }[]
  ): Game[] {
    return apps.map((app) => ({
      filename: app.boot,
      title: app.title,
      cdType: 'APPS',
      gameId: '',
      path: app.path,
      extension: 'ELF',
      parentPath: '',
      format: 'APP' as GameFormat,
      system: 'APPS' as const,
      appFolder: app.folder,
      size: this.formatFileSize(app.sizeBytes) || '??',
    }));
  }

  private async parseGameFilesToLibrary(
    gamefiles: RawGameFile[],
    ulGames: Game[] = [],
    apps: Game[] = []
  ) {
    this.setLoading(true);
    this.setCurrentAction('Mapping gamefiles to Game Objects...');
    this._logger.verbose(
      'libraryService.parseGameFilesToLibrary',
      'Started mapping gamefiles to GameObjects: ' +
        gamefiles.length +
        ' Files...'
    );
    const validGames: Game[] = [];
    const invalidFiles: any[] = [];

    for (const file of gamefiles) {
      const gameIdMatch = file.name.match(/^([A-Z]{4}_\d{3}\.\d{2})\.(.+)$/i);
      const ext = file.extension?.toLowerCase();
      if (
        (ext === '.iso' || ext === '.zso' || ext === '.vcd') &&
        typeof file.name === 'string' &&
        typeof file.path === 'string' &&
        file.stats &&
        typeof file.stats.size === 'number' &&
        gameIdMatch
      ) {
        this.setLoading(true);
        this.setCurrentAction(file.name);

        this._logger.verbose(
          'libraryService.parseGameFilesToLibrary',
          `Mapping: ${file.name}`
        );
        const gameId = gameIdMatch[1];
        const title = gameIdMatch[2];

        const dirName = file.parentPath?.split(/[\\/]/).pop() || '';
        const isPops = dirName === 'POPS';
        const isVcd = dirName === 'VCD';
        const isPs1 = isPops || isVcd;

        validGames.push({
          filename: file.name + file.extension,
          title: title,
          cdType: isPops ? 'POPS' : dirName,
          gameId: gameId,
          region: this.mapGameIdToRegion(gameId),
          path: file.path,
          extension: file.extension,
          parentPath: file.parentPath,
          format: isPops ? 'POPS' : this.extensionToFormat(file.extension),
          system: isPs1 ? 'PS1' : 'PS2',
          size: this.formatFileSize(file.stats.size) || '??',
        });
      } else {
        invalidFiles.push(file);
      }
    }

    // Merge UL games and homebrew apps
    validGames.push(...ulGames);
    validGames.push(...apps);

    if (this.currentDirectory) {
      const artFiles = await this.parseArtFiles(this.currentDirectory);
      for (const game of validGames) {
        game.art = artFiles
          .filter((art: any) => art.gameId === game.gameId)
          .map((art: any) => art);
      }
    }

    this.setLoading(true);
    this.setCurrentAction('Saving...');
    this.librarySubject.next(validGames);
    this.invalidFilesSubject.next(invalidFiles);
    this.setCurrentAction('');
    this.setLoading(false);

    console.log(validGames);
    console.log(invalidFiles);
  }

  private parseArtFiles(dirPath: string) {
    this.setLoading(true);
    this.setCurrentAction('Parsing /ART folder on disk...');
    return window.libraryAPI.getArtFolder(dirPath).then((artFiles) => {
      this.setCurrentAction('');
      this.setLoading(false);
      return artFiles.data;
    });
  }

  public async renameInvalidGameFile(
    path: string,
    gameId: string,
    gameName: string
  ) {
    this._logger.log('renameInvalidGameFile', 'Renaming ' + path);
    this.setLoading(true);
    this.setCurrentAction('Renaming ' + path + '...');
    this._logger.verbose(
      'renameInvalidGameFile',
      `${path} -> ${gameId}, ${gameName}`
    );
    return window.libraryAPI
      .renameGamefile(path, gameId, gameName)
      .then((res) => {
        this.setCurrentAction('');
        this.setLoading(false);
        this.refreshGamesFiles();
        return res;
      });
  }

  public downloadArtByGameId(gameId: string, system?: 'PS1' | 'PS2') {
    this._logger.log(
      'downloadArtByGameId',
      'Triggered download of art for ' + gameId
    );
    this.setLoading(true);
    this.setCurrentAction('Downloading Art for ' + gameId + '...');
    return window.libraryAPI
      .downloadArtByGameId(`${this.currentDirectory}/ART`, gameId, system)
      .then(async (res) => {
        this.setCurrentAction('');
        this.setLoading(false);
        // Update only the affected game's artwork instead of refreshing
        // the entire library, which would reset the scroll position.
        await this.updateArtForGame(gameId);
      });
  }

  /**
   * Re-reads artwork for a single game and patches it into the current
   * library state without replacing the whole list, preserving scroll position.
   */
  private async updateArtForGame(gameId: string) {
    if (!this.currentDirectory) return;
    const artFiles = await this.parseArtFiles(this.currentDirectory);
    const currentLibrary = this.librarySubject.getValue();
    const updatedLibrary = currentLibrary.map((game) => {
      if (game.gameId === gameId) {
        return {
          ...game,
          art: artFiles
            .filter((art: any) => art.gameId === gameId)
            .map((art: any) => art),
        };
      }
      return game;
    });
    this.librarySubject.next(updatedLibrary);
  }

  public downloadAllArt() {
    this._logger.log(
      'downloadAllArt',
      'Triggered downloading complete library art files...'
    );
    const games = this.librarySubject.getValue();
    const downloadPromises = games
      .filter((game) => game.system !== 'APPS' && game.gameId)
      .map((game) =>
        this.downloadArtByGameId(
          game.gameId,
          game.system === 'PS1' ? 'PS1' : 'PS2'
        )
      );
    return Promise.all(downloadPromises);
  }

  public tryDetermineGameIdFromHex(filepath: string) {
    this._logger.log(
      'tryDetermineGameIdFromHex',
      'Trying to determine Game ID from hex data: ' + filepath
    );
    this.setLoading(true);
    this.setCurrentAction('Determining Game ID from hex data...');
    return window.libraryAPI.tryDetermineGameIdFromHex(filepath).then((res) => {
      this.setCurrentAction('');
      this.setLoading(false);
      console.log(res);
      return res;
    });
  }

  public tryDeterminePs1GameIdFromHex(filepath: string) {
    this._logger.log(
      'tryDeterminePs1GameIdFromHex',
      'Trying to determine PS1 Game ID from hex data: ' + filepath
    );
    this.setLoading(true);
    this.setCurrentAction('Determining PS1 Game ID from hex data...');
    return window.libraryAPI
      .tryDeterminePs1GameIdFromHex(filepath)
      .then((res) => {
        this.setCurrentAction('');
        this.setLoading(false);
        console.log(res);
        return res;
      });
  }

  public async bulkAutoCorrection(fetchArtwork: boolean) {
    this._logger.log(
      'bulkAutoCorrection',
      'Triggered bulk auto-correction of invalid game files...'
    );
    this.setLoading(true);
    this.setCurrentAction('Auto-correcting invalid game files...');

    const invalidFiles = this.invalidFiles$.subscribe(async (files) => {
      for (const file of files) {
        this.setLoading(true);
        this.setCurrentAction('Processing ' + file.name + '...');

        const result = await this.tryDetermineGameIdFromHex(file.path);
        if (result.success) {
          await this.renameInvalidGameFile(
            file.path,
            result.gameId,
            result.gameName || ''
          );
          if (fetchArtwork) {
            await this.downloadArtByGameId(result.gameId);
          }
        }
      }
      invalidFiles.unsubscribe();
    });

    this.setCurrentAction('');
    this.setLoading(false);
  }

  public async deleteApp(game: Game) {
    if (!game.appFolder || !this.currentDirectory) return;
    this._logger.log('deleteApp', `Deleting app: ${game.title}`);
    this.setLoading(true);
    this.setCurrentAction(`Deleting ${game.title}...`);
    try {
      const res = await window.libraryAPI.deleteApp(
        this.currentDirectory,
        game.appFolder
      );
      if (res.success) {
        this.refreshGamesFiles();
      } else {
        this._logger.error('deleteApp', `Failed to delete: ${res.message}`);
      }
    } catch (error: any) {
      this._logger.error('deleteApp', `Error: ${error?.message || error}`);
    } finally {
      this.setCurrentAction('');
      this.setLoading(false);
    }
  }

  public async deleteGame(game: Game) {
    this._logger.log('deleteGame', `Deleting game: ${game.gameId} (${game.title})`);
    this.setLoading(true);
    this.setCurrentAction(`Deleting ${game.title || game.gameId}...`);

    try {
      const artDir = `${this.currentDirectory}/ART`;
      const result = await window.libraryAPI.deleteGameAndRelatedFiles(
        game.path,
        artDir,
        game.gameId
      );

      if (result.success) {
        this._logger.log('deleteGame', `Successfully deleted ${game.gameId}`);
        this.refreshGamesFiles();
      } else {
        this._logger.error('deleteGame', `Failed to delete: ${result.message}`);
      }
    } catch (error: any) {
      this._logger.error('deleteGame', `Error: ${error?.message || error}`);
    } finally {
      this.setCurrentAction('');
      this.setLoading(false);
    }
  }

}
