import { Component } from '@angular/core';
import { LogEntry, LogsService } from '../../shared/services/logs.service';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { LucideAngularModule } from 'lucide-angular';

@Component({
  selector: 'app-logs',
  imports: [CommonModule, FormsModule, LucideAngularModule],
  templateUrl: './logs.component.html',
  styleUrl: './logs.component.scss',
})
export class LogsComponent {
  logs: LogEntry[] = [];

  constructor(private readonly _logger: LogsService) {}

  get verboseMode(): boolean {
    return this._logger.isVerboseMode;
  }

  get visibleLogs(): LogEntry[] {
    return this.verboseMode
      ? this.logs
      : this.logs.filter((l) => l.type !== 'VRB');
  }

  ngOnInit() {
    this._logger.getLogs().subscribe((logs) => {
      this.logs = logs;
    });
  }

  toggleVerboseMode() {
    this._logger.toggleVerboseMode();
  }

  clearLogs() {
    this._logger.clearLogs();
  }

  copyLogs() {
    navigator.clipboard?.writeText(this.getFormattedLogs());
  }

  shortTime(timestamp: string): string {
    const d = new Date(timestamp);
    return Number.isNaN(d.getTime())
      ? timestamp
      : d.toLocaleTimeString(undefined, { hour12: false });
  }

  getFormattedLogs(): string {
    return this.visibleLogs
      .map(
        (log) =>
          `[${log.timestamp}] [${log.type}] [${log.location}] ${log.message}`
      )
      .join('\n');
  }
}
