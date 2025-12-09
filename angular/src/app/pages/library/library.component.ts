import { Component } from '@angular/core';
import { GamecardComponent } from './components/gamecard/gamecard.component';
import { LibraryService } from '../../shared/services/library.service';
import { AsyncPipe } from '@angular/common';
import { ClarityModule } from '@clr/angular';
import { ClarityIcons, downloadCloudIcon, refreshIcon } from '@cds/core/icon';

@Component({
  selector: 'app-library',
  imports: [GamecardComponent, AsyncPipe, ClarityModule],
  templateUrl: './library.component.html',
  styleUrl: './library.component.scss',
})
export class LibraryComponent {
  constructor(public readonly _libraryService: LibraryService) {}

  ngOnInit() {
    ClarityIcons.addIcons(refreshIcon, downloadCloudIcon);
  }
}
