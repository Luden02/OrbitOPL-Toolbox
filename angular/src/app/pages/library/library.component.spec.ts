import { importProvidersFrom } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { BehaviorSubject, firstValueFrom } from 'rxjs';
import type { ComponentFixture } from '@angular/core/testing';
import { LucideAngularModule, icons } from 'lucide-angular';

import { LibraryService } from '../../shared/services/library.service';
import type { Game } from '../../shared/types/game.type';

import { LibraryComponent } from './library.component';

describe('LibraryComponent', () => {
  let component: LibraryComponent;
  let fixture: ComponentFixture<LibraryComponent>;
  let librarySubject: BehaviorSubject<Game[]>;

  const createGame = (gameId: string, title: string, system: 'PS1' | 'PS2') =>
    ({
      filename: `${gameId}.${title}.iso`,
      gameId,
      title,
      cdType: system === 'PS1' ? 'POPS' : 'DVD',
      path: '/tmp',
      extension: '.iso',
      parentPath: '/tmp',
      system,
    }) as Game;

  const games: Game[] = [
    createGame('SLUS_200.02', 'Metal Gear', 'PS2'),
    createGame('SLUS_010.10', 'Ape Escape', 'PS2'),
    createGame('SLUS_100.50', 'Crash Team Racing', 'PS2'),
    createGame('SCUS_944.26', 'Final Fantasy VII', 'PS1'),
  ];

  const getVisibleGameIds = async () => {
    const visibleGames$ = component.visibleGames$;
    if (!visibleGames$) {
      throw new Error('visibleGames$ was not initialized');
    }

    const visibleGames = await firstValueFrom(visibleGames$);
    return visibleGames.map((game) => game.gameId);
  };

  beforeEach(async () => {
    librarySubject = new BehaviorSubject<Game[]>(games);

    await TestBed.configureTestingModule({
      imports: [LibraryComponent],
      providers: [
        importProvidersFrom(LucideAngularModule.pick(icons)),
        {
          provide: LibraryService,
          useValue: {
            library$: librarySubject.asObservable(),
            hasCurrentDirectory$: new BehaviorSubject<boolean>(true).asObservable(),
            refreshGamesFiles: jasmine.createSpy('refreshGamesFiles'),
            downloadAllArt: jasmine.createSpy('downloadAllArt'),
          },
        },
      ],
    })
    .compileComponents();

    fixture = TestBed.createComponent(LibraryComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });

  it('sorts PS2 games by name ascending by default', async () => {
    const gameIds = await getVisibleGameIds();

    expect(gameIds).toEqual(['SLUS_010.10', 'SLUS_100.50', 'SLUS_200.02']);
  });

  it('sorts PS2 games by name descending when set to title-desc', async () => {
    component.setSortMode('title-desc');

    const gameIds = await getVisibleGameIds();

    expect(gameIds).toEqual(['SLUS_200.02', 'SLUS_100.50', 'SLUS_010.10']);
  });

  it('sorts PS2 games by game ID ascending when set to gameId-asc', async () => {
    component.setSortMode('gameId-asc');

    const gameIds = await getVisibleGameIds();

    expect(gameIds).toEqual(['SLUS_010.10', 'SLUS_100.50', 'SLUS_200.02']);
  });

  it('ignores invalid sort mode values', async () => {
    component.setSortMode('invalid-sort-mode');

    const gameIds = await getVisibleGameIds();

    expect(component.sortMode).toBe('title-asc');
    expect(gameIds).toEqual(['SLUS_010.10', 'SLUS_100.50', 'SLUS_200.02']);
  });

  it('keeps sorting behavior the same in list and grid views', async () => {
    component.setSortMode('title-desc');

    component.viewMode = 'grid';
    const gridGameIds = await getVisibleGameIds();

    component.viewMode = 'list';
    const listGameIds = await getVisibleGameIds();

    expect(gridGameIds).toEqual(['SLUS_200.02', 'SLUS_100.50', 'SLUS_010.10']);
    expect(listGameIds).toEqual(gridGameIds);
  });
});
