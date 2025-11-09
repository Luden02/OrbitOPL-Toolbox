import { Injectable } from '@angular/core';
import { BehaviorSubject, Observable } from 'rxjs';

export interface LogEntry {
  timestamp: string;
  location: string;
  message: string;
  type: 'INF' | 'ERR' | 'VRB';
}

@Injectable({
  providedIn: 'root',
})
export class LogStore {
  private verboseMode: boolean;

  constructor() {
    const stored = localStorage.getItem('verboseMode');
    this.verboseMode = stored === 'true';
  }

  get isVerboseMode(): boolean {
    return this.verboseMode;
  }

  toggleVerboseMode(): void {
    this.verboseMode = !this.verboseMode;
    localStorage.setItem('verboseMode', String(this.verboseMode));
  }

  private logs: LogEntry[] = [];

  private logsSubject = new BehaviorSubject<LogEntry[]>(this.logs);

  getLogs(): Observable<LogEntry[]> {
    return this.logsSubject.asObservable();
  }

  log(location: string, message: string): void {
    this.addLog(location, message, 'INF');
  }

  error(location: string, message: string): void {
    this.addLog(location, message, 'ERR');
  }

  verbose(location: string, message: string): void {
    this.addLog(location, message, 'VRB');
  }

  private addLog(location: string, message: string, type: 'INF' | 'ERR' | 'VRB'): void {
    const entry: LogEntry = {
      timestamp: new Date().toISOString(),
      location,
      message,
      type,
    };
    this.logs.push(entry);
    this.logsSubject.next([...this.logs]);
  }

  clearLogs(): void {
    this.logs = [];
    this.logsSubject.next([]);
  }
}
