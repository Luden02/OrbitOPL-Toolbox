import { inject } from '@angular/core';
import { CanActivateFn } from '@angular/router';
import { firstValueFrom } from 'rxjs';
import { LibraryService } from '../services/library.service';

/**
 * Blocks route activation while a long-running action is in progress.
 * Silently cancels navigation (no toast, no redirect) so the user stays
 * on the current page until loading$ becomes false.
 */
export const loadingGuard: CanActivateFn = async () => {
  const library = inject(LibraryService);
  const isLoading = await firstValueFrom(library.loading$);
  return !isLoading;
};
