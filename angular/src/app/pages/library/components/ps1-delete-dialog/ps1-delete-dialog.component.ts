import { Component, input, output } from '@angular/core';
import { LucideAngularModule } from 'lucide-angular';
import { Game } from '@shared/types/game.type';
import { LibraryService } from '@shared/services/library.service';

interface DeleteEntry {
  label: string;
  path?: string;
  success: boolean;
  error?: string;
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
  overallSuccess = false;

  constructor(private readonly _libraryService: LibraryService) {}

  async ngOnInit() {
    try {
      const result = await this._libraryService.deleteGame(this.game(), true);
      if (result?.entries) {
        this.entries = result.entries;
        this.overallSuccess = !!result.success;
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      this.entries = [{ label: 'Error', success: false, error: msg }];
      this.overallSuccess = false;
    } finally {
      this.deleting = false;
    }
  }

  close() {
    if (this.deleting) return;
    this._libraryService.refreshGamesFiles();
    this.closed.emit();
  }
}
