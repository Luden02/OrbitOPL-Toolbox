import { Injectable } from '@angular/core';
import { BehaviorSubject, Observable } from 'rxjs';
import { LibraryService } from './library.service';
import { LogsService } from './logs.service';
import { SettingsService } from './settings.service';

/**
 * Renderer-side state for the PS2 HDD connection (APA/HDL disks reached via
 * OPL's NBD server, or a locally attached drive in a later milestone). This
 * is a second, independent mount-like state alongside the OPL directory —
 * mounting one does not affect the other.
 */
@Injectable({
  providedIn: 'root',
})
export class HddService {
  private connectionSubject = new BehaviorSubject<HddInfo | null>(null);
  public get connection$(): Observable<HddInfo | null> {
    return this.connectionSubject.asObservable();
  }
  public get connectionValue(): HddInfo | null {
    return this.connectionSubject.value;
  }

  private gamesSubject = new BehaviorSubject<HdlGame[]>([]);
  public get games$(): Observable<HdlGame[]> {
    return this.gamesSubject.asObservable();
  }

  /** Games whose HDL header could not be read during the last refresh. */
  private skippedSubject = new BehaviorSubject<{ partitionId: string; reason: string }[]>([]);
  public get skipped$(): Observable<{ partitionId: string; reason: string }[]> {
    return this.skippedSubject.asObservable();
  }

  private busySubject = new BehaviorSubject<boolean>(false);
  public get busy$(): Observable<boolean> {
    return this.busySubject.asObservable();
  }

  constructor(
    private readonly _library: LibraryService,
    private readonly _logger: LogsService,
    private readonly _settings: SettingsService,
  ) {}

  private setBusy(action?: string): void {
    this.busySubject.next(!!action);
    this._library.setLoading(!!action);
    this._library.setCurrentAction(action);
  }

  public async connectNbd(host: string, port?: number): Promise<{ ok: boolean; message?: string }> {
    const trimmed = host.trim();
    if (!trimmed) {
      return { ok: false, message: 'Enter the IP address shown by OPL.' };
    }
    this.setBusy(`Connecting to ${trimmed}…`);
    try {
      const res = await window.hddAPI.connect({ kind: 'nbd', host: trimmed, port });
      if (!res.success || !res.info) {
        this._logger.error('hddService', `HDD connect failed: ${res.message}`);
        return { ok: false, message: res.message || 'Could not connect.' };
      }
      this.connectionSubject.next(res.info);
      this._logger.log('hddService', `Connected to PS2 HDD at ${res.info.label}`);
      void this._settings.set('lastNbdHost', trimmed);
      await this.refreshGames();
      return { ok: true };
    } catch (error) {
      this._logger.error('hddService', `HDD connect failed: ${error}`);
      return { ok: false, message: String(error) };
    } finally {
      this.setBusy(undefined);
    }
  }

  public async disconnect(): Promise<void> {
    this.setBusy('Disconnecting from PS2 HDD…');
    try {
      await window.hddAPI.disconnect();
      this.connectionSubject.next(null);
      this.gamesSubject.next([]);
      this.skippedSubject.next([]);
      this._logger.log('hddService', 'Disconnected from PS2 HDD');
    } finally {
      this.setBusy(undefined);
    }
  }

  public async refreshGames(): Promise<void> {
    if (!this.connectionValue) return;
    this.setBusy('Reading installed games…');
    try {
      const res = await window.hddAPI.listGames();
      if (!res.success) {
        this._logger.error('hddService', `Listing HDD games failed: ${res.message}`);
        return;
      }
      this.gamesSubject.next(res.games ?? []);
      this.skippedSubject.next(res.skipped ?? []);
      if (res.info) {
        this.connectionSubject.next(res.info);
      }
      this._logger.log('hddService', `Found ${res.games?.length ?? 0} installed game(s)`);
    } finally {
      this.setBusy(undefined);
    }
  }

  /** Restores connection state if the renderer reloads while main is connected. */
  public async syncFromMain(): Promise<void> {
    try {
      const status = await window.hddAPI.status();
      if (status.connected && status.info) {
        this.connectionSubject.next(status.info);
        await this.refreshGames();
      }
    } catch {
      // Preload API missing (e.g. tests) — stay disconnected.
    }
  }
}
