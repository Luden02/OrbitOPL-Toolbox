import { Component } from '@angular/core';
import { GamecardComponent } from './components/gamecard/gamecard.component';
import { LibraryService } from '../../shared/services/library.service';
import { AsyncPipe } from '@angular/common';
import { LucideAngularModule } from 'lucide-angular';
import { Game } from '../../shared/types/game.type';
import { BehaviorSubject, combineLatest, map, Observable } from 'rxjs';

type SystemTab = 'PS2' | 'PS1';

@Component({
  selector: 'app-library',
  imports: [GamecardComponent, AsyncPipe, LucideAngularModule],
  templateUrl: './library.component.html',
  styleUrl: './library.component.scss',
})
export class LibraryComponent {
  constructor(public readonly _libraryService: LibraryService) {}

  private activeTabSubject = new BehaviorSubject<SystemTab>('PS2');
  public activeTab$ = this.activeTabSubject.asObservable();

  public ps2Games$: Observable<Game[]> | undefined;
  public ps1Games$: Observable<Game[]> | undefined;
  public visibleGames$: Observable<Game[]> | undefined;
  public ps2Count$: Observable<number> | undefined;
  public ps1Count$: Observable<number> | undefined;

  ngOnInit() {
    const library$ = this._libraryService.library$;

    this.ps2Games$ = library$.pipe(
      map((games) => games.filter((g) => (g.system ?? 'PS2') === 'PS2'))
    );
    this.ps1Games$ = library$.pipe(
      map((games) => games.filter((g) => g.system === 'PS1'))
    );
    this.ps2Count$ = this.ps2Games$.pipe(map((g) => g.length));
    this.ps1Count$ = this.ps1Games$.pipe(map((g) => g.length));

    this.visibleGames$ = combineLatest([library$, this.activeTab$]).pipe(
      map(([games, tab]) =>
        games.filter((g) =>
          tab === 'PS1' ? g.system === 'PS1' : (g.system ?? 'PS2') === 'PS2'
        )
      )
    );
  }

  setTab(tab: SystemTab) {
    this.activeTabSubject.next(tab);
  }

  isActive(tab: SystemTab): boolean {
    return this.activeTabSubject.getValue() === tab;
  }
}
