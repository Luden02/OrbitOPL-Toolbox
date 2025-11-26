import { Injectable } from '@angular/core';
import { LogsService } from './logs.service';
import { BehaviorSubject, map, Observable } from 'rxjs';
import { Game, RawGameFile } from '../types/game.type';

@Injectable({
  providedIn: 'root',
})
export class LibraryService {
  private librarySubject = new BehaviorSubject<Game[]>([]);
  public get library$(): Observable<Game[]> {
    return this.librarySubject.asObservable();
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

  public get hasCurrentDirectory$(): Observable<boolean> {
    return this.currentDirectorySubject
      .asObservable()
      .pipe(map((dir) => !!dir));
  }

  private setCurrentDirectory(dir: string | undefined) {
    this.currentDirectory = dir;
    this.currentDirectorySubject.next(dir);
  }

  constructor(private readonly _logger: LogsService) {}

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
      return window.libraryAPI
        .getGamesFiles(currentDirectory)
        .then(async (files) => {
          if (files.success) {
            this._logger.log(
              'libraryService',
              `Grabbed ${files.data.length} game files, now parsing...`
            );
            this.setCurrentAction('');
            this.setLoading(false);

            this.parseGameFilesToLibrary(files.data);
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

  private async parseGameFilesToLibrary(gamefiles: RawGameFile[]) {
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
      const gameIdMatch = file.name.match(/^([A-Z]{4}_\d{3}\.\d{2})\.(.+)$/);
      if (
        file.extension === '.iso' &&
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

        validGames.push({
          filename: file.name + file.extension,
          title: title,
          cdType: file.parentPath?.split(/[\\/]/).pop() || '',
          gameId: gameId,
          region: this.mapGameIdToRegion(gameId),
          path: file.path,
          extension: file.extension,
          parentPath: file.parentPath,
          size: this.formatFileSize(file.stats.size) || '??',
        });
      } else {
        invalidFiles.push(file);
      }
    }

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
    console.log(validGames);
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
      });
  }

  public downloadArtByGameId(gameId: string) {
    this._logger.log(
      'downloadArtByGameId',
      'Triggered download of art for ' + gameId
    );
    this.setLoading(true);
    this.setCurrentAction('Downloading Art for ' + gameId + '...');
    return window.libraryAPI
      .downloadArtByGameId(`${this.currentDirectory}/ART`, gameId)
      .then((res) => {
        this.setCurrentAction('');
        this.setLoading(false);
        this.refreshGamesFiles();
      });
  }

  public downloadAllArt() {
    this._logger.log(
      'downloadAllArt',
      'Triggered downloading complete library art files...'
    );
    const games = this.librarySubject.getValue();
    const downloadPromises = games.map((game) =>
      this.downloadArtByGameId(game.gameId)
    );
    return Promise.all(downloadPromises);
  }
}
