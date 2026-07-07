import { Injectable } from '@angular/core';
import { LibraryService } from './library.service';
import { LogsService } from './logs.service';

export interface TitleCfgData {
  title?: string;
  developer?: string;
  genre?: string;
  release?: string;
  ratingText?: string;
  rating?: string;
  description?: string;
}

@Injectable({
  providedIn: 'root',
})
export class TitleCfgService {
  constructor(
    private readonly _library: LibraryService,
    private readonly _logger: LogsService
  ) { }

  async getTitleCfg(folder: string): Promise<TitleCfgData> {
    const root = this._library.currentDirectoryValue;
    if (!root) {
      this._logger.log('titleCfg', `getTitleCfg(${folder}): no root directory`);
      return {};
    }
    const res = await window.libraryAPI.readAppTitleCfg(root, folder);
    if (!res.success) {
      this._logger.error('titleCfg', `Failed to read title.cfg for ${folder}: ${res.message}`);
      return {};
    }
    this._logger.log('titleCfg', `Loaded title.cfg for ${folder}`);
    return {
      title: res.title,
      developer: res.developer,
      genre: res.genre,
      release: res.release,
      ratingText: res.ratingText,
      rating: res.rating,
      description: res.description,
    };
  }
}
