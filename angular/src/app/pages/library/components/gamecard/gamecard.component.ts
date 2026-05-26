import { Component, Input, SimpleChanges } from '@angular/core';
import { Game, gameArt } from '../../../../shared/types/game.type';

import { LibraryService } from '../../../../shared/services/library.service';
import { LucideAngularModule } from 'lucide-angular';
import { SlicePipe } from '@angular/common';

export type GamecardViewMode = 'grid' | 'list';

@Component({
  selector: 'app-gamecard',
  imports: [LucideAngularModule, SlicePipe],
  templateUrl: './gamecard.component.html',
  styleUrl: './gamecard.component.scss',
})
export class GamecardComponent {
  @Input() game: Game | undefined;
  @Input() viewMode: GamecardViewMode = 'grid';

  constructor(public readonly _libraryService: LibraryService) {}

  public displayArt: gameArt | undefined;

  ngOnInit() {
    this.updateDisplayArt();
  }

  ngOnChanges(changes: SimpleChanges) {
    if (changes['game'] || changes['viewMode']) {
      this.updateDisplayArt();
    }
  }

  private updateDisplayArt() {
    if (this.game && Array.isArray(this.game.art)) {
      const artType = this.viewMode === 'list' ? 'ICO' : 'COV';
      this.displayArt = this.game.art.find(
        (a) => a.type?.toUpperCase() === artType
      );
    } else {
      this.displayArt = undefined;
    }
  }

  fetchArtwork() {
    if (!this.game) return;
    this._libraryService.downloadArtByGameId(this.game.gameId, this.game.system);
  }

  confirmDelete() {
    if (!this.game) return;
    const confirmed = window.confirm(
      `Are you sure you want to delete "${this.game.title || this.game.gameId}"?\nThis will also remove associated artwork.`
    );
    if (confirmed) {
      this._libraryService.deleteGame(this.game);
    }
  }
}
