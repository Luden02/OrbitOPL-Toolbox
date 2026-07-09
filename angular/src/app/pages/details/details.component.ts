import { ApplicationRef, Component, inject } from '@angular/core';
import { Router } from '@angular/router';
import { LucideAngularModule } from 'lucide-angular';
import { LibraryService } from '@shared/services/library.service';
import { CfgService, CFG_KEY_NAME } from '@shared/services/cfg.service';
import { TitleCfgService } from '@shared/services/title-cfg.service';
import { Game, gameArt } from '@shared/types/game.type';

const ESRB_RATINGS: Record<string, number> = {
  'EC': 2, 'E': 3, 'E10+': 3.5, 'E10': 3.5,
  'T': 4, 'M': 4.5, 'AO': 5,
  'RP': 0,
};

const PEGI_RATINGS: Record<string, number> = {
  '3': 2, '7': 3, '12': 3.5, '16': 4, '18': 4.5,
};

@Component({
  selector: 'app-details',
  imports: [LucideAngularModule],
  templateUrl: './details.component.html',
  styleUrl: './details.component.scss',
})
export class DetailsComponent {
  private _router = inject(Router);
  private _library = inject(LibraryService);
  private _cfg = inject(CfgService);
  private _titleCfg = inject(TitleCfgService);
  private _appRef = inject(ApplicationRef);

  game: Game | null = null;
  bgArt: string | null = null;
  covArt: string | null = null;
  screenshots: gameArt[] = [];
  loading = true;

  displayTitle = '';
  developer = '';
  genre = '';
  release = '';
  description = '';
  ratingValue = 0;
  parentalType = '';
  parentalDisplayValue = '';
  players = '';
  layoutVariant: 'default' | 'alt' = 'default';

  ngOnInit() {
    this.game = this._library.selectedGameValue;

    if (!this.game) {
      this.loading = false;
      this._appRef.tick();
      return;
    }

    // ── Artwork — sync, safe outside zone ─────────────────────────
    if (Array.isArray(this.game.art)) {
      this.bgArt = this.findBase64Art(this.game.art, 'BG');
      this.covArt = this.findBase64Art(this.game.art, 'COV');
      this.screenshots = this.game.art
        .filter(
          (a) => a.type?.toUpperCase() === 'SCR' || a.type?.toUpperCase() === 'SCR2'
        )
        .sort((a, b) => {
          const order: Record<string, number> = { SCR: 0, SCR2: 1 };
          return (order[a.type?.toUpperCase() ?? ''] ?? 99) - (order[b.type?.toUpperCase() ?? ''] ?? 99);
        });
    }

    // ── Async metadata — fire-and-forget via .then() + ApplicationRef.tick() ──
    // ApplicationRef.tick() forces full-app change detection regardless of
    // whether zone.js tracked the Promise microtasks (which it cannot do
    // reliably across Electron's contextBridge boundary).
    const root = this._library.currentDirectoryValue;
    if (root) {
      this._loadMetadata(root);
    } else {
      this.loading = false;
      this._appRef.tick();
    }
  }

  // ── Private helpers ───────────────────────────────────────────────

  /**
   * Kick off async metadata loading for the current game. Every .then()
   * callback assigns state directly and then calls ApplicationRef.tick()
   * to force Angular change detection — no dependency on zone.js's
   * microtask tracking (which Electron's contextBridge bypasses).
   */
  private _loadMetadata(root: string): void {
    const game = this.game!;
    const isPs1LauncherApp = game.system === 'APPS' && !!game.isPs1Launcher;
    const isElfApp = game.system === 'APPS' && !game.isPs1Launcher;
    const isDiscGame = !isPs1LauncherApp && !isElfApp && !!game.gameId;

    // ── PS2 / PS1 disc games — metadata from CFG/<gameId>.cfg ─────
    if (isDiscGame && game.gameId) {
      this._cfg.getGameCfg(game.gameId).then((cfg) => {
        this.displayTitle = cfg[CFG_KEY_NAME] || '';
        this.developer = cfg['Developer'] || '';
        this.genre = cfg['Genre'] || '';
        this.release = cfg['Release'] || '';
        this.description = cfg['Description'] || '';
        this.ratingValue = this.parseRating(cfg['RatingText'] || cfg['Rating'] || '');
        this._formatParentalLabel(cfg['Parental'] || '', cfg['ParentalText'] || '');
        this.players = cfg['PlayersText'] || cfg['Players'] || '';
        this._applyFallbackTitle();
        this.loading = false;
        this._appRef.tick();
      }).catch(() => {
        this._applyFallbackTitle();
        this.loading = false;
        this._appRef.tick();
      });
      return;
    }

    // ── PS1 POPStarter (APPS section) — metadata from title.cfg ONLY ──
    if (isPs1LauncherApp && game.appFolder) {
      this._loadTitleCfg(game.appFolder);
      return;
    }

    // ── ELF homebrew apps — metadata from title.cfg ONLY ──
    if (isElfApp && game.appFolder) {
      this._loadTitleCfg(game.appFolder);
      return;
    }

    // ── Unmatched — just finish loading ──────────────────────────
    this._applyFallbackTitle();
    this.loading = false;
    this._appRef.tick();
  }

