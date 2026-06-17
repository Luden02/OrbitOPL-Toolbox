import { Component } from '@angular/core';

import { LibraryService } from '../../shared/services/library.service';
import {
  JobsService,
  NewImportJob,
} from '../../shared/services/jobs.service';
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

  constructor(
    public readonly _libraryService: LibraryService,
    private readonly _jobs: JobsService
  ) {}

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
    // Resolve game IDs first, then queue a rename (and optional artwork) job
    // per file so the whole batch is tracked in the jobs queue.
    this._libraryService
      .planBulkAutoCorrection()
      .then(({ resolved, skipped }) => {
        const jobs: NewImportJob[] = [];
        for (const item of resolved) {
          jobs.push({
            type: 'rename',
            label: item.gameName || item.gameId,
            filePath: item.path,
            gameId: item.gameId,
            gameName: item.gameName,
            downloadArtwork: false,
            keepOriginalName: this.bulkConvention === 'new',
          });
          if (this.fetchArtwork) {
            jobs.push({
              type: 'artwork',
              label: item.gameName || item.gameId,
              filePath: item.path,
              gameId: item.gameId,
              gameName: item.gameName,
              downloadArtwork: false,
              system: 'PS2',
            });
          }
        }
        if (jobs.length > 0) this._jobs.enqueue(jobs);
        this.bulkResult = { corrected: resolved.length, skipped };
      })
      .finally(() => {
        this.bulkRunning = false;
      });
  }

  sendRenaming() {
    const jobs: NewImportJob[] = [
      {
        type: 'rename',
        label: this.renameGameName || this.renameGameId,
        filePath: this.renamedFilePath,
        gameId: this.renameGameId,
        gameName: this.renameGameName,
        downloadArtwork: false,
        // Invalid-file fixups use the old convention (keep the GAMEID. prefix).
        keepOriginalName: false,
      },
    ];
    if (this.fetchArtwork) {
      jobs.push({
        type: 'artwork',
        label: this.renameGameName || this.renameGameId,
        filePath: this.renamedFilePath,
        gameId: this.renameGameId,
        gameName: this.renameGameName,
        downloadArtwork: false,
        system: 'PS2',
      });
    }
    this._jobs.enqueue(jobs);
    (document.getElementById('rename_tool') as HTMLDialogElement).close();
  }

  closeRenameTool() {
    (document.getElementById('rename_tool') as HTMLDialogElement).close();
  }
}
