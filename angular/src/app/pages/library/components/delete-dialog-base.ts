import {
  ChangeDetectorRef,
  DestroyRef,
  Directive,
  ElementRef,
  inject,
  input,
  output,
  viewChild,
} from '@angular/core';
import { Game } from '@shared/types/game.type';
import { LibraryService } from '@shared/services/library.service';

export interface DeleteEntry {
  label: string;
  path?: string;
  success: boolean;
  error?: string;
  id?: number;
}

@Directive()
export abstract class BaseDeleteDialogComponent {
  readonly game = input.required<Game>();
  readonly deleteArtwork = input(false);
  readonly closed = output<void>();
  readonly logAreaRef = viewChild<ElementRef<HTMLElement>>('logArea');

  entries: DeleteEntry[] = [];
  deleting = true;
  overallSuccess = true;

  protected entryIdCounter = 0;
  private destroyed = false;
  private _cleanupProgress?: () => void;

  protected readonly _libraryService = inject(LibraryService);
  private readonly _cdr = inject(ChangeDetectorRef);
  private readonly _destroyRef = inject(DestroyRef);

  constructor() {
    this._destroyRef.onDestroy(() => {
      this.destroyed = true;
      this._cleanupProgress?.();
    });
  }

  protected abstract validateGame(g: Game): boolean;
  protected abstract registerProgressHandler(
    handler: (entry: DeleteEntry) => void,
  ): () => void;
  protected abstract runDeletion(
    g: Game,
    currentDir: string,
    deleteArtwork: boolean,
  ): Promise<{ success: boolean; entries: DeleteEntry[] }>;

  async ngOnInit() {
    const g = this.game();
    if (!g || !this.validateGame(g)) return;

    this._cleanupProgress = this.registerProgressHandler((entry) => {
      if (this.destroyed) return;
      this.entries = [...this.entries, { ...entry, id: ++this.entryIdCounter }];
      if (!entry.success) this.overallSuccess = false;
      this._cdr.detectChanges();
      setTimeout(() => {
        const el = this.logAreaRef()?.nativeElement;
        if (el) {
          el.scrollTo({ top: el.scrollHeight, behavior: 'instant' });
        }
      });
    });

    try {
      const currentDir = this._getCurrentDir();
      const result = await this.runDeletion(
        g,
        currentDir,
        this.deleteArtwork(),
      );
      if (result) {
        this.overallSuccess = !!result.success;
        for (const entry of result.entries || []) {
          const exists = this.entries.some(
            (e) => e.label === entry.label && e.path === entry.path,
          );
          if (!exists) {
            this.entries = [
              ...this.entries,
              { ...entry, id: ++this.entryIdCounter },
            ];
          }
        }
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      this.entries = [
        ...this.entries,
        {
          label: 'Error',
          success: false,
          error: msg,
          id: ++this.entryIdCounter,
        },
      ];
      this.overallSuccess = false;
    } finally {
      if (this._cleanupProgress) this._cleanupProgress();
      this.deleting = false;
      if (!this.destroyed) this._cdr.detectChanges();
    }
  }

  close() {
    if (this.deleting) return;
    this.closed.emit();
  }

  private _getCurrentDir(): string {
    return (this._libraryService.currentDirectoryValue ?? '').replace(
      /[\\/]/g,
      '/',
    );
  }
}
