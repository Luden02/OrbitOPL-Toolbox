import { Component, OnInit } from '@angular/core';
import { AsyncPipe } from '@angular/common';
import { LucideAngularModule } from 'lucide-angular';
import { HddService } from '../../shared/services/hdd.service';
import { SettingsService } from '../../shared/services/settings.service';

/**
 * PS2 HDD page: connect to an APA-formatted disk (via OPL's NBD server —
 * Settings → Network → "Start NBD server" on the console) and manage the
 * HDL games installed on it.
 */
@Component({
  selector: 'app-hdd',
  imports: [LucideAngularModule, AsyncPipe],
  templateUrl: './hdd.component.html',
  styleUrl: './hdd.component.scss',
})
export class HddComponent implements OnInit {
  host = '';
  connecting = false;
  error = '';

  constructor(
    public readonly _hdd: HddService,
    private readonly _settings: SettingsService,
  ) {}

  async ngOnInit() {
    const settings = await this._settings.load();
    if (!this.host && settings.lastNbdHost) {
      this.host = settings.lastNbdHost;
    }
    await this._hdd.syncFromMain();
  }

  async connect() {
    this.error = '';
    this.connecting = true;
    const res = await this._hdd.connectNbd(this.host);
    this.connecting = false;
    if (!res.ok) {
      this.error = res.message || 'Could not connect.';
    }
  }

  disconnect() {
    void this._hdd.disconnect();
  }

  refresh() {
    void this._hdd.refreshGames();
  }

  formatBytes(bytes: number): string {
    if (!Number.isFinite(bytes) || bytes <= 0) return '0 B';
    const units = ['B', 'KB', 'MB', 'GB', 'TB'];
    const i = Math.min(units.length - 1, Math.floor(Math.log(bytes) / Math.log(1024)));
    return `${(bytes / Math.pow(1024, i)).toFixed(i === 0 ? 0 : 1)} ${units[i]}`;
  }

  usedPercent(info: HddInfo): number {
    if (info.sizeBytes <= 0) return 0;
    return Math.min(100, Math.round(((info.sizeBytes - info.freeBytes) / info.sizeBytes) * 100));
  }

  mediaLabel(mediaType: number): string {
    switch (mediaType) {
      case 0x14: return 'DVD';
      case 0x12: return 'CD';
      case 0x10: return 'PSX CD';
      default: return `0x${mediaType.toString(16)}`;
    }
  }

  /** OPL compatibility modes: bit n => MODE n+1. */
  compatLabel(flags: number): string {
    if (!flags) return '—';
    const modes: string[] = [];
    for (let bit = 0; bit < 8; bit++) {
      if (flags & (1 << bit)) modes.push(`M${bit + 1}`);
    }
    return modes.join(' ');
  }
}
