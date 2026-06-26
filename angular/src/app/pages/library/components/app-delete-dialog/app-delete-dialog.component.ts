import { Component } from '@angular/core';
import { LucideAngularModule } from 'lucide-angular';
import { Game } from '@shared/types/game.type';
import { BaseDeleteDialogComponent, DeleteEntry } from '../delete-dialog-base';

/**
 * Delete-progress dialog for regular ELF apps.
 *
 * Uses the modern `deleteAppWithProgress` IPC channel and listens for
 * `delete-app-progress` events. Artwork deletion is optional and matched
 * by the boot ELF filename.
 */
@Component({
  selector: 'app-app-delete-dialog',
  imports: [LucideAngularModule],
  templateUrl: './app-delete-dialog.component.html',
  styleUrl: './app-delete-dialog.component.scss',
})
export class AppDeleteDialogComponent extends BaseDeleteDialogComponent {
  /** Requires `appFolder` (relative APPS path) and `filename` (boot ELF). */
  protected validateGame(g: Game): boolean {
    return !!g.appFolder && !!g.filename;
  }

  /** Registers a listener for `delete-app-progress` IPC events. */
  protected registerProgressHandler(
    handler: (entry: DeleteEntry) => void,
  ): () => void {
    window.libraryAPI.onDeleteAppProgress(handler);
    return () => window.libraryAPI.removeAllDeleteAppProgressListeners();
  }

  /**
   * Calls `deleteAppWithProgress` which recursively removes all files in the
   * app folder and optionally artwork files matching the boot ELF name.
   */
  protected async runDeletion(
    g: Game,
    currentDir: string,
    deleteArtwork: boolean,
  ) {
    return window.libraryAPI.deleteAppWithProgress(
      currentDir,
      g.appFolder!,
      deleteArtwork ? g.filename : undefined,
    );
  }
}
