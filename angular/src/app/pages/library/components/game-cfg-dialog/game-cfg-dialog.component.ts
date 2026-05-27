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
  GameCfg,
} from '../../../../shared/services/cfg.service';

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
  loading = true;
  saving = false;

  constructor(private readonly _cfg: CfgService) {}

  async ngOnInit() {
    this.entries = await this._cfg.getGameCfg(this.game.gameId);
    this.title = this.entries[CFG_KEY_NAME] ?? '';
    const compatVal = parseInt(this.entries[CFG_KEY_COMPAT] ?? '0', 10) || 0;
    this.compat = this.compatModes.map((m) => (compatVal & (1 << m.bit)) !== 0);
    this.loading = false;
  }

  get otherKeyCount(): number {
    return Object.keys(this.entries).filter(
      (k) => k !== CFG_KEY_NAME && k !== CFG_KEY_COMPAT
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

    await this._cfg.saveGameCfg(this.game.gameId, next);
    this.saving = false;
    this.closed.emit();
  }

  close() {
    this.closed.emit();
  }
}
