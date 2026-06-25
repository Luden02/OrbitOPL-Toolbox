import {
  ChangeDetectorRef,
  Component,
  DestroyRef,
  ElementRef,
  inject,
  input,
  OnInit,
  output,
  viewChild,
} from '@angular/core';
import { LucideAngularModule } from 'lucide-angular';
import { LibraryService } from '@shared/services/library.service';
import { JobsService } from '@shared/services/jobs.service';
import { Game } from '@shared/types/game.type';

type Convention = 'old' | 'new';

interface RenamePlanItem {
  game: Game;
  current: string;
  target: string;
}

interface Ps1RenamePreview {
  vcd: string;
  popsFolder: string;
  appsFolder: string;
}

interface Ps1RenameProgress {
  percent: number;
  stage: string;
}

interface LogEntry {
  id: number;
  time: string;
  text: string;
  type: 'info' | 'success' | 'error' | 'step' | 'change';
  oldText?: string;
  newText?: string;
}

@Component({
  selector: 'app-library-rename-dialog',
  imports: [LucideAngularModule],
  templateUrl: './rename-dialog.component.html',
  styleUrl: './rename-dialog.component.scss',
})
export class LibraryRenameDialogComponent implements OnInit {
  readonly game = input<Game>();
  readonly closed = output<void>();
  readonly logAreaRef = viewChild<ElementRef<HTMLElement>>('logArea');

  convention: Convention = 'new';
  running = false;
  done = false;
  succeeded = 0;
  failed = 0;
  progress = 0;
  currentLabel = '';

  ps1NewTitle = '';
  ps1Preview: Ps1RenamePreview | null = null;
  private initialPs1NewTitle = '';

  ps1DialogState: 'input' | 'running' | 'done' = 'input';
  ps1Log: LogEntry[] = [];

  private plan: RenamePlanItem[] = [];
  private candidates: Game[] = [];
  private logEntryIdCounter = 0;
  private destroyed = false;
  private readonly _cdr = inject(ChangeDetectorRef);
  private readonly _destroyRef = inject(DestroyRef);

  constructor(
    private readonly _libraryService: LibraryService,
    private readonly _jobs: JobsService,
  ) {}

  private isEligible(g: Game): boolean {
    if (g.isPs1Launcher) {
      return !!g.path && !!g.gameId && !!g.title;
    }
    return (
      (g.system ?? 'PS2') === 'PS2' &&
      (g.format === 'ISO' || g.format === 'ZSO') &&
      !!g.path &&
      !!g.gameId &&
      !!g.title
    );
  }

  get isSingle(): boolean {
    return !!this.game();
  }

  get isPs1Launcher(): boolean {
    return !!this.game()?.isPs1Launcher;
  }

  get hasChanges(): boolean {
    if (this.isPs1Launcher) {
      return (
        !!this.ps1NewTitle &&
        this.ps1NewTitle.trim() !== '' &&
        this.ps1NewTitle.trim() !== this.initialPs1NewTitle
      );
    }
    return this.plan.length > 0;
  }

  get ps1CloseAllowed(): boolean {
    return !this.isPs1Launcher || this.ps1DialogState !== 'running';
  }

  get ps1VcdFilename(): string {
    const g = this.game();
    if (!g || !g.isPs1Launcher) return '';
    return g.filename;
  }

  get lastLogType(): LogEntry['type'] | null {
    return this.ps1Log.length > 0
      ? this.ps1Log[this.ps1Log.length - 1].type
      : null;
  }

  ngOnInit() {
    const g = this.game();
    const pool = g ? [g] : this._libraryService.currentLibraryValue;
    this.candidates = pool.filter((g) => this.isEligible(g));
    if (this.isPs1Launcher && g) {
      const ext = g.extension || '.VCD';
      this.ps1NewTitle = g.filename.endsWith(ext)
        ? g.filename.slice(0, -ext.length)
        : g.filename;
      this.initialPs1NewTitle = this.ps1NewTitle;
      this.buildPs1Preview();
    } else {
      this.rebuildPlan();
    }

    this._destroyRef.onDestroy(() => {
      this.destroyed = true;
      window.libraryAPI.removeAllRenamePs1ProgressListeners();
    });
  }

  setConvention(c: Convention) {
    this.convention = c;
    this.rebuildPlan();
  }

  onTitleChange(value: string) {
    this.ps1NewTitle = value;
    this.buildPs1Preview();
  }

  get planCount(): number {
    return this.plan.length;
  }

  get skippedCount(): number {
    return this.candidates.length - this.plan.length;
  }

