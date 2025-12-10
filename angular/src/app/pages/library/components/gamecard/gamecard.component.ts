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
}
