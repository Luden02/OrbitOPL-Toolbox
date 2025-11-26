import { Component } from '@angular/core';
import { RouterOutlet } from '@angular/router';
import { LogsService } from './shared/services/logs.service';
import PackageInfo from '../../../package.json';

import { LibraryService } from './shared/services/library.service';
import { SharedModule } from './shared/shared/shared.module';

@Component({
  selector: 'app-root',
  imports: [RouterOutlet, SharedModule],
  templateUrl: './app.component.html',
  styleUrl: './app.component.scss',
})
export class AppComponent {
  public currentDirectory = 'None';
  constructor(
    private readonly _logger: LogsService,
    public readonly _libraryService: LibraryService
  ) {}

  ngOnInit() {
    const os = window.navigator.platform;

    this._logger.log(
      'AppComponent',
      `App initialized (${PackageInfo.version}) [OS: ${os}]`
    );
  }
}
