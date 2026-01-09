import { Component } from '@angular/core';
import { LucideAngularModule } from 'lucide-angular';
import { LibraryService } from '../../shared/services/library.service';
import { AsyncPipe, NgIf } from '@angular/common';

@Component({
  selector: 'app-import',
  imports: [LucideAngularModule, AsyncPipe, NgIf],
  templateUrl: './import.component.html',
  styleUrl: './import.component.scss',
})
export class ImportComponent {
  constructor(public _libraryService: LibraryService) {}

  isGameCd: boolean = false;
  isGameDvd: boolean = true;

  autoDiscoveredFile: boolean = false;
  invalidFileDiscovered: boolean = false;
  gamePath: string = '';
  gameName: string = '';
  gameId: string = '';
  downloadArtwork: boolean = true;

  askForGameFile() {
    this._libraryService
      .openAskGameFile(this.isGameCd, this.isGameDvd)
      .then((result) => {
        this.gamePath = result;
        if (result) {
          if (this.isGameCd) {
            console.log('pass');
          }
          if (this.isGameDvd) {
            this._libraryService
              .tryDetermineGameIdFromHex(result)
              .then((result) => {
                if (result.success) {
                  this.autoDiscoveredFile = true;
                  this.gameId = result.gameId;
                  this.gameName = result.gameName;
                }
                if (!result.success) {
                  this.autoDiscoveredFile = false;
                  this.invalidFileDiscovered = true;
                  this.gamePath = '';
                  this.gameId = '';
                  this.gameName = '';

                  setTimeout(() => {
                    this.invalidFileDiscovered = false;
                  }, 10000);
                }
              });
          }
        }
      });
  }

  startAutoImportAttempt() {
    console.log(
      'Importing game file:',
      this.gamePath,
      this.gameId,
      this.gameName
    );
    this._libraryService
      .importGameFile(
        this.gamePath,
        this.gameId,
        this.gameName,
        this.downloadArtwork
      )
      .then((result) => {
        console.log(result);
      });
  }
}
