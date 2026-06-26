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

/** A single entry in the deletion progress log. */
export interface DeleteEntry {
  /** Short human-readable label (e.g. "Game file", "ART file"). */
  label: string;
  /** Full filesystem path of the deleted item, if applicable. */
  path?: string;
  /** Whether this individual operation succeeded. */
  success: boolean;
  /** Error message if the operation failed. */
  error?: string;
  /** Monotonically increasing ID for `ngFor` tracking. */
  id?: number;
}

/**
 * Abstract base for delete-progress dialogs.
 *
 * Handles the common lifecycle:
 *   1. Validate the game object via {@link validateGame}.
 *   2. Register a progress listener via {@link registerProgressHandler}.
 *   3. Execute deletion via {@link runDeletion}.
 *   4. Merge real-time progress entries with the final result set.
 *   5. Clean up listeners and flip `deleting` to `false`.
 *
 * Subclasses only need to implement the three abstract methods for
 * their specific IPC channels and backend API calls.
 */
@Directive()
export abstract class BaseDeleteDialogComponent {
  /** The game being deleted. */
  readonly game = input.required<Game>();
  /** Whether to also delete associated artwork files. */
  readonly deleteArtwork = input(false);
  /** Emitted when the user closes the dialog after deletion completes. */
  readonly closed = output<void>();
  /** Reference to the scrollable log area for auto-scrolling. */
  readonly logAreaRef = viewChild<ElementRef<HTMLElement>>('logArea');

  /** Progress entries accumulated during deletion. */
  entries: DeleteEntry[] = [];
  /** Whether the deletion is still in progress. */
  deleting = true;
  /** Whether every operation succeeded. */
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

  /**
   * Guard the game object before deletion begins.
   * Return `false` to abort — the dialog will stay open with no entries.
   */
  protected abstract validateGame(g: Game): boolean;

  /**
   * Subscribe to real-time progress events from the main process.
   * Must return a cleanup function that removes the listener.
   */
  protected abstract registerProgressHandler(
    handler: (entry: DeleteEntry) => void,
  ): () => void;

  /**
   * Execute the actual deletion and return the final result.
   * `currentDir` is the OPL root directory (normalised to forward slashes).
   */
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

  /** Close the dialog — only allowed after deletion is complete. */
  close() {
    if (this.deleting) return;
    this.closed.emit();
  }

  /** Read and normalise the current OPL root directory. */
  private _getCurrentDir(): string {
    return (this._libraryService.currentDirectoryValue ?? '').replace(
      /[\\/]/g,
      '/',
    );
  }
}
