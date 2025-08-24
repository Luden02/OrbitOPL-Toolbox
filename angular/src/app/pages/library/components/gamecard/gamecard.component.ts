import { Component, Input } from '@angular/core';
import { Game, gameArt } from '../../../../shared/types/game.type';
import { ClarityModule } from '@clr/angular';
import { ClarityIcons, unknownStatusIcon } from '@cds/core/icon';

@Component({
  selector: 'app-gamecard',
  imports: [ClarityModule],
  templateUrl: './gamecard.component.html',
  styleUrl: './gamecard.component.scss',
})
export class GamecardComponent {
  @Input() game: Game | undefined;

  public coverArt: gameArt | undefined;
  ngOnInit() {
    ClarityIcons.addIcons(unknownStatusIcon);
    if (this.game && Array.isArray(this.game.art)) {
      this.coverArt = this.game.art.find((a) => a.type === 'COV');
    }
  }
}
