import { Component } from '@angular/core';

import { LibraryService } from '../../shared/services/library.service';
import { AsyncPipe, CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { LucideAngularModule } from 'lucide-angular';

@Component({
  selector: 'app-invalid',
  imports: [AsyncPipe, CommonModule, FormsModule, LucideAngularModule],
  templateUrl: './invalid.component.html',
  styleUrl: './invalid.component.scss',
})
export class InvalidComponent {
  renamedFilePath: string = '';
  renameGameId: string = '';
  renameGameName: string = '';
  fetchArtwork: boolean = false;

  bulkConvention: 'old' | 'new' = 'new';
  bulkRunning: boolean = false;
  bulkResult: { corrected: number; skipped: number } | null = null;

  constructor(public readonly _libraryService: LibraryService) {}

  openRenameTool(filepath: string) {
    const dialog = document.getElementById('rename_tool') as HTMLDialogElement;
    dialog?.showModal();
    // Auto-discover the game ID straight from the disc image — handles ISO
    // (raw scan) and ZSO (decompression) alike.
    this._libraryService.resolveIsoGameId(filepath).then((result) => {
      if (result.success && result.gameId) {
        this.renamedFilePath = filepath;
        this.renameGameId = result.gameId;
        this.renameGameName = result.gameName || '';
      }
    });
  }

  openBulkAutoCorrection() {
    this.bulkResult = null;
    const dialog = document.getElementById(
      'bulk_auto_tool'
    ) as HTMLDialogElement;
    dialog?.showModal();
  }

  closeBulkAutoCorrection() {
    if (this.bulkRunning) return;
    (document.getElementById('bulk_auto_tool') as HTMLDialogElement)?.close();
  }

  startBulkAutoCorrection() {
    if (this.bulkRunning) return;
    this.bulkRunning = true;
    this.bulkResult = null;
    this._libraryService
      .bulkAutoCorrection(this.fetchArtwork, this.bulkConvention)
      .then((result) => {
        this.bulkResult = result;
      })
      .finally(() => {
        this.bulkRunning = false;
      });
  }

  sendRenaming() {
    this._libraryService
      .renameInvalidGameFile(
        this.renamedFilePath,
        this.renameGameId,
        this.renameGameName
      )
      .then(() => {
        if (this.fetchArtwork) {
          this._libraryService
            .downloadArtByGameId(this.renameGameId)
            .then(() => {
              (
                document.getElementById('rename_tool') as HTMLDialogElement
              ).close();
            });
        } else {
          (document.getElementById('rename_tool') as HTMLDialogElement).close();
        }
      });
  }

  closeRenameTool() {
    (document.getElementById('rename_tool') as HTMLDialogElement).close();
  }
}
