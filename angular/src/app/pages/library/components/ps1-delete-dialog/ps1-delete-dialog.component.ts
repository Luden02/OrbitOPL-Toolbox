import { Component } from '@angular/core';
import { LucideAngularModule } from 'lucide-angular';
import { Game } from '@shared/types/game.type';
import { BaseDeleteDialogComponent, DeleteEntry } from '../delete-dialog-base';

/**
 * Delete-progress dialog for PS1 launcher apps.
 *
 * Uses the legacy `deleteGameAndRelatedFiles` IPC channel and listens for
 * `delete-ps1-progress` events. Artwork deletion is optional and matched
 * by the boot ELF filename (`ps1LauncherBoot`).
 */
@Component({
  selector: 'app-ps1-delete-dialog',
  imports: [LucideAngularModule],
  templateUrl: './ps1-delete-dialog.component.html',
  styleUrl: './ps1-delete-dialog.component.scss',
})
export class Ps1DeleteDialogComponent extends BaseDeleteDialogComponent {
  /** Requires `path` (game file) and `gameId` for the legacy API. */
  protected validateGame(g: Game): boolean {
    return !!g.path && !!g.gameId;
  }

  /** Registers a listener for `delete-ps1-progress` IPC events. */
  protected registerProgressHandler(
    handler: (entry: DeleteEntry) => void,
  ): () => void {
    window.libraryAPI.onDeletePs1Progress(handler);
    return () => window.libraryAPI.removeAllDeletePs1ProgressListeners();
  }

  /**
   * Calls the legacy `deleteGameAndRelatedFiles` which removes the game file,
   * VCD, launcher folder, POPS subfolder, and optionally artwork matched
   * by the boot ELF name.
   */
  protected async runDeletion(
    g: Game,
    currentDir: string,
    deleteArtwork: boolean,
  ) {
    const artDir = `${currentDir.replace(/\/$/, '')}/ART`;
    return window.libraryAPI.deleteGameAndRelatedFiles(
      g.path,
      artDir,
      g.gameId,
      g.appFolder,
      deleteArtwork ? g.ps1LauncherBoot : undefined,
    );
  }
}
