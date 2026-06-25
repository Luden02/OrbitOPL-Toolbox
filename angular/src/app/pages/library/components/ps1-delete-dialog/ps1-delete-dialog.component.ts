import {
  ChangeDetectorRef,
  Component,
  DestroyRef,
  inject,
  input,
  output,
} from '@angular/core';
import { LucideAngularModule } from 'lucide-angular';
import { Game } from '@shared/types/game.type';
import { LibraryService } from '@shared/services/library.service';

interface DeleteEntry {
  label: string;
  path?: string;
  success: boolean;
  error?: string;
  id?: number;
}

@Component({
  selector: 'app-ps1-delete-dialog',
  imports: [LucideAngularModule],
  templateUrl: './ps1-delete-dialog.component.html',
  styleUrl: './ps1-delete-dialog.component.scss',
})
export class Ps1DeleteDialogComponent {
  readonly game = input.required<Game>();
  readonly closed = output<void>();

  entries: DeleteEntry[] = [];
  deleting = true;
  overallSuccess = true;
  private entryIdCounter = 0;
  private destroyed = false;
  private readonly _cdr = inject(ChangeDetectorRef);
  private readonly _destroyRef = inject(DestroyRef);
  private progressCb: ((entry: DeleteEntry) => void) | null = null;

  constructor(private readonly _libraryService: LibraryService) {
    this._destroyRef.onDestroy(() => {
      this.destroyed = true;
      if (this.progressCb) {
        window.libraryAPI.removeAllDeletePs1ProgressListeners();
        this.progressCb = null;
      }
    });
  }

  async ngOnInit() {
    const g = this.game();
    if (!g || !g.path || !g.gameId) return;

    const handleProgress = (entry: DeleteEntry) => {
      if (this.destroyed) return;
      this.entries = [...this.entries, { ...entry, id: ++this.entryIdCounter }];
      if (!entry.success) this.overallSuccess = false;
      this._cdr.detectChanges();
    };
    this.progressCb = (entry) => handleProgress(entry);
    window.libraryAPI.onDeletePs1Progress(this.progressCb);

    try {
      const currentDir = this._libraryService.currentDirectoryValue ?? '';
      const sep = currentDir.includes('\\') ? '\\' : '/';
      const artDir = `${currentDir.replace(/[\\/]$/, '')}${sep}ART`;
      const result = await window.libraryAPI.deleteGameAndRelatedFiles(
        g.path,
        artDir,
        g.gameId,
        g.appFolder,
      );
      if (result) {
        this.overallSuccess = !!result.success;
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      this.entries = [...this.entries, { label: 'Error', success: false, error: msg, id: ++this.entryIdCounter }];
      this.overallSuccess = false;
    } finally {
      window.libraryAPI.removeAllDeletePs1ProgressListeners();
      this.deleting = false;
      if (!this.destroyed) this._cdr.detectChanges();
    }
  }

  close() {
    if (this.deleting) return;
    this._libraryService.refreshGamesFiles();
    this.closed.emit();
  }
}
