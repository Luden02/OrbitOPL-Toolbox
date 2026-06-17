import { Component, Input, OnChanges, OnInit, SimpleChanges } from '@angular/core';
import { Game, gameArt } from '../../../../shared/types/game.type';

import { LibraryService } from '../../../../shared/services/library.service';
import { JobsService } from '../../../../shared/services/jobs.service';
import { LucideAngularModule } from 'lucide-angular';
import { GameCfgDialogComponent } from '../game-cfg-dialog/game-cfg-dialog.component';
import { LibraryRenameDialogComponent } from '../rename-dialog/rename-dialog.component';

export type GamecardViewMode = 'grid' | 'list';

@Component({
  selector: 'app-gamecard',
  imports: [
    LucideAngularModule,
    GameCfgDialogComponent,
    LibraryRenameDialogComponent,
  ],
  templateUrl: './gamecard.component.html',
  styleUrl: './gamecard.component.scss',
})
export class GamecardComponent implements OnInit, OnChanges {
  @Input() game: Game | undefined;
  @Input() viewMode: GamecardViewMode = 'grid';

  constructor(
    public readonly _libraryService: LibraryService,
    private readonly _jobs: JobsService
  ) {}

  /** Homebrew apps are managed differently from disc games. */
  get isApp(): boolean {
    return this.game?.system === 'APPS';
  }

  /** Only PS2 ISO images can be compressed to ZSO. */
  get canCompressZso(): boolean {
    if (!this.game) return false;
    const system = this.game.system ?? 'PS2';
    const isIso =
      this.game.format === 'ISO' ||
      this.game.extension?.toLowerCase() === 'iso';
    return system === 'PS2' && isIso;
  }

  /** Old/new naming convention only applies to PS2 disc images. */
  get canRenameConvention(): boolean {
    if (!this.game) return false;
    const system = this.game.system ?? 'PS2';
    return (
      system === 'PS2' &&
      (this.game.format === 'ISO' || this.game.format === 'ZSO') &&
      !!this.game.gameId &&
      !!this.game.title
    );
  }

  public displayArt: gameArt | undefined;
  public showCfg = false;
  public showRename = false;

  openCfg() {
    if (this.game) this.showCfg = true;
  }

  openRename() {
    if (this.game) this.showRename = true;
  }

  ngOnInit() {
    this.updateDisplayArt();
  }

  ngOnChanges(changes: SimpleChanges) {
    if (changes['game'] || changes['viewMode']) {
      this.updateDisplayArt();
    }
  }

  private updateDisplayArt() {
    if (this.game && Array.isArray(this.game.art)) {
      const artType = this.viewMode === 'list' ? 'ICO' : 'COV';
      this.displayArt = this.game.art.find(
        (a) => a.type?.toUpperCase() === artType
      );
    } else {
      this.displayArt = undefined;
    }
  }

  fetchArtwork() {
    if (!this.game || this.isApp) return;
    this._jobs.enqueue([
      {
        type: 'artwork',
        label: this.game.title || this.game.gameId || this.game.filename,
        filePath: this.game.path,
        gameId: this.game.gameId,
        gameName: this.game.title || '',
        downloadArtwork: false,
        system: this.game.system === 'PS1' ? 'PS1' : 'PS2',
      },
    ]);
  }

  convertToZso() {
    if (!this.game || !this.canCompressZso) return;
    const confirmed = window.confirm(
      `Compress "${this.game.title || this.game.gameId}" to ZSO?\n\n` +
        `This creates a smaller .zso and removes the original .iso once it succeeds.`
    );
    if (!confirmed) return;
    this._jobs.enqueue([
      {
        type: 'zso',
        label: this.game.title || this.game.gameId || this.game.filename,
        filePath: this.game.path,
        gameId: this.game.gameId,
        gameName: this.game.title || '',
        downloadArtwork: false,
        deleteOriginal: true,
      },
    ]);
  }

  confirmDelete() {
    if (!this.game) return;
    if (this.isApp) {
      const confirmed = window.confirm(
        `Delete the app "${this.game.title}"?\nThis removes its APPS folder.`
      );
      if (confirmed) this._libraryService.deleteApp(this.game);
      return;
    }
    const confirmed = window.confirm(
      `Are you sure you want to delete "${this.game.title || this.game.gameId}"?\nThis will also remove associated artwork.`
    );
    if (confirmed) {
      this._libraryService.deleteGame(this.game);
    }
  }
}
