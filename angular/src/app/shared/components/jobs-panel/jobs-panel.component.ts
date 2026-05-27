import { Component, OnDestroy } from '@angular/core';
import { AsyncPipe } from '@angular/common';
import { LucideAngularModule } from 'lucide-angular';
import { Subscription } from 'rxjs';
import {
  ImportJob,
  JobsService,
} from '../../services/jobs.service';

@Component({
  selector: 'app-jobs-panel',
  imports: [LucideAngularModule, AsyncPipe],
  templateUrl: './jobs-panel.component.html',
  styleUrl: './jobs-panel.component.scss',
})
export class JobsPanelComponent implements OnDestroy {
  public collapsed = true;
  private sub: Subscription;

  constructor(public _jobs: JobsService) {
    // Auto-expand the panel whenever work is in flight.
    this.sub = this._jobs.activeCount$.subscribe((count) => {
      if (count > 0) {
        this.collapsed = false;
      }
    });
  }

  ngOnDestroy(): void {
    this.sub.unsubscribe();
  }

  toggle() {
    this.collapsed = !this.collapsed;
  }

  trackJob(_index: number, job: ImportJob) {
    return job.id;
  }

  typeLabel(job: ImportJob): string {
    switch (job.type) {
      case 'ps2-cd':
        return 'PS2 CD';
      case 'ps1':
        return 'PS1';
      case 'zso':
        return 'ZSO';
      default:
        return 'PS2 DVD';
    }
  }

  statusIcon(job: ImportJob): string {
    switch (job.status) {
      case 'success':
        return 'circle-check';
      case 'error':
        return 'circle-x';
      case 'running':
        return 'loader';
      default:
        return 'clock';
    }
  }
}
