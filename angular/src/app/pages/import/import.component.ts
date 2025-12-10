import { Component } from '@angular/core';
import { LucideAngularModule } from 'lucide-angular';
import { LibraryService } from '../../shared/services/library.service';
import { AsyncPipe } from '@angular/common';

@Component({
  selector: 'app-import',
  imports: [LucideAngularModule, AsyncPipe],
  templateUrl: './import.component.html',
  styleUrl: './import.component.scss',
})
export class ImportComponent {
  constructor(public _libraryService: LibraryService) {}
}
