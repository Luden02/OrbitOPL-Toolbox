import { Component } from '@angular/core';
import {
  GamecardComponent,
  GamecardViewMode,
} from './components/gamecard/gamecard.component';
import { LibraryService } from '../../shared/services/library.service';
import { JobsService } from '../../shared/services/jobs.service';
import { AsyncPipe } from '@angular/common';
import { LucideAngularModule } from 'lucide-angular';
import { Game } from '../../shared/types/game.type';
import { BehaviorSubject, combineLatest, map, Observable } from 'rxjs';

type SystemTab = 'PS2' | 'PS1' | 'APPS';
type SortMode = 'title-asc' | 'title-desc' | 'gameId-asc' | 'gameId-desc';

@Component({
  selector: 'app-library',
  imports: [GamecardComponent, AsyncPipe, LucideAngularModule],
  templateUrl: './library.component.html',
  styleUrl: './library.component.scss',
})
export class LibraryComponent {
  constructor(
    public readonly _libraryService: LibraryService,
    private readonly _jobs: JobsService
  ) {}

  /** Queues a ZSO compression job for every PS2 ISO in the library. */
  convertAllToZso() {
    const candidates = this._libraryService.currentLibraryValue.filter(
      (g) =>
        (g.system ?? 'PS2') === 'PS2' &&
        (g.format === 'ISO' || g.extension?.toLowerCase() === 'iso')
    );
    if (candidates.length === 0) {
      window.alert('No uncompressed PS2 ISO games in the library.');
      return;
    }
    const confirmed = window.confirm(
      `Compress ${candidates.length} PS2 ISO game(s) to ZSO?\n\n` +
        `Each .iso will be replaced with a smaller .zso once its job succeeds.`
    );
    if (!confirmed) return;
    this._jobs.enqueue(
      candidates.map((g) => ({
        type: 'zso',
        label: g.title || g.gameId || g.filename,
        filePath: g.path,
        gameId: g.gameId,
        gameName: g.title || '',
        downloadArtwork: false,
        deleteOriginal: true,
      }))
    );
  }

  private activeTabSubject = new BehaviorSubject<SystemTab>('PS2');
  public activeTab$ = this.activeTabSubject.asObservable();
  private sortModeSubject = new BehaviorSubject<SortMode>('title-asc');
  public sortMode$ = this.sortModeSubject.asObservable();
  private searchSubject = new BehaviorSubject<string>('');
  public search$ = this.searchSubject.asObservable();
  public viewMode: GamecardViewMode = 'grid';
  public sortMode: SortMode = 'title-asc';
  public searchTerm = '';

  public ps2Games$: Observable<Game[]> | undefined;
  public ps1Games$: Observable<Game[]> | undefined;
  public visibleGames$: Observable<Game[]> | undefined;
  public ps2Count$: Observable<number> | undefined;
  public ps1Count$: Observable<number> | undefined;
  public appsCount$: Observable<number> | undefined;
  public totalCount$: Observable<number> | undefined;

  ngOnInit() {
    const library$ = this._libraryService.library$;

    const sortByTitle = (games: Game[]) =>
      [...games].sort((a, b) => (a.title ?? '').localeCompare(b.title ?? ''));

    this.ps2Games$ = library$.pipe(
      map((games) => sortByTitle(games.filter((g) => (g.system ?? 'PS2') === 'PS2')))
    );
    this.ps1Games$ = library$.pipe(
      map((games) => sortByTitle(games.filter((g) => g.system === 'PS1')))
    );
    this.ps2Count$ = this.ps2Games$.pipe(map((g) => g.length));
    this.ps1Count$ = this.ps1Games$.pipe(map((g) => g.length));
    this.appsCount$ = library$.pipe(
      map((games) => games.filter((g) => g.system === 'APPS').length)
    );
    this.totalCount$ = library$.pipe(map((g) => g.length));

    this.visibleGames$ = combineLatest([
      library$,
      this.activeTab$,
      this.sortMode$,
      this.search$,
    ]).pipe(
      map(([games, tab, sortMode, search]) => {
        const [field, direction] = sortMode.split('-') as [
          'title' | 'gameId',
          'asc' | 'desc'
        ];
        const multiplier = direction === 'asc' ? 1 : -1;
        const query = search.trim().toLocaleLowerCase();

        const filteredGames = games
          .filter((g) => {
            if (tab === 'PS1') return g.system === 'PS1';
            if (tab === 'APPS') return g.system === 'APPS';
            return (g.system ?? 'PS2') === 'PS2';
          })
          .filter((g) => {
            if (!query) return true;
            return (
              (g.title ?? '').toLocaleLowerCase().includes(query) ||
              (g.gameId ?? '').toLocaleLowerCase().includes(query)
            );
          });

        return filteredGames.sort((a, b) => {
          const getSortableValue = (game: Game) => {
            if (field === 'title') {
              return (game.title || game.gameId || '').toLocaleLowerCase();
            }
            return (game.gameId || '').toLocaleLowerCase();
          };

          return (
            getSortableValue(a).localeCompare(getSortableValue(b), undefined, {
              numeric: true,
              sensitivity: 'base',
            }) * multiplier
          );
        });
      })
    );
  }

  setTab(tab: SystemTab) {
    this.activeTabSubject.next(tab);
  }

  isActive(tab: SystemTab): boolean {
    return this.activeTabSubject.getValue() === tab;
  }

  toggleViewMode() {
    this.viewMode = this.viewMode === 'grid' ? 'list' : 'grid';
  }

  setSearch(term: string) {
    this.searchTerm = term;
    this.searchSubject.next(term);
  }

  clearSearch() {
    this.setSearch('');
  }

  setSortMode(mode: string) {
    if (!this.isSortMode(mode)) {
      return;
    }

    this.sortMode = mode;
    this.sortModeSubject.next(mode);
  }

  private isSortMode(mode: string): mode is SortMode {
    return (
      mode === 'title-asc' ||
      mode === 'title-desc' ||
      mode === 'gameId-asc' ||
      mode === 'gameId-desc'
    );
  }
}
