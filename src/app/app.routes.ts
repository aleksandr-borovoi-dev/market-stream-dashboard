import { Routes } from '@angular/router';

export const routes: Routes = [
  { path: '', pathMatch: 'full', redirectTo: 'market' },
  {
    path: 'market',
    loadComponent: () => import('./market/market-page').then(({ MarketPage }) => MarketPage),
  },
  {
    path: 'setup',
    loadComponent: () => import('./setup/setup-page').then(({ SetupPage }) => SetupPage),
  },
];
