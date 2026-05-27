import {
  Component,
  EventEmitter,
  Input,
  OnInit,
  Output,
} from '@angular/core';
import { LucideAngularModule } from 'lucide-angular';
import { Game } from '../../../../shared/types/game.type';
import {
  CfgService,
  COMPAT_MODES,
  CFG_KEY_COMPAT,
  CFG_KEY_NAME,
  CFG_KEY_VMC0,
  CFG_KEY_VMC1,
  GameCfg,
} from '../../../../shared/services/cfg.service';
import { VmcInfo, VmcService } from '../../../../shared/services/vmc.service';

@Component({
  selector: 'app-game-cfg-dialog',
  imports: [LucideAngularModule],
  templateUrl: './game-cfg-dialog.component.html',
  styleUrl: './game-cfg-dialog.component.scss',
})
export class GameCfgDialogComponent implements OnInit {
  @Input({ required: true }) game!: Game;
  @Output() closed = new EventEmitter<void>();

  readonly compatModes = COMPAT_MODES;

  entries: GameCfg = {};
  title = '';
  compat: boolean[] = new Array(8).fill(false);
  vmc0 = '';
  vmc1 = '';
  cards: VmcInfo[] = [];
  loading = true;
  saving = false;

  constructor(
    private readonly _cfg: CfgService,
    private readonly _vmc: VmcService
  ) {}

  async ngOnInit() {
    this.cards = await this._vmc.refresh();
    this.entries = await this._cfg.getGameCfg(this.game.gameId);
    this.title = this.entries[CFG_KEY_NAME] ?? '';
    const compatVal = parseInt(this.entries[CFG_KEY_COMPAT] ?? '0', 10) || 0;
    this.compat = this.compatModes.map((m) => (compatVal & (1 << m.bit)) !== 0);
    this.vmc0 = this.entries[CFG_KEY_VMC0] ?? '';
    this.vmc1 = this.entries[CFG_KEY_VMC1] ?? '';
    this.loading = false;
  }

  private readonly knownKeys = [
    CFG_KEY_NAME,
    CFG_KEY_COMPAT,
    CFG_KEY_VMC0,
    CFG_KEY_VMC1,
  ];

  /** Card names to offer, including any assigned card no longer on disk. */
  get cardNames(): string[] {
    const names = new Set(this.cards.map((c) => c.name));
    if (this.vmc0) names.add(this.vmc0);
    if (this.vmc1) names.add(this.vmc1);
    return Array.from(names).sort((a, b) => a.localeCompare(b));
  }

  get otherKeyCount(): number {
    return Object.keys(this.entries).filter(
      (k) => !this.knownKeys.includes(k)
    ).length;
  }

  async save() {
    this.saving = true;
    const next: GameCfg = { ...this.entries };

    const trimmed = this.title.trim();
    if (trimmed) next[CFG_KEY_NAME] = trimmed;
    else delete next[CFG_KEY_NAME];

    let mask = 0;
    this.compatModes.forEach((m, i) => {
      if (this.compat[i]) mask |= 1 << m.bit;
    });
    if (mask > 0) next[CFG_KEY_COMPAT] = String(mask);
    else delete next[CFG_KEY_COMPAT];

    if (this.vmc0) next[CFG_KEY_VMC0] = this.vmc0;
    else delete next[CFG_KEY_VMC0];
    if (this.vmc1) next[CFG_KEY_VMC1] = this.vmc1;
    else delete next[CFG_KEY_VMC1];

    await this._cfg.saveGameCfg(this.game.gameId, next);
    this.saving = false;
    this.closed.emit();
  }

  close() {
    this.closed.emit();
  }
}
