import { Injectable } from '@angular/core';
import { LogService } from '@cds/core/internal';
import { LogsService } from './logs.service';
import { BehaviorSubject, lastValueFrom, map, Observable } from 'rxjs';
import { Game, RawGameFile } from '../types/game.type';

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

  private setCurrentDirectory(dir: string | undefined) {
    this.currentDirectory = dir;
    this.currentDirectorySubject.next(dir);
  }

  constructor(private readonly _logger: LogsService) {}

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
        return res;
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

  openAskGameFile(isGameCd: boolean, isGameDvd: boolean) {
    this._logger.verbose(
      'libraryService',
      'Triggered game file selection pop-up...'
    );
    this.setLoading(true);
    this.setCurrentAction('User choosing game file...');
    return window.libraryAPI
      .openAskGameFile(isGameCd, isGameDvd)
      .then(async (data: any) => {
        if (!data.canceled) {
          this._logger.log(
            'libraryService',
            `Game file has been chosen by user: ${data.filePaths[0]}`
          );
          this.setLoading(false);
          this.setCurrentAction('');
          return data.filePaths[0];
        } else {
          this._logger.error(
            'libraryService',
            `Game file selection has been cancelled by user.`
          );
          this.setLoading(false);
          this.setCurrentAction('');
          return null;
        }
      });
  }

  convertBinToIso(cueFilePath: string, outputDir: string) {
    this._logger.log(
      'convertBinToIso',
      `Triggered conversion of BIN/CUE to ISO: ${cueFilePath} -> ${outputDir}`
    );
    this.setLoading(true);
    this.setCurrentAction('Converting BIN/CUE to ISO...');

    console.log(cueFilePath, outputDir);
    return window.libraryAPI
      .convertBinToIso(cueFilePath, outputDir)
      .then((res) => {
        this.setCurrentAction('');
        this.setLoading(false);
        return res;
      });
  }

  moveFile(sourcePath: string, destPath: string) {
    this._logger.log(
      'moveFile',
      `Triggered moving file: ${sourcePath} -> ${destPath}`
    );
    this.setLoading(true);
    this.setCurrentAction('Moving file...');

    // Set up progress listener
    window.libraryAPI.onMoveFileProgress((progress) => {
      const progressText = `Moving file... ${progress.percent}% (${progress.copiedMB}/${progress.totalMB} MB)`;
      this.setCurrentAction(progressText);
      console.log(`File transfer progress: ${progress.percent}%`);
    });

    return window.libraryAPI
      .moveFile(sourcePath, destPath)
      .then((res) => {
        console.log('movefile:', res);
        window.libraryAPI.removeAllMoveFileProgressListeners();
        this.setCurrentAction('');
        this.setLoading(false);
        return res;
      })
      .catch((err) => {
        window.libraryAPI.removeAllMoveFileProgressListeners();
        this.setCurrentAction('');
        this.setLoading(false);
        throw err;
      });
  }

  async importGameFile(
    gamePath: string,
    gameId: string,
    gameName: string,
    downloadArtwork: boolean
  ) {
    this._logger.log(
      'importGameFile',
      `Triggered import of game file: ${gamePath} with ID: ${gameId}`
    );
    this.setLoading(true);
    this.setCurrentAction('Importing game file...');

    const dirPath = this.currentDirectory;

    if (!dirPath || !gamePath) {
      this._logger.error(
        'importGameFile',
        'Missing directory path or game path'
      );
      this.setCurrentAction('');
      this.setLoading(false);
      return;
    }

    const destinationDir = `${dirPath}/DVD`;
    const normaliseErrorMessage = (value: any, fallback: string) => {
      if (!value) return fallback;
      if (typeof value === 'string') return value;
      if (value?.message) return value.message;
      try {
        return JSON.stringify(value);
      } catch {
        return fallback;
      }
    };

    try {
      this._logger.verbose(
        'importGameFile',
        `Moving file to: ${destinationDir}`
      );
      this.setCurrentAction(`Moving file to ${destinationDir}...`);

      // Set up progress listener for import
      window.libraryAPI.onMoveFileProgress((progress) => {
        const progressText = `Importing... ${progress.percent}% (${progress.copiedMB}/${progress.totalMB} MB)`;
        this.setCurrentAction(progressText);
      });

      const moveResult: any = await window.libraryAPI.moveFile(
        gamePath,
        destinationDir
      );

      window.libraryAPI.removeAllMoveFileProgressListeners();

      if (!moveResult?.success) {
        throw new Error(
          normaliseErrorMessage(
            moveResult?.message,
            'Failed to move game file.'
          )
        );
      }

      const fallbackMovedPath = `${destinationDir}/${gamePath
        .split(/[\\/]/)
        .pop()}`;
      const movedPath = moveResult.newPath || fallbackMovedPath;

      this._logger.verbose(
        'importGameFile',
        `Renaming moved file: ${movedPath}`
      );
      this.setCurrentAction(`Renaming ${movedPath}...`);
      const renameResult: any = await window.libraryAPI.renameGamefile(
        movedPath,
        gameId,
        gameName
      );

      if (!renameResult?.success) {
        throw new Error(
          normaliseErrorMessage(
            renameResult?.message,
            'Failed to rename moved game file.'
          )
        );
      }

      const finalPath = renameResult.newPath || movedPath;

      this._logger.log(
        'importGameFile',
        `Game file imported successfully: ${finalPath}`
      );
      this.refreshGamesFiles();

      if (downloadArtwork) {
        this._logger.verbose(
          'importGameFile',
          `Downloading artwork for: ${gameId}`
        );
        this.downloadArtByGameId(gameId);
      }
    } catch (error: any) {
      this._logger.error('importGameFile', `Error: ${error?.message || error}`);
    } finally {
      this.setCurrentAction('');
      this.setLoading(false);
    }
  }
}
