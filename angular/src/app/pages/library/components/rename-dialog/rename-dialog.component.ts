import { Component, EventEmitter, Input, OnInit, Output } from '@angular/core';
import { LucideAngularModule } from 'lucide-angular';
import { LibraryService } from '../../../../shared/services/library.service';
import { LogsService } from '../../../../shared/services/logs.service';
import { Game } from '../../../../shared/types/game.type';

type Convention = 'old' | 'new';

interface RenamePlanItem {
  game: Game;
  current: string;
  target: string;
}

@Component({
  selector: 'app-library-rename-dialog',
  imports: [LucideAngularModule],
  templateUrl: './rename-dialog.component.html',
  styleUrl: './rename-dialog.component.scss',
})
export class LibraryRenameDialogComponent implements OnInit {
  /** When provided, the dialog operates on this single game instead of the
   *  whole library. */
  @Input() game?: Game;
  @Output() closed = new EventEmitter<void>();

  convention: Convention = 'new';
  running = false;
  done = false;
  succeeded = 0;
  failed = 0;
  progress = 0;
  currentLabel = '';

  /** Pre-computed plan: only entries whose filename would actually change. */
  private plan: RenamePlanItem[] = [];

  /** Same in both modes — eligible PS2 disc images on disk. */
  private candidates: Game[] = [];

  constructor(
    private readonly _library: LibraryService,
    private readonly _logger: LogsService
  ) {}

  /** Per-game eligibility check shared by both bulk and single modes. */
  private isEligible(g: Game): boolean {
    return (
      (g.system ?? 'PS2') === 'PS2' &&
      (g.format === 'ISO' || g.format === 'ZSO') &&
      !!g.path &&
      !!g.gameId &&
      !!g.title
    );
  }

  get isSingle(): boolean {
    return !!this.game;
  }

  ngOnInit() {
    const pool = this.game ? [this.game] : this._library.currentLibraryValue;
    this.candidates = pool.filter((g) => this.isEligible(g));
    this.rebuildPlan();
  }

  setConvention(c: Convention) {
    this.convention = c;
    this.rebuildPlan();
  }

  get planCount(): number {
    return this.plan.length;
  }

  get skippedCount(): number {
    return this.candidates.length - this.plan.length;
  }

  private sanitize(name: string): string {
    // Mirrors sanitizeGameFilename on the main side.
    return name
      .replace(/[\\/:*?"<>|]/g, '')
      .replace(/\s+/g, ' ')
      .trim();
  }

  private rebuildPlan() {
    this.plan = [];
    for (const game of this.candidates) {
      const ext = game.extension; // includes leading dot
      const safeTitle = this.sanitize(game.title || game.gameId);
      const target =
        this.convention === 'new'
          ? `${safeTitle}${ext}`
          : `${game.gameId}.${safeTitle}${ext}`;
      const current = `${game.filename}`; // already includes extension
      if (current !== target) {
        this.plan.push({ game, current, target });
      }
    }
  }

  async run() {
    if (this.running || this.plan.length === 0) return;
    this.running = true;
    this.succeeded = 0;
    this.failed = 0;
    this.progress = 0;

    for (let i = 0; i < this.plan.length; i++) {
      const { game, target } = this.plan[i];
      this.currentLabel = target;
      try {
        const res: any = await window.libraryAPI.renameGamefile(
          game.path,
          game.gameId,
          game.title || game.gameId,
          this.convention === 'new'
        );
        if (res?.success) {
          this.succeeded++;
        } else {
          this.failed++;
          this._logger.error(
            'bulkRename',
            `Failed to rename ${game.filename}: ${res?.message}`
          );
        }
      } catch (err: any) {
        this.failed++;
        this._logger.error(
          'bulkRename',
          `Error renaming ${game.filename}: ${err?.message || err}`
        );
      }
      this.progress = Math.round(((i + 1) / this.plan.length) * 100);
    }

    this.running = false;
    this.done = true;
    this._library.refreshGamesFiles();
  }

  close() {
    if (this.running) return;
    this.closed.emit();
  }
}
