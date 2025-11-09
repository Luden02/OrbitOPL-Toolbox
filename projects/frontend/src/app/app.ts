import { Component } from '@angular/core';
import { RouterOutlet } from '@angular/router';

import { LogStore } from './shared/services/log-store';
import PackageInfo from '../../../../package.json';
import { MenubarModule } from 'primeng/menubar';
import { MenuItem, PrimeIcons } from 'primeng/api';

@Component({
  selector: 'app-root',
  imports: [RouterOutlet, MenubarModule],
  templateUrl: './app.html',
  styleUrl: './app.scss',
})
export class App {
  menuitems: MenuItem[] = [
    {
      label: 'Game Library',
      routerLink: '',
      icon: PrimeIcons.HOME,
    },
    {
      label: 'More',
      icon: PrimeIcons.ELLIPSIS_H,
      items: [
        {
          label: 'Logs',
          routerLink: '/logs',
          icon: PrimeIcons.FILE,
        },
      ],
    },
  ];
  constructor(private logStore: LogStore) {
    this.logStore.log(
      'AppInit',
      `App initialized on Version: ${PackageInfo.version} [OS: ${window.navigator.platform}]`
    );
  }
}
