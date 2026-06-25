import { Component, ElementRef, afterNextRender, input, signal, viewChild } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { LucideAngularModule } from 'lucide-angular';
import type { ConfirmDialogOptions } from '../../services/confirm-dialog.service';

@Component({
  selector: 'app-confirm-dialog',
  imports: [LucideAngularModule, FormsModule],
  templateUrl: './confirm-dialog.component.html',
  styleUrl: './confirm-dialog.component.scss',
})
export class ConfirmDialogComponent {
  readonly options = input.required<ConfirmDialogOptions>();

  readonly checkboxChecked = signal(false);

  private readonly cancelBtn = viewChild.required<ElementRef<HTMLButtonElement>>('cancelBtn');

  private _closeCallback: ((result: boolean) => void) | null = null;

  /** Set by the service to receive the close result directly. */
  setCloseCallback(cb: (result: boolean) => void): void {
    this._closeCallback = cb;
  }

  constructor() {
    afterNextRender(() => this.cancelBtn().nativeElement.focus());
  }

  onKeydown(event: KeyboardEvent): void {
    if (event.key === 'Escape') {
      event.preventDefault();
      this.close(false);
    }
  }

  close(result: boolean): void {
    this._closeCallback?.(result);
  }
}
