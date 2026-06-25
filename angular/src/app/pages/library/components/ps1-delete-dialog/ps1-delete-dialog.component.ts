import {
  ChangeDetectorRef,
  Component,
  DestroyRef,
  ElementRef,
  inject,
  input,
  output,
  viewChild,
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
  readonly logAreaRef = viewChild<ElementRef<HTMLElement>>('logArea');

  entries: DeleteEntry[] = [];
  deleting = true;
  overallSuccess = true;
  private entryIdCounter = 0;
  private destroyed = false;
  private readonly _cdr = inject(ChangeDetectorRef);
  private readonly _destroyRef = inject(DestroyRef);

  constructor(private readonly _libraryService: LibraryService) {
    this._destroyRef.onDestroy(() => {
      this.destroyed = true;
      window.libraryAPI.removeAllDeletePs1ProgressListeners();
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
      setTimeout(() => {
        const el = this.logAreaRef()?.nativeElement;
        if (el) {
          el.scrollTo({ top: el.scrollHeight, behavior: 'instant' });
        }
      });
    };
    window.libraryAPI.onDeletePs1Progress(handleProgress);

    try {
      const currentDir = (this._libraryService.currentDirectoryValue ?? '').replace(/[\\/]/g, '/');
      const artDir = `${currentDir.replace(/\/$/, '')}/ART`;
      const result = await window.libraryAPI.deleteGameAndRelatedFiles(
        g.path,
        artDir,
        g.gameId,
        g.appFolder,
      );
      if (result) {
        this.overallSuccess = !!result.success;
        for (const entry of (result.entries || [])) {
          const exists = this.entries.some(
            e => e.label === entry.label && e.path === entry.path
          );
          if (!exists) {
            this.entries = [...this.entries, { ...entry, id: ++this.entryIdCounter }];
          }
        }
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
    this.closed.emit();
  }
}