  private sanitize(name: string): string {
    return name
      .replace(/[\\/:*?"<>|]/g, '')
      .replace(/\s+/g, ' ')
      .trim();
  }

  private buildPs1Preview() {
    const g = this.game();
    if (!g || !g.isPs1Launcher) return;

    const oldTitle = g.title || '';
    const newTitle = this.sanitize(this.ps1NewTitle || '') || '(invalid)';
    const ext = g.extension || '.VCD';

    const oldVcd = g.filename;
    const newVcd = `${newTitle}${ext}`;

    const oldAppsFolder = `POPS_${oldTitle}`;
    const newAppsFolder = `POPS_${newTitle}`;

    const oldPopsFolder = oldTitle;
    const newPopsFolder = newTitle;

    this.ps1Preview = {
      vcd: `POPS/${oldVcd} → POPS/${newVcd}`,
      popsFolder: `POPS/${oldPopsFolder}/ → POPS/${newPopsFolder}/`,
      appsFolder: `APPS/${oldAppsFolder}/ → APPS/${newAppsFolder}/`,
    };
  }

  private rebuildPlan() {
    this.plan = [];
    for (const game of this.candidates) {
      if (game.isPs1Launcher) continue;
      const ext = game.extension;
      const safeTitle = this.sanitize(game.title || game.gameId);
      const target =
        this.convention === 'new'
          ? `${safeTitle}${ext}`
          : `${game.gameId}.${safeTitle}${ext}`;
      const current = `${game.filename}`;
      if (current !== target) {
        this.plan.push({ game, current, target });
      }
    }
  }

  private addLog(
    text: string,
    type: LogEntry['type'] = 'info',
    oldText?: string,
    newText?: string,
  ) {
    const now = new Date();
    const time = now.toLocaleTimeString('en-US', { hour12: false });
    const id = ++this.logEntryIdCounter;
    if (oldText !== undefined && newText !== undefined) {
      this.ps1Log = [...this.ps1Log, { id, time, text, type, oldText, newText }];
    } else {
      this.ps1Log = [...this.ps1Log, { id, time, text, type }];
    }
    this._cdr.detectChanges();
    this.logAreaRef()?.nativeElement.scrollTo({ top: this.logAreaRef()?.nativeElement.scrollHeight ?? 0, behavior: 'instant' });
  }

  private parseChangeMsg(full: string) {
    const arrowIdx = full.indexOf('\u2192');
    if (arrowIdx === -1) return;
    const before = full.slice(0, arrowIdx).trimEnd();
    const after = full.slice(arrowIdx + 1).trim();
    const colonIdx = before.lastIndexOf(':');
    if (colonIdx === -1) return;
    const prefix = before.slice(0, colonIdx + 1) + ' ';
    const oldText = before.slice(colonIdx + 1).trim();
    return { prefix, oldText, newText: after };
  }

  private async runPs1() {
    const g = this.game();
    if (!g || !g.isPs1Launcher || !g.path || !g.gameId) return;

    const newTitle = this.sanitize(this.ps1NewTitle || '');
    if (!newTitle || this.ps1NewTitle.trim() === this.initialPs1NewTitle)
      return;

    this.running = true;
    this.ps1DialogState = 'running';
    this.ps1Log = [];
    this.addLog(`Renaming "${g.title}" → "${newTitle}"`, 'step');

    const handleProgress = (progress: Ps1RenameProgress) => {
      if (this.destroyed) return;
      const isChange =
        progress.stage.startsWith('Renaming VCD:') ||
        progress.stage.startsWith('Renaming VMC') ||
        progress.stage.startsWith('Renaming APPS folder') ||
        progress.stage.startsWith('Renaming ELF:') ||
        progress.stage.startsWith('Updating title.cfg');
      if (isChange) {
        const p = this.parseChangeMsg(progress.stage);
        if (p) {
          this.addLog(p.prefix, 'change', p.oldText, p.newText);
        } else {
          this.addLog(progress.stage, 'change');
        }
      } else {
        this.addLog(progress.stage, 'info');
      }
    };
    window.libraryAPI.onRenamePs1Progress(handleProgress);

    try {
      this.addLog('Step 1 — Renaming folders', 'step');
      const step1 = await window.libraryAPI.renamePs1LauncherStep1(
        g.path,
        g.gameId,
        newTitle,
      );

      if (!step1.success) {
        this.addLog(`Failed: ${step1.message}`, 'error');
        this.ps1DialogState = 'done';
        this.running = false;
        return;
      }
      this.addLog('Folders renamed', 'success');

      if (!step1.newAppsFolder) {
        this.addLog('Internal error: newAppsFolder missing', 'error');
        this.ps1DialogState = 'done';
        this.running = false;
        return;
      }

      this.addLog('Step 2 — Updating APPS contents (ELF, title.cfg)', 'step');
      const step2 = await window.libraryAPI.renamePs1LauncherStep2({
        newAppsFolder: step1.newAppsFolder,
        oldElfFile: step1.oldElfFile,
        newElfFile: step1.newElfFile,
        newCfgContent: step1.newCfgContent,
        newTitle,
      });

      if (step2.success) {
        this.addLog('Internal changes applied', 'success');
        this.addLog('Rename complete!', 'success');
      } else {
        this.addLog(`Failed: ${step2.message}`, 'error');
      }

      this.ps1DialogState = 'done';
      this.running = false;
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      this.addLog(`Error: ${msg}`, 'error');
      this.ps1DialogState = 'done';
      this.running = false;
    } finally {
      window.libraryAPI.removeAllRenamePs1ProgressListeners();
      if (!this.destroyed) this._cdr.detectChanges();
    }
  }

  run() {
    if (this.running) return;

    if (this.isPs1Launcher && this.game()) {
      void this.runPs1();
      return;
    }

    if (this.plan.length === 0) return;
    this._jobs.enqueue(
      this.plan.map(({ game }) => ({
        type: 'rename',
        label: game.title || game.gameId || game.filename,
        filePath: game.path,
        gameId: game.gameId,
        gameName: game.title || game.gameId,
        downloadArtwork: false,
        keepOriginalName: this.convention === 'new',
      })),
    );
    this.close();
  }

  close() {
    if (this.running) return;
    this.closed.emit();
  }
}
