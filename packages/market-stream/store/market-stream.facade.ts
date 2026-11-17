import { inject, Injectable } from '@angular/core';
import { Store } from '@ngrx/store';
import { validateProducerSettings, type SettingsValidation } from '../settings';
import { ProducerCommandKind } from '../worker-protocol';
import { MarketStreamActions } from './actions';
import {
  selectMarketError,
  selectMarketPauseCommand,
  selectMarketPendingCommand,
  selectMarketResumeCommand,
  selectMarketSettings,
  selectMarketSnapshots,
  selectMarketStatus,
  selectNextMarketRunIds,
} from './selectors';

@Injectable()
export class MarketStreamFacade {
  private readonly store = inject(Store);

  private readonly nextRunIds = this.store.selectSignal(selectNextMarketRunIds);

  private readonly pauseCommand = this.store.selectSignal(selectMarketPauseCommand);

  private readonly resumeCommand = this.store.selectSignal(selectMarketResumeCommand);

  public readonly settings = this.store.selectSignal(selectMarketSettings);

  public readonly status = this.store.selectSignal(selectMarketStatus);

  public readonly pendingCommand = this.store.selectSignal(selectMarketPendingCommand);

  public readonly snapshots = this.store.selectSignal(selectMarketSnapshots);

  public readonly error = this.store.selectSignal(selectMarketError);

  public applySettings(input: unknown): SettingsValidation {
    const validation = validateProducerSettings(input);
    if (validation.valid) {
      this.store.dispatch(
        MarketStreamActions.startRequested({
          command: {
            kind: ProducerCommandKind.Start,
            ...this.nextRunIds(),
            settings: validation.settings,
            seed: Math.floor(Math.random() * 0x1_0000_0000),
          },
        }),
      );
    }
    return validation;
  }

  public pause(): void {
    const command = this.pauseCommand();
    if (command) {
      this.store.dispatch(MarketStreamActions.modeChangeRequested({ command }));
    }
  }

  public resume(): void {
    const command = this.resumeCommand();
    if (command) {
      this.store.dispatch(MarketStreamActions.modeChangeRequested({ command }));
    }
  }
}
