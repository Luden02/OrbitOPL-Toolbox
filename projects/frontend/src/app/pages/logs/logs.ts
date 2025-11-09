import { Component, OnInit } from '@angular/core';
import { LogEntry, LogStore } from '../../shared/services/log-store';
import { TextareaModule } from 'primeng/textarea';
import { ToggleSwitchModule } from 'primeng/toggleswitch';

@Component({
  selector: 'app-logs',
  imports: [TextareaModule, ToggleSwitchModule],
  templateUrl: './logs.html',
  styleUrl: './logs.scss',
})
export class Logs implements OnInit {
  logs: LogEntry[] = [];
  checked: boolean = false;
  constructor(private readonly _logger: LogStore) {}

  get verboseMode(): boolean {
    return this._logger.isVerboseMode;
  }

  get serializedLogs(): string {
    return JSON.stringify(this.logs, null, 2);
  }

  ngOnInit() {
    this._logger.getLogs().subscribe((logs) => {
      this.logs = logs;
    });
    this.checked = this.verboseMode;
  }

  toggleVerboseMode() {
    this._logger.toggleVerboseMode();
  }
}
