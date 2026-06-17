import { Component, EventEmitter, Input, Output } from '@angular/core';
import { LucideAngularModule } from 'lucide-angular';
import { UpdateService } from '../../services/update.service';

type Platform = 'win' | 'mac' | 'linux';

@Component({
  selector: 'app-update-modal',
  imports: [LucideAngularModule],
  templateUrl: './update-modal.component.html',
  styleUrl: './update-modal.component.scss',
})
export class UpdateModalComponent {
  @Input() update: UpdateCheckResult | null = null;
  @Output() closed = new EventEmitter<void>();

  /** Default to the tab matching the user's current OS. */
  activeTab: Platform = this.detectPlatform();

  constructor(private readonly _updateService: UpdateService) {}

  setTab(tab: Platform) {
    this.activeTab = tab;
  }

  isActive(tab: Platform): boolean {
    return this.activeTab === tab;
  }

  /** Open the GitHub release page in the user's browser. */
  openRelease() {
    this._updateService.openRelease();
  }

  close() {
    this.closed.emit();
  }

  private detectPlatform(): Platform {
    const ua = `${window.navigator.userAgent} ${window.navigator.platform}`.toLowerCase();
    if (ua.includes('win')) return 'win';
    if (ua.includes('mac') || ua.includes('darwin')) return 'mac';
    return 'linux';
  }
}
