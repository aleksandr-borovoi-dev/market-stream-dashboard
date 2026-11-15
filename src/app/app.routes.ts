import { Routes } from '@angular/router';

export const routes: Routes = [
  { path: '', pathMatch: 'full', redirectTo: 'market' },
  { path: 'market', children: [] },
  { path: 'setup', children: [] },
];
