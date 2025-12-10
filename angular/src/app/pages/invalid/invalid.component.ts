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

  constructor(public readonly _libraryService: LibraryService) {}

  openRenameTool(filepath: string) {
    const dialog = document.getElementById('rename_tool') as HTMLDialogElement;
    dialog?.showModal();
    this._libraryService.tryDetermineGameIdFromHex(filepath).then((result) => {
      if (result.success) {
        this.renamedFilePath = filepath;
        this.renameGameId = result.gameId;
        this.renameGameName = result.gameName || '';
      }
    });
  }

  openBulkAutoCorrection() {
    const dialog = document.getElementById(
      'bulk_auto_tool'
    ) as HTMLDialogElement;
    dialog?.showModal();
  }

  startBulkAutoCorrection() {
    this._libraryService.bulkAutoCorrection(this.fetchArtwork).then(() => {
      (document.getElementById('bulk_auto_tool') as HTMLDialogElement).close();
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
}
