import { Component } from '@angular/core';
import { GamecardComponent } from './components/gamecard/gamecard.component';
import { LibraryService } from '../../shared/services/library.service';
import { AsyncPipe } from '@angular/common';

@Component({
  selector: 'app-library',
  imports: [GamecardComponent, AsyncPipe],
  templateUrl: './library.component.html',
  styleUrl: './library.component.scss',
})
export class LibraryComponent {
  constructor(public readonly _libraryService: LibraryService) {}
}
