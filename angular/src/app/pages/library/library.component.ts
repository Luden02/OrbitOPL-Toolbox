import { Component } from '@angular/core';
import { GamecardComponent } from './components/gamecard/gamecard.component';
import { LibraryService } from '../../shared/services/library.service';
import { AsyncPipe } from '@angular/common';
import { LucideAngularModule } from 'lucide-angular';
import { Game } from '../../shared/types/game.type';
import { Observable } from 'rxjs';

@Component({
  selector: 'app-library',
  imports: [GamecardComponent, AsyncPipe, LucideAngularModule],
  templateUrl: './library.component.html',
  styleUrl: './library.component.scss',
})
export class LibraryComponent {
  constructor(public readonly _libraryService: LibraryService) {}

  public library$: Observable<Game[]> | undefined;

  ngOnInit() {
    this.library$ = this._libraryService.library$;
  }
}
