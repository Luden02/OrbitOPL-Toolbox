import { Injectable } from '@angular/core';
import { BehaviorSubject, Observable } from 'rxjs';
import { LogsService } from './logs.service';

/**
 * Reads and persists application settings through the Electron settings store
 * (window.libraryAPI.getSettings / setSetting). Acts as the renderer-side
 * cache so components can bind to the current values reactively.
 */
@Injectable({
  providedIn: 'root',
})
export class SettingsService {
  private settingsSubject = new BehaviorSubject<AppSettings>({
    autoReconnect: true,
  });
  public get settings$(): Observable<AppSettings> {
    return this.settingsSubject.asObservable();
  }

  private loaded = false;

  constructor(private readonly _logger: LogsService) {}

  /** Loads settings from the main process once and caches them. */
  public async load(): Promise<AppSettings> {
    if (!window.libraryAPI?.getSettings) {
      return this.settingsSubject.value;
    }
    try {
      const settings = await window.libraryAPI.getSettings();
      this.settingsSubject.next(settings);
      this.loaded = true;
      return settings;
    } catch (error) {
      this._logger.error(
        'settingsService',
        `Failed to load settings: ${error}`
      );
      return this.settingsSubject.value;
    }
  }

  public get current(): AppSettings {
    return this.settingsSubject.value;
  }

  /** Persists a single setting and updates the local cache. */
  public async set<K extends keyof AppSettings>(
    key: K,
    value: AppSettings[K]
  ): Promise<void> {
    if (!this.loaded) {
      await this.load();
    }
    try {
      const updated = await window.libraryAPI.setSetting(key, value);
      this.settingsSubject.next(updated);
    } catch (error) {
      this._logger.error(
        'settingsService',
        `Failed to persist setting "${String(key)}": ${error}`
      );
    }
  }
}
