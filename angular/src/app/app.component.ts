import { Component } from '@angular/core';
import { RouterLink, RouterLinkActive, RouterOutlet } from '@angular/router';
import { LogsService } from './shared/services/logs.service';
import PackageInfo from '../../../package.json';
import { LibraryService } from './shared/services/library.service';
import { AsyncPipe } from '@angular/common';
import { LucideAngularModule } from 'lucide-angular';
import { lastValueFrom } from 'rxjs';

@Component({
  selector: 'app-root',
  imports: [
    RouterOutlet,
    RouterLink,
    RouterLinkActive,
    AsyncPipe,
    LucideAngularModule,
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
    const os = window.navigator.platform;

    this._logger.log(
      'AppComponent',
      `App initialized (${PackageInfo.version}) [OS: ${os}]`
    );
  }
}
