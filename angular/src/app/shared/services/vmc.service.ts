import { Injectable } from '@angular/core';
import { BehaviorSubject, Observable } from 'rxjs';
import { LibraryService } from './library.service';
import { LogsService } from './logs.service';

export interface VmcInfo {
  name: string;
  sizeBytes: number;
  sizeMb: number;
}

export const VMC_SIZES_MB = [8, 16, 32, 64];

@Injectable({
  providedIn: 'root',
})
export class VmcService {
  private cardsSubject = new BehaviorSubject<VmcInfo[]>([]);
  public get cards$(): Observable<VmcInfo[]> {
    return this.cardsSubject.asObservable();
  }

  constructor(
    private readonly _library: LibraryService,
    private readonly _logger: LogsService,
  ) {}

  public get cards(): VmcInfo[] {
    return this.cardsSubject.value;
  }

  async refresh(): Promise<VmcInfo[]> {
    const root = this._library.currentDirectoryValue;
    if (!root) {
      this.cardsSubject.next([]);
      return [];
    }
    const res = await window.libraryAPI.listVmc(root);
    if (!res.success) {
      this._logger.error('vmcService', `Failed to list VMCs: ${res.message}`);
      return this.cardsSubject.value;
    }
    this.cardsSubject.next(res.cards);
    return res.cards;
  }

  /**
   * Check per-game POPS VMC files for a PS1 launcher app.
   * Returns whether SLOT0.VMC and SLOT1.VMC exist in VMC/POPS/<gameTitle>/.
   * Does NOT update cardsSubject (these are per-game, not global cards).
   */
  async checkPops(
    gameTitle: string,
  ): Promise<{ slot0: string | null; slot1: string | null }> {
    const root = this._library.currentDirectoryValue;
    if (!root) return { slot0: null, slot1: null };
    const res = await window.libraryAPI.checkPopsVmc(root, gameTitle);
    if (!res.success) {
      this._logger.error(
        'vmcService',
        `Failed to check POPS VMC for "${gameTitle}"`,
      );
      return { slot0: null, slot1: null };
    }
    return { slot0: res.slot0, slot1: res.slot1 };
  }

  async create(
    name: string,
    sizeMb: number,
  ): Promise<{ ok: boolean; name?: string; message?: string }> {
    const root = this._library.currentDirectoryValue;
    if (!root) return { ok: false, message: 'No directory mounted.' };
    const res = await window.libraryAPI.createVmc(root, name, sizeMb);
    if (res.success) {
      this._logger.log('vmcService', `Created VMC ${res.name} (${sizeMb} MB)`);
      await this.refresh();
    } else {
      this._logger.error('vmcService', `Create VMC failed: ${res.message}`);
    }
    return { ok: res.success, name: res.name, message: res.message };
  }

  async delete(name: string): Promise<boolean> {
    const root = this._library.currentDirectoryValue;
    if (!root) return false;
    const res = await window.libraryAPI.deleteVmc(root, name);
    if (res.success) {
      this._logger.log('vmcService', `Deleted VMC ${name}`);
      await this.refresh();
    } else {
      this._logger.error('vmcService', `Delete VMC failed: ${res.message}`);
    }
    return res.success;
  }
}
