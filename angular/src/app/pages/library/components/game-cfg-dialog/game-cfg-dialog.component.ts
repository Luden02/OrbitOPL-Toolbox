import { Component, input, output } from '@angular/core';
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
export class GameCfgDialogComponent {
  readonly game = input.required<Game>();
  readonly closed = output<void>();

  private readonly _cfg: CfgService;
  private readonly _vmc: VmcService;

  readonly compatModes = COMPAT_MODES;

  entries: GameCfg = {};
  title = '';
  private initialTitle = '';
  compat: boolean[] = new Array(8).fill(false);
  vmc0 = '';
  vmc1 = '';
  cards: VmcInfo[] = [];
  slot0Cards: VmcInfo[] = [];
  slot1Cards: VmcInfo[] = [];
  loading = true;
  saving = false;

  private readonly knownKeys = [
    CFG_KEY_NAME,
    CFG_KEY_COMPAT,
    CFG_KEY_VMC0,
    CFG_KEY_VMC1,
  ];

  constructor(cfg: CfgService, vmc: VmcService) {
    this._cfg = cfg;
    this._vmc = vmc;
  }

  async ngOnInit() {
    const g = this.game();
    this.entries = await this._cfg.getGameCfg(g.gameId);
    this.title = this.entries[CFG_KEY_NAME] ?? '';
    this.initialTitle = this.title;

    if (g.isPs1Launcher) {
      const vmcSub = g.ps1VmcSub ?? '';
      if (vmcSub) {
        const vmcs = await this._vmc.checkPops(vmcSub);
        if (vmcs.slot0) {
          this.slot0Cards = [{ name: vmcs.slot0, sizeBytes: 0, sizeMb: 0 }];
          this.vmc0 = vmcs.slot0;
        }
        if (vmcs.slot1) {
          this.slot1Cards = [{ name: vmcs.slot1, sizeBytes: 0, sizeMb: 0 }];
          this.vmc1 = vmcs.slot1;
        }
      }
    } else {
      this.cards = await this._vmc.refresh();
      this.vmc0 = this.entries[CFG_KEY_VMC0] ?? '';
      this.vmc1 = this.entries[CFG_KEY_VMC1] ?? '';
    }

    if (!g.isPs1Launcher) {
      const compatVal = parseInt(this.entries[CFG_KEY_COMPAT] ?? '0', 10) || 0;
      this.compat = this.compatModes.map(
        (m) => (compatVal & (1 << m.bit)) !== 0,
      );
    }

    this.loading = false;
  }

  get cardNames(): string[] {
    const names = new Set(this.cards.map((c) => c.name));
    if (this.vmc0) names.add(this.vmc0);
    if (this.vmc1) names.add(this.vmc1);
    return Array.from(names).sort((a, b) => a.localeCompare(b));
  }

  get slot0Names(): string[] {
    return this.slot0Cards.map((c) => c.name);
  }

  get slot1Names(): string[] {
    return this.slot1Cards.map((c) => c.name);
  }

  get otherKeyCount(): number {
    return Object.keys(this.entries).filter(
      (k) => !this.knownKeys.includes(k),
    ).length;
  }

  get hasChanges(): boolean {
    if (this.game().isPs1Launcher) {
      return this.title.trim() !== this.initialTitle;
    }
    return true;
  }

  async save() {
    this.saving = true;
    const next: GameCfg = { ...this.entries };

    const trimmed = this.title.trim();
    if (trimmed) next[CFG_KEY_NAME] = trimmed;
    else delete next[CFG_KEY_NAME];

    if (!this.game().isPs1Launcher) {
      let mask = 0;
      this.compatModes.forEach((m, i) => {
        if (this.compat[i]) mask |= 1 << m.bit;
      });
      if (mask > 0) next[CFG_KEY_COMPAT] = String(mask);
      else delete next[CFG_KEY_COMPAT];
    } else {
      delete next[CFG_KEY_COMPAT];
    }

    if (!this.game().isPs1Launcher) {
      if (this.vmc0) next[CFG_KEY_VMC0] = this.vmc0;
      else delete next[CFG_KEY_VMC0];
      if (this.vmc1) next[CFG_KEY_VMC1] = this.vmc1;
      else delete next[CFG_KEY_VMC1];
    } else {
      delete next[CFG_KEY_VMC0];
      delete next[CFG_KEY_VMC1];
    }

    await this._cfg.saveGameCfg(this.game().gameId, next);

    if (this.game().isPs1Launcher && this.game().ps1LauncherPath) {
      const titleCfgTitle = trimmed || this.game().gameId;
      await window.libraryAPI.updatePs1TitleCfg(this.game().ps1LauncherPath!, titleCfgTitle);
    }

    this.saving = false;
    this.closed.emit();
  }

  onCompatChange(index: number, event: Event): void {
    const input = event.target as HTMLInputElement | null;
    if (input) this.compat[index] = input.checked;
  }

  close() {
    this.closed.emit();
  }
}
