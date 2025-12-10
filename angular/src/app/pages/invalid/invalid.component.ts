import { Component } from '@angular/core';

import { LibraryService } from '../../shared/services/library.service';
import { AsyncPipe, CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';

@Component({
  selector: 'app-invalid',
  imports: [AsyncPipe, CommonModule, FormsModule],
  templateUrl: './invalid.component.html',
  styleUrl: './invalid.component.scss',
})
export class InvalidComponent {
  renamedFile: any;
  renameGameId: string = '';
  renameGameName: string = '';
  isModalOpen: boolean = false;
  constructor(public readonly _libraryService: LibraryService) {}

  openRenameModal(file: any) {
    this.renamedFile = file;
    this.isModalOpen = true;
  }

  sendRenaming() {
    this._libraryService
      .renameInvalidGameFile(
        this.renamedFile.path,
        this.renameGameId,
        this.renameGameName
      )
      .then(() => (this.isModalOpen = false));
  }
}
