import { Injectable } from '@angular/core';
import { LibraryService } from './library.service';
import { LogsService } from './logs.service';

export type GameCfg = Record<string, string>;

/** OPL per-game config keys (the sigil is part of the key). */
export const CFG_KEY_NAME = '#Name';
export const CFG_KEY_LONGNAME = '#LongName';
export const CFG_KEY_COMPAT = '$Compatibility';
export const CFG_KEY_VMC0 = '$VMC_0';
export const CFG_KEY_VMC1 = '$VMC_1';

/** Compatibility modes; bit N (value 1<<N) maps to OPL "Mode N+1". */
export const COMPAT_MODES: { bit: number; label: string; hint: string }[] = [
  { bit: 0, label: 'Accurate Reads', hint: 'Emulate CD/DVD drive read behaviour' },
  { bit: 1, label: 'Synchronous Mode', hint: 'Read data immediately rather than in background' },
  { bit: 2, label: 'Unhook Syscalls', hint: 'Do not stay resident after the game resets the IOP' },
  { bit: 3, label: '0 PSS mode', hint: 'Report PSS video sizes as zero so they are skipped' },
  { bit: 4, label: 'Emulate DVD-DL', hint: 'Handle flattened DVD9-to-DVD5 images' },
  { bit: 5, label: 'Disable IGR', hint: 'Turn off In-Game Reset' },
  { bit: 6, label: 'High module storage', hint: 'Shift module storage to avoid memory conflicts' },
  { bit: 7, label: 'Hide DEV9 module', hint: 'Prevent dev9 module visibility' },
];

@Injectable({
  providedIn: 'root',
})
export class CfgService {
  constructor(
    private readonly _library: LibraryService,
    private readonly _logger: LogsService
  ) {}

  async getGameCfg(gameId: string): Promise<GameCfg> {
    const root = this._library.currentDirectoryValue;
    if (!root) return {};
    const res = await window.libraryAPI.readGameCfg(root, gameId);
    if (!res.success) {
      this._logger.error('cfgService', `Failed to read CFG: ${res.message}`);
      return {};
    }
    return res.entries;
  }

  async saveGameCfg(gameId: string, entries: GameCfg): Promise<boolean> {
    const root = this._library.currentDirectoryValue;
    if (!root) return false;
    const res = await window.libraryAPI.writeGameCfg(root, gameId, entries);
    if (!res.success) {
      this._logger.error('cfgService', `Failed to write CFG: ${res.message}`);
      return false;
    }
    this._logger.log('cfgService', `Saved CFG for ${gameId}`);
    return true;
  }
}
