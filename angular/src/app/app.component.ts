import { Component } from '@angular/core';
import { RouterLink, RouterLinkActive, RouterOutlet } from '@angular/router';
import { LogsService } from './shared/services/logs.service';
import PackageInfo from '../../../package.json';
import { LibraryService } from './shared/services/library.service';
import { AsyncPipe } from '@angular/common';
import { LucideAngularModule } from 'lucide-angular';
import { JobsPanelComponent } from './shared/components/jobs-panel/jobs-panel.component';
import { UpdateService } from './shared/services/update.service';

@Component({
  selector: 'app-root',
  imports: [
    RouterOutlet,
    RouterLink,
    RouterLinkActive,
    AsyncPipe,
    LucideAngularModule,
    JobsPanelComponent,
  ],
  templateUrl: './app.component.html',
  styleUrl: './app.component.scss',
})
export class AppComponent {
  public currentDirectory = 'None';
  public readonly version = PackageInfo.version;
  constructor(
    private readonly _logger: LogsService,
    public readonly _libraryService: LibraryService,
    public readonly _updateService: UpdateService
  ) {}

  ngOnInit() {
    const os = window.navigator.platform;

    this._logger.log(
      'AppComponent',
      `App initialized (${PackageInfo.version}) [OS: ${os}]`
    );

    this._libraryService.restoreLastDirectory();

    // Check for a newer GitHub release in the background.
    this._updateService.check();
  }
}
