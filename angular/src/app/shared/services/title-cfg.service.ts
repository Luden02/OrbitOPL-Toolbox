import { Injectable } from '@angular/core';
import { LibraryService } from './library.service';
import { LogsService } from './logs.service';

/** Data parsed from an APPS `title.cfg` file. */
export interface TitleCfgData {
  /** Game display title. */
  title?: string;
  /** Game developer/publisher. */
  developer?: string;
  /** Genre string (e.g. "Action", "RPG"). */
  genre?: string;
  /** Release year string (e.g. "2004"). */
  release?: string;
  /** Human-readable rating label (e.g. "T", "E10+", "12"). */
  ratingText?: string;
  /** Numeric rating value (e.g. "4"). */
  rating?: string;
  /** Game description / synopsis. */
  description?: string;
  /** Human-readable parental rating label (e.g. "T", "12", "A"). */
  parentalText?: string;
  /** Raw `parental` value in `type/text` format (e.g. "esrb/t", "pegi/12"). */
  parental?: string;
  /** Number of players as text (e.g. "1-4", "2"). */
  playersText?: string;
}

@Injectable({
  providedIn: 'root',
})
export class TitleCfgService {
  constructor(
    private readonly _library: LibraryService,
    private readonly _logger: LogsService
  ) { }

  /**
   * Read and parse the `title.cfg` file for the given APPS folder.
   * Returns an empty object on failure.
   */
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
      parentalText: res.parentalText,
      parental: res.parental,
      playersText: res.playersText,
    };
  }
}
