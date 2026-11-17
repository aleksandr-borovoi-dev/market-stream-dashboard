import {
  inject,
  makeEnvironmentProviders,
  provideAppInitializer,
  type EnvironmentProviders,
} from '@angular/core';
import { provideEffects } from '@ngrx/effects';
import { provideState } from '@ngrx/store';
import { createMarketWorker } from '../create-market-worker';
import { DEFAULT_PRODUCER_SETTINGS } from '../settings';
import { MarketStreamEffects } from './effects';
import { MARKET_STREAM_FEATURE_KEY } from './interface';
import { MarketStreamFacade } from './market-stream.facade';
import {
  MARKET_WORKER_FACTORY,
  MarketWorkerTransport,
  type MarketWorkerFactory,
} from './market-worker-transport.service';
import { marketStreamReducer } from './reducers';

export function provideMarketStreamStore(): EnvironmentProviders {
  return makeEnvironmentProviders([
    provideState(MARKET_STREAM_FEATURE_KEY, marketStreamReducer),
    provideEffects(MarketStreamEffects),
    MarketStreamFacade,
    MarketWorkerTransport,
    { provide: MARKET_WORKER_FACTORY, useValue: createMarketWorker satisfies MarketWorkerFactory },
    provideAppInitializer(() => {
      inject(MarketStreamFacade).applySettings(DEFAULT_PRODUCER_SETTINGS);
    }),
  ]);
}
