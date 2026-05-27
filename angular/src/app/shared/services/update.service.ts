import { Injectable } from '@angular/core';
import { BehaviorSubject, Observable } from 'rxjs';
import { LogsService } from './logs.service';

@Injectable({
  providedIn: 'root',
})
export class UpdateService {
  private resultSubject = new BehaviorSubject<UpdateCheckResult | null>(null);
  public get result$(): Observable<UpdateCheckResult | null> {
    return this.resultSubject.asObservable();
  }

  private checkingSubject = new BehaviorSubject<boolean>(false);
  public get checking$(): Observable<boolean> {
    return this.checkingSubject.asObservable();
  }

  private dismissedSubject = new BehaviorSubject<boolean>(false);
  public get dismissed$(): Observable<boolean> {
    return this.dismissedSubject.asObservable();
  }

  constructor(private readonly _logger: LogsService) {}

  public async check(): Promise<UpdateCheckResult | null> {
    if (!window.libraryAPI?.checkForUpdates) {
      return null;
    }
    this.checkingSubject.next(true);
    try {
      const result = await window.libraryAPI.checkForUpdates();
      this.resultSubject.next(result);
      this.dismissedSubject.next(false);
      if (result.updateAvailable) {
        this._logger.log(
          'updateService',
          `Update available: ${result.latestVersion} (current ${result.currentVersion})`
        );
      } else if (result.error) {
        this._logger.error(
          'updateService',
          `Update check failed: ${result.error}`
        );
      } else {
        this._logger.log('updateService', 'Application is up to date');
      }
      return result;
    } finally {
      this.checkingSubject.next(false);
    }
  }

  public openRelease(): void {
    const url = this.resultSubject.value?.releaseUrl;
    if (url) {
      window.libraryAPI.openExternal(url);
    }
  }

  public dismiss(): void {
    this.dismissedSubject.next(true);
  }
}
