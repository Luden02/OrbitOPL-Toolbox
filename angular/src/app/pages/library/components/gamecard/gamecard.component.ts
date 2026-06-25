import {
  ChangeDetectionStrategy,
  ChangeDetectorRef,
  Component,
  computed,
  inject,
  input,
} from '@angular/core';
import { Game } from '@shared/types/game.type';

import { LibraryService } from '@shared/services/library.service';
import { JobsService } from '@shared/services/jobs.service';
import { ConfirmDialogService } from '@shared/services/confirm-dialog.service';
import { LucideAngularModule } from 'lucide-angular';
import { GameCfgDialogComponent } from '../game-cfg-dialog/game-cfg-dialog.component';
import { LibraryRenameDialogComponent } from '../rename-dialog/rename-dialog.component';
import { Ps1DeleteDialogComponent } from '../ps1-delete-dialog/ps1-delete-dialog.component';

export type GamecardViewMode = 'grid' | 'list';

@Component({
  selector: 'app-gamecard',
  imports: [
    LucideAngularModule,
    GameCfgDialogComponent,
    LibraryRenameDialogComponent,
    Ps1DeleteDialogComponent,
  ],
  templateUrl: './gamecard.component.html',
  styleUrl: './gamecard.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
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

  readonly artSrc = computed(() => {
    const a = this.displayArt();
    return a ? `data:image/png;base64,${a.base64}` : null;
  });

  readonly displaySystemLabel = computed(() => {
    const g = this.game();
    if (g?.isPs1Launcher) return 'PS1 App';
    if (g?.system === 'PS1') return 'PS1';
    if (g?.system === 'APPS') return 'APP';
    return 'PS2';
  });

  readonly isApp = computed(() => {
    const g = this.game();
    return g?.system === 'APPS' && !g?.isPs1Launcher;
  });

  readonly isPs1LauncherApp = computed(() => {
    const g = this.game();
    return g?.system === 'APPS' && !!g?.isPs1Launcher;
  });

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
    if (g.isPs1Launcher) {
      return !!g.path && !!g.gameId && !!g.title;
    }
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
  public showDeleteDialog = false;

  private readonly _cdr = inject(ChangeDetectorRef);

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
        system: g.system === 'PS1' || this.isPs1LauncherApp() ? 'PS1' : 'PS2',
        saveAsName: this.isPs1LauncherApp() ? g.ps1LauncherBoot : undefined,
      },
    ]);
  }

  async convertToZso() {
    const g = this.game();
    if (!g || !this.canCompressZso()) return;
    const confirmed = await this._confirm.confirm({
      title: 'Convert to ZSO',
      message: `Compress "${g.title || g.gameId}" to ZSO?`,
      detail:
        'This creates a smaller .zso and removes the original .iso once it succeeds.',
      confirmLabel: 'Convert',
    });
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
          'This removes the VCD file, launcher app and POPS subfolder elements (VMCs, CHEATS.TXT, etc.)',
        confirmLabel: 'Delete',
      });
      if (confirmed) {
        this.showDeleteDialog = true;
        this._cdr.markForCheck();
      }
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
