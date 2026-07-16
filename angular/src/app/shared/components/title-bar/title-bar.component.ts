import { Component, DestroyRef, inject, OnInit } from '@angular/core';
import { LucideAngularModule } from 'lucide-angular';
import PackageInfo from '../../../../../../package.json';

@Component({
  selector: 'app-title-bar',
  imports: [LucideAngularModule],
  templateUrl: './title-bar.component.html',
  styleUrl: './title-bar.component.scss',
})
export class TitleBarComponent implements OnInit {
  public readonly version = PackageInfo.version;
  public visible = false;
  public maximized = false;

  ngOnInit() {
    window.windowAPI.platform().then((platform) => {
      // macOS keeps its native frame/traffic lights; only draw our own
      // title bar where the main process created a frameless window.
      this.visible = platform !== 'darwin';
    });

    window.windowAPI.isMaximized().then((isMaximized) => {
      this.maximized = isMaximized;
    });
    window.windowAPI.onMaximizedChange((isMaximized) => {
      this.maximized = isMaximized;
    });

    const destroyRef = inject(DestroyRef);
    destroyRef.onDestroy(() =>
      window.windowAPI.removeAllMaximizedChangeListeners()
    );
  }

  minimize() {
    window.windowAPI.minimize();
  }

  maximizeToggle() {
    window.windowAPI.maximizeToggle();
  }

  close() {
    window.windowAPI.close();
  }
}
