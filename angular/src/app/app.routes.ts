import { Routes } from '@angular/router';
import { LibraryComponent } from './pages/library/library.component';
import { LogsComponent } from './pages/logs/logs.component';
import { InvalidComponent } from './pages/invalid/invalid.component';
import { ImportComponent } from './pages/import/import.component';
import { loadingGuard } from './shared/guards/loading.guard';

export const routes: Routes = [
  {
    path: '',
    redirectTo: 'library',
    pathMatch: 'full',
  },
  {
    path: 'library',
    component: LibraryComponent,
    canActivate: [loadingGuard],
  },
  {
    path: 'logs',
    component: LogsComponent,
    canActivate: [loadingGuard],
  },
  {
    path: 'invalid-files',
    component: InvalidComponent,
    canActivate: [loadingGuard],
  },
  {
    path: 'import',
    component: ImportComponent,
    canActivate: [loadingGuard],
  },
];
