import { Component } from '@angular/core';
import { LucideAngularModule } from 'lucide-angular';
import { Game } from '@shared/types/game.type';
import { BaseDeleteDialogComponent, DeleteEntry } from '../delete-dialog-base';

@Component({
  selector: 'app-ps1-delete-dialog',
  imports: [LucideAngularModule],
  templateUrl: './ps1-delete-dialog.component.html',
  styleUrl: './ps1-delete-dialog.component.scss',
})
export class Ps1DeleteDialogComponent extends BaseDeleteDialogComponent {
  protected validateGame(g: Game): boolean {
    return !!g.path && !!g.gameId;
  }

  protected registerProgressHandler(
    handler: (entry: DeleteEntry) => void,
  ): () => void {
    window.libraryAPI.onDeletePs1Progress(handler);
    return () => window.libraryAPI.removeAllDeletePs1ProgressListeners();
  }

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
