import { Component, EventEmitter, Input, OnInit, Output } from '@angular/core';
import { LucideAngularModule } from 'lucide-angular';
import { LibraryService } from '../../../../shared/services/library.service';
import { JobsService } from '../../../../shared/services/jobs.service';
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
    private readonly _jobs: JobsService
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

  run() {
    if (this.running || this.plan.length === 0) return;
    // Hand the whole plan to the jobs queue — it renames serially and reports
    // progress there. Close the dialog once everything is queued.
    this._jobs.enqueue(
      this.plan.map(({ game }) => ({
        type: 'rename',
        label: game.title || game.gameId || game.filename,
        filePath: game.path,
        gameId: game.gameId,
        gameName: game.title || game.gameId,
        downloadArtwork: false,
        keepOriginalName: this.convention === 'new',
      }))
    );
    this.close();
  }

  close() {
    if (this.running) return;
    this.closed.emit();
  }
}
