import { Component } from '@angular/core';
import { LucideAngularModule } from 'lucide-angular';
import { Game } from '@shared/types/game.type';
import {
  BaseDeleteDialogComponent,
  DeleteEntry,
} from '../delete-dialog-base';

@Component({
  selector: 'app-app-delete-dialog',
  imports: [LucideAngularModule],
  templateUrl: './app-delete-dialog.component.html',
  styleUrl: './app-delete-dialog.component.scss',
})
export class AppDeleteDialogComponent extends BaseDeleteDialogComponent {
  protected validateGame(g: Game): boolean {
    return !!g.appFolder && !!g.filename;
  }

  protected registerProgressHandler(handler: (entry: DeleteEntry) => void): () => void {
    window.libraryAPI.onDeleteAppProgress(handler);
    return () => window.libraryAPI.removeAllDeleteAppProgressListeners();
  }

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
