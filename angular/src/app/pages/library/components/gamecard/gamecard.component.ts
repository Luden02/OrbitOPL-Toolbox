import { Component, computed, input } from '@angular/core';
import { Game, gameArt } from '../../../../shared/types/game.type';

import { LibraryService } from '../../../../shared/services/library.service';
import { JobsService } from '../../../../shared/services/jobs.service';
import { ConfirmDialogService } from '../../../../shared/services/confirm-dialog.service';
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
export class GamecardComponent {
  readonly game = input<Game | undefined>(undefined);
  readonly viewMode = input<GamecardViewMode>('grid');

  readonly displayArt = computed(() => {
    const g = this.game();
    const vm = this.viewMode();
    if (g && Array.isArray(g.art)) {
      const artType = vm === 'list' ? 'ICO' : 'COV';
      return g.art.find((a) => a.type?.toUpperCase() === artType);
    }
    return undefined;
  });

  readonly isApp = computed(
    () => this.game()?.system === 'APPS' && !this.game()?.isPs1Launcher,
  );

  readonly isPs1LauncherApp = computed(
    () => this.game()?.system === 'APPS' && !!this.game()?.isPs1Launcher,
  );

  readonly canCompressZso = computed(() => {
    const g = this.game();
    if (!g) return false;
    const system = g.system ?? 'PS2';
    const isIso = g.format === 'ISO' || g.extension?.toLowerCase() === 'iso';
    return system === 'PS2' && isIso;
  });

  readonly canRenameConvention = computed(() => {
    const g = this.game();
    if (!g) return false;
    const system = g.system ?? 'PS2';
    return (
      system === 'PS2' &&
      (g.format === 'ISO' || g.format === 'ZSO') &&
      !!g.gameId &&
      !!g.title
    );
  });

  public showCfg = false;
  public showRename = false;

  constructor(
    public readonly _libraryService: LibraryService,
    private readonly _jobs: JobsService,
    private readonly _confirm: ConfirmDialogService,
  ) {}

  openCfg() {
    if (this.game()) this.showCfg = true;
  }

  openRename() {
    if (this.game()) this.showRename = true;
  }

  fetchArtwork() {
    const g = this.game();
    if (!g) return;
    if (this.isApp()) return;
    this._jobs.enqueue([
      {
        type: 'artwork',
        label: g.title || g.gameId || g.filename,
        filePath: g.path,
        gameId: g.gameId,
        gameName: g.title || '',
        downloadArtwork: false,
        system: this.isPs1LauncherApp()
          ? 'PS1'
          : g.system === 'PS1'
            ? 'PS1'
            : 'PS2',
        saveAsName: this.isPs1LauncherApp() ? g.ps1LauncherBoot : undefined,
      },
    ]);
  }

  convertToZso() {
    const g = this.game();
    if (!g || !this.canCompressZso()) return;
    const confirmed = window.confirm(
      `Compress "${g.title || g.gameId}" to ZSO?\n\n` +
        `This creates a smaller .zso and removes the original .iso once it succeeds.`,
    );
    if (!confirmed) return;
    this._jobs.enqueue([
      {
        type: 'zso',
        label: g.title || g.gameId || g.filename,
        filePath: g.path,
        gameId: g.gameId,
        gameName: g.title || '',
        downloadArtwork: false,
        deleteOriginal: true,
      },
    ]);
  }

  async confirmDelete() {
    const g = this.game();
    if (!g) return;
    if (g.isPs1Launcher) {
      const confirmed = await this._confirm.confirm({
        title: 'Delete PS1 Game',
        message: `Delete PS1 game "${g.title}"?`,
        detail:
          'This removes the VCD file, its launcher app, and associated artwork.',
        confirmLabel: 'Delete',
      });
      if (confirmed) this._libraryService.deleteGame(g);
      return;
    }
    if (this.isApp()) {
      const confirmed = await this._confirm.confirm({
        title: 'Delete App',
        message: `Delete the app "${g.title}"?`,
        detail: 'This removes its APPS folder.',
        confirmLabel: 'Delete',
      });
      if (confirmed) this._libraryService.deleteApp(g);
      return;
    }
    const confirmed = await this._confirm.confirm({
      title: 'Delete Game',
      message: `Are you sure you want to delete "${g.title || g.gameId}"?`,
      detail: 'This will also remove associated artwork.',
      confirmLabel: 'Delete',
    });
    if (confirmed) {
      this._libraryService.deleteGame(g);
    }
  }
}
