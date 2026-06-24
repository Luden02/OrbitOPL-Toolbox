import { Component, EventEmitter, Input, OnInit, Output } from '@angular/core';
import { LucideAngularModule } from 'lucide-angular';
import { Game } from '../../../../shared/types/game.type';
import { LibraryService } from '../../../../shared/services/library.service';

interface DeleteEntry {
  label: string;
  path?: string;
  success: boolean;
  error?: string;
}

@Component({
  selector: 'app-ps1-delete-dialog',
  imports: [LucideAngularModule],
  templateUrl: './ps1-delete-dialog.component.html',
  styleUrl: './ps1-delete-dialog.component.scss',
})
export class Ps1DeleteDialogComponent implements OnInit {
  @Input() game!: Game;
  @Output() closed = new EventEmitter<void>();

  entries: DeleteEntry[] = [];
  deleting = true;
  overallSuccess = false;

  constructor(private readonly _library: LibraryService) {}

  async ngOnInit() {
    const result = await this._library.deleteGame(this.game, true);
    if (result?.entries) {
      this.entries = result.entries;
      this.overallSuccess = !!result.success;
    }
    this.deleting = false;
  }

  close() {
    if (this.deleting) return;
    this._library.refreshGamesFiles();
    this.closed.emit();
  }
}
