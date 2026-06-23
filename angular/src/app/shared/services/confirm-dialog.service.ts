import { isPlatformBrowser } from '@angular/common';
import {
  ApplicationRef,
  Injectable,
  PLATFORM_ID,
  createComponent,
  inject,
} from '@angular/core';
import { ConfirmDialogComponent } from '../components/confirm-dialog/confirm-dialog.component';

export interface ConfirmDialogOptions {
  title: string;
  message: string;
  detail?: string;
  confirmLabel?: string;
  cancelLabel?: string;
  /** Allow closing by clicking the backdrop. Defaults to true. */
  backdropClose?: boolean;
}

@Injectable({ providedIn: 'root' })
export class ConfirmDialogService {
  private readonly appRef = inject(ApplicationRef);
  private readonly platformId = inject(PLATFORM_ID);

  confirm(options: ConfirmDialogOptions): Promise<boolean> {
    // SSR guard — the dialog needs the DOM to mount.
    if (!isPlatformBrowser(this.platformId)) {
      return Promise.resolve(false);
    }

    const componentRef = createComponent(ConfirmDialogComponent, {
      environmentInjector: this.appRef.injector,
    });

    componentRef.setInput('options', options);
    document.body.appendChild(componentRef.location.nativeElement);

    this.appRef.attachView(componentRef.hostView);
    componentRef.changeDetectorRef.detectChanges();

    return new Promise<boolean>((resolve) => {
      let resolved = false;

      componentRef.instance.setCloseCallback((result: boolean) => {
        if (resolved) return;
        resolved = true;

        queueMicrotask(() => {
          this.appRef.detachView(componentRef.hostView);
          componentRef.destroy();
        });
        resolve(result);
      });
    });
  }
}
