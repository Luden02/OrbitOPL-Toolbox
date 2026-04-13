import { Component, Input } from '@angular/core';
import { Game, gameArt } from '../../../../shared/types/game.type';

import { LibraryService } from '../../../../shared/services/library.service';
import { LucideAngularModule } from 'lucide-angular';
import { SlicePipe } from '@angular/common';

@Component({
  selector: 'app-gamecard',
  imports: [LucideAngularModule, SlicePipe],
  templateUrl: './gamecard.component.html',
  styleUrl: './gamecard.component.scss',
})
export class GamecardComponent {
  @Input() game: Game | undefined;

  constructor(public readonly _libraryService: LibraryService) {}

  public coverArt: gameArt | undefined;
  ngOnInit() {
    if (this.game && Array.isArray(this.game.art)) {
      this.coverArt = this.game.art.find((a) => a.type === 'COV');
    }
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
