import { Component } from '@angular/core';
import { RouterLink, RouterLinkActive, RouterOutlet } from '@angular/router';
import { LogsService } from './shared/services/logs.service';
import PackageInfo from '../../../package.json';
import {
  ClarityModule,
  ClrButtonGroup,
  ClrButtonGroupModule,
  ClrTooltip,
  ClrTooltipModule,
  ClrVerticalNavModule,
} from '@clr/angular';
import {
  ClarityIcons,
  hardDriveIcon,
  resistorIcon,
  unknownStatusIcon,
  disconnectIcon,
  uploadCloudIcon,
} from '@cds/core/icon';
import { LibraryService } from './shared/services/library.service';
import { AsyncPipe } from '@angular/common';

@Component({
  selector: 'app-root',
  imports: [
    RouterOutlet,
    RouterLink,
    RouterLinkActive,
    ClarityModule,
    ClrButtonGroupModule,
    ClrVerticalNavModule,
    AsyncPipe,
  ],
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
    ClarityIcons.addIcons(
      hardDriveIcon,
      unknownStatusIcon,
      resistorIcon,
      disconnectIcon,
      uploadCloudIcon
    );
    const os = window.navigator.platform;

    this._logger.log(
      'AppComponent',
      `App initialized (${PackageInfo.version}) [OS: ${os}]`
    );
  }
}
