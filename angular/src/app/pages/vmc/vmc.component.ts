import { Component, OnInit } from '@angular/core';
import { AsyncPipe } from '@angular/common';
import { LucideAngularModule } from 'lucide-angular';
import { LibraryService } from '../../shared/services/library.service';
import { VMC_SIZES_MB, VmcService } from '../../shared/services/vmc.service';

@Component({
  selector: 'app-vmc',
  imports: [LucideAngularModule, AsyncPipe],
  templateUrl: './vmc.component.html',
  styleUrl: './vmc.component.scss',
})
export class VmcComponent implements OnInit {
  readonly sizes = VMC_SIZES_MB;

  newName = '';
  newSize = 8;
  creating = false;
  error = '';

  constructor(
    public readonly _library: LibraryService,
    public readonly _vmc: VmcService
  ) {}

  ngOnInit() {
    this._vmc.refresh();
  }

  async create() {
    this.error = '';
    if (!this.newName.trim()) {
      this.error = 'Enter a name for the card.';
      return;
    }
    this.creating = true;
    const res = await this._vmc.create(this.newName, this.newSize);
    this.creating = false;
    if (res.ok) {
      this.newName = '';
    } else {
      this.error = res.message || 'Could not create the card.';
    }
  }

  confirmDelete(name: string) {
    if (window.confirm(`Delete memory card "${name}"? Saved data on it will be lost.`)) {
      this._vmc.delete(name);
    }
  }
}