  /** Load metadata from title.cfg via TitleCfgService. */
  private _loadTitleCfg(folder: string): void {
    this._titleCfg.getTitleCfg(folder).then((data) => {
      if (data.title) this.displayTitle = data.title;
      if (data.developer) this.developer = data.developer;
      if (data.genre) this.genre = data.genre;
      if (data.release) this.release = data.release;
      if (data.description) this.description = data.description;
      if (data.ratingText || data.rating) {
        this.ratingValue = this.parseRating(data.ratingText || data.rating || '');
      }
      if (data.parental || data.parentalText) {
        this._formatParentalLabel(data.parental || '', data.parentalText || '');
      }
      if (data.playersText) this.players = data.playersText;
      this._applyFallbackTitle();
      this.loading = false;
      this._appRef.tick();
    });
  }

  /** Set fallback display title when no data source provided one. */
  private _applyFallbackTitle(): void {
    if (!this.displayTitle && this.game) {
      this.displayTitle = this.game.title || this.game.gameId || this.game.filename;
    }
  }

  /** Parse parental type and display value from "type/value" + optional text. */
  private _formatParentalLabel(parental: string, text: string): void {
    if (parental.includes('/')) {
      this.parentalType = parental.split('/')[0].trim();
      this.parentalDisplayValue = text || parental.split('/')[1].trim();
    } else {
      this.parentalType = '';
      this.parentalDisplayValue = text || parental;
    }
  }

  // ── Template helpers ──────────────────────────────────────────────

  get parentalLabel(): string {
    if (!this.parentalType && !this.parentalDisplayValue) return '';
    if (!this.parentalType) return this.parentalDisplayValue;
    return `${this.parentalType.toUpperCase()} - ${this.parentalDisplayValue}`;
  }

  get isSquareCover(): boolean {
    if (!this.game) return false;
    return this.game.system === 'PS1' || this.game.system === 'APPS';
  }

  get isElfApp(): boolean {
    return this.game?.system === 'APPS' && !this.game?.isPs1Launcher;
  }

  get ratingStars(): boolean[] {
    const r = Math.round(this.ratingValue);
    return [1, 2, 3, 4, 5].map((i) => i <= r);
  }

  get playersCount(): number {
    if (!this.players) return 0;
    const m = this.players.match(/(\d+)/);
    const n = m ? parseInt(m[1], 10) : 0;
    return Math.min(Math.max(n, 1), 4);
  }

  private parseRating(raw: string): number {
    if (!raw) return 0;
    const trimmed = raw.trim();

    const num = Number(trimmed);
    if (!isNaN(num) && num >= 0 && num <= 5) return num;
    if (!isNaN(num) && num >= 0 && num <= 10) return num / 2;

    const upper = trimmed.toUpperCase();
    if (ESRB_RATINGS[upper] !== undefined) return ESRB_RATINGS[upper];
    if (PEGI_RATINGS[upper] !== undefined) return PEGI_RATINGS[upper];

    return 0;
  }

  private findBase64Art(art: gameArt[], type: string): string | null {
    const found = art.find((a) => a.type?.toUpperCase() === type.toUpperCase());
    return found ? `data:image/png;base64,${found.base64}` : null;
  }

  /** Full launcher path including the .elf boot file, using the OS-native separator. */
  get launcherFullPath(): string | null {
    const g = this.game;
    if (!g?.isPs1Launcher || !g.ps1LauncherPath) return null;
    const sep = g.ps1LauncherPath.includes('\\') ? '\\' : '/';
    return g.ps1LauncherBoot
      ? `${g.ps1LauncherPath}${sep}${g.ps1LauncherBoot}`
      : g.ps1LauncherPath;
  }

  back() {
    if (this.game) {
      const system = this.game.system ?? 'PS2';
      this._library.returnTab = system === 'PS2' ? 'PS2' : system === 'PS1' ? 'PS1' : 'APPS';
    }
    this._library.selectGame(null);
    this._router.navigate(['/library']);
  }
}
