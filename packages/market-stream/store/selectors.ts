import { createFeatureSelector, createSelector } from '@ngrx/store';
import { ProducerCommandKind } from '../worker-protocol';
import {
  MARKET_STREAM_FEATURE_KEY,
  MarketStreamStatus,
  type ChangeProducerModeCommand,
  type MarketStreamState,
} from './interface';

const selectMarketStream = createFeatureSelector<MarketStreamState>(MARKET_STREAM_FEATURE_KEY);

export const selectMarketSettings = createSelector(selectMarketStream, ({ settings }) => settings);

export const selectMarketStatus = createSelector(selectMarketStream, ({ status }) => status);

export const selectMarketPendingCommand = createSelector(
  selectMarketStream,
  ({ pendingCommand }) => pendingCommand,
);

export const selectMarketSnapshots = createSelector(
  selectMarketStream,
  ({ snapshots }) => snapshots,
);

export const selectMarketError = createSelector(selectMarketStream, ({ error }) => error);

export const selectNextMarketRunIds = createSelector(
  selectMarketStream,
  ({ runId, commandId }) => ({
    runId: runId + 1,
    commandId: commandId + 1,
  }),
);

export const selectMarketPauseCommand = createSelector(
  selectMarketStream,
  ({ status, pendingCommand, runId, commandId }): ChangeProducerModeCommand | null =>
    status === MarketStreamStatus.Running && pendingCommand === null
      ? { kind: ProducerCommandKind.Pause, runId, commandId: commandId + 1 }
      : null,
);

export const selectMarketResumeCommand = createSelector(
  selectMarketStream,
  ({ status, pendingCommand, runId, commandId }): ChangeProducerModeCommand | null =>
    status === MarketStreamStatus.Paused && pendingCommand === null
      ? { kind: ProducerCommandKind.Resume, runId, commandId: commandId + 1 }
      : null,
);
