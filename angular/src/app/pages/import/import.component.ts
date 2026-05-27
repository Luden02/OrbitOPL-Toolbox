import { Component } from '@angular/core';
import { LucideAngularModule } from 'lucide-angular';
import { LibraryService } from '../../shared/services/library.service';
import { JobsService, ImportJobType } from '../../shared/services/jobs.service';
import { AsyncPipe } from '@angular/common';

interface StagedFile {
  path: string;
  fileName: string;
  gameId: string;
  gameName: string;
  detected: boolean;
  invalid: boolean;
}

@Component({
  selector: 'app-import',
  imports: [LucideAngularModule, AsyncPipe],
  templateUrl: './import.component.html',
  styleUrl: './import.component.scss',
})
export class ImportComponent {
  constructor(
    public _libraryService: LibraryService,
    private _jobs: JobsService
  ) {}

  importMode: ImportJobType = 'ps2-dvd';
  downloadArtwork = true;
  elfPrefix = 'XX.';

  staged: StagedFile[] = [];
  scanning = false;

  get isGameCd(): boolean {
    return this.importMode === 'ps2-cd';
  }
  get isGameDvd(): boolean {
    return this.importMode === 'ps2-dvd';
  }
  get isGamePsx(): boolean {
    return this.importMode === 'ps1';
  }

  /** A staged file is importable once it has both an id and a name. */
  get readyCount(): number {
    return this.staged.filter((f) => f.gameId && f.gameName).length;
  }

  setMode(mode: ImportJobType) {
    this.importMode = mode;
    this.staged = [];
  }

  async addFiles() {
    const isSelectingCue = this.isGameCd || this.isGamePsx;
    const result = await window.libraryAPI.openAskGameFiles(
      isSelectingCue,
      this.isGameDvd
    );
    if (result?.canceled || !result?.filePaths?.length) {
      return;
    }

    this.scanning = true;
    try {
      for (const path of result.filePaths as string[]) {
        if (this.staged.some((f) => f.path === path)) {
          continue;
        }
        const staged = await this.detectFile(path);
        this.staged = [...this.staged, staged];
      }
    } finally {
      this.scanning = false;
    }
  }

  private async detectFile(path: string): Promise<StagedFile> {
    const fileName = path.split(/[\\/]/).pop() || path;
    const detect = this.isGamePsx
      ? this._libraryService.tryDeterminePs1GameIdFromHex(path)
      : this._libraryService.tryDetermineGameIdFromHex(path);

    try {
      const res: any = await detect;
      if (res?.success) {
        return {
          path,
          fileName,
          gameId: res.gameId || '',
          gameName: res.gameName || '',
          detected: true,
          invalid: false,
        };
      }
    } catch {
      // fall through to invalid
    }
    return {
      path,
      fileName,
      gameId: '',
      gameName: '',
      detected: false,
      invalid: true,
    };
  }

  removeStaged(path: string) {
    this.staged = this.staged.filter((f) => f.path !== path);
  }

  clearStaged() {
    this.staged = [];
  }

  importAll() {
    const ready = this.staged.filter((f) => f.gameId && f.gameName);
    if (!ready.length) {
      return;
    }
    this._jobs.enqueue(
      ready.map((f) => ({
        type: this.importMode,
        label: f.gameName || f.gameId || f.fileName,
        filePath: f.path,
        gameId: f.gameId,
        gameName: f.gameName,
        downloadArtwork: this.downloadArtwork,
        elfPrefix: this.isGamePsx ? this.elfPrefix : undefined,
      }))
    );
    this.staged = [];
  }
}
