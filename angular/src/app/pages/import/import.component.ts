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

  importMode: 'ps2-dvd' | 'ps2-cd' | 'ps1' = 'ps2-dvd';

  autoDiscoveredId: boolean = false;
  autoDiscoveredName: boolean = false;
  invalidFileDiscovered: boolean = false;
  gamePath: string = '';
  gameName: string = '';
  gameId: string = '';
  downloadArtwork: boolean = true;
  elfPrefix: string = 'XX.';

  get isGameCd(): boolean {
    return this.importMode === 'ps2-cd';
  }

  get isGameDvd(): boolean {
    return this.importMode === 'ps2-dvd';
  }

  get isGamePsx(): boolean {
    return this.importMode === 'ps1';
  }

  resetImportState() {
    this.autoDiscoveredId = false;
    this.autoDiscoveredName = false;
    this.invalidFileDiscovered = false;
    this.gamePath = '';
    this.gameName = '';
    this.gameId = '';
  }

  askForGameFile() {
    const isSelectingCue = this.isGameCd || this.isGamePsx;
    this._libraryService
      .openAskGameFile(isSelectingCue, this.isGameDvd)
      .then((result) => {
        this.gamePath = result;
        if (result) {
          const detect$ = this.isGamePsx
            ? this._libraryService.tryDeterminePs1GameIdFromHex(result)
            : this._libraryService.tryDetermineGameIdFromHex(result);
          detect$.then((hexResult) => {
              if (hexResult.success) {
                this.autoDiscoveredId = true;
                this.gameId = hexResult.gameId;
                if (hexResult.gameName) {
                  this.autoDiscoveredName = true;
                  this.gameName = hexResult.gameName;
                }
              }
              if (!hexResult.success) {
                this.autoDiscoveredId = false;
                this.autoDiscoveredName = false;
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
      });
  }

  startAutoImportAttempt() {
    if (this.isGamePsx) {
      this._libraryService
        .importPs1Game(
          this.gamePath,
          this.elfPrefix,
          this.downloadArtwork
        )
        .then((result) => {
          if (result?.success) {
            this.resetImportState();
          }
        });
    } else if (this.isGameCd) {
      this._libraryService
        .importPs2CdGame(
          this.gamePath,
          this.gameId,
          this.gameName,
          this.downloadArtwork
        )
        .then((result) => {
          if (result?.success) {
            this.resetImportState();
          }
        });
    } else {
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
}
