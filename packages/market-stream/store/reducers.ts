import { createReducer, on } from '@ngrx/store';
import { createInstrumentSnapshots } from '../instrument-snapshots';
import { ProducerCommandKind, ProducerMode } from '../worker-protocol';
import { MarketStreamActions } from './actions';
import {
  marketStreamInitialState,
  MarketStreamStatus,
  type MarketStreamError,
  type MarketStreamState,
} from './interface';

function isActiveRun(state: MarketStreamState, runId: number): boolean {
  return (
    state.runId === runId &&
    state.status !== MarketStreamStatus.Failed &&
    state.status !== MarketStreamStatus.Idle
  );
}

function matchesPendingCommand(state: MarketStreamState, commandId: number): boolean {
  return state.pendingCommand !== null && state.commandId === commandId;
}

function endRun(state: MarketStreamState, { code, message }: MarketStreamError): MarketStreamState {
  return {
    ...state,
    status: MarketStreamStatus.Failed,
    pendingCommand: null,
    error: { code, message },
  };
}

export const marketStreamReducer = createReducer(
  marketStreamInitialState,
  on(MarketStreamActions.startRequested, (_, { command }) => ({
    settings: command.settings,
    status: MarketStreamStatus.Starting,
    pendingCommand: command.kind,
    snapshots: createInstrumentSnapshots(command.settings.instrumentCount),
    error: null,
    runId: command.runId,
    commandId: command.commandId,
    sequence: 0,
  })),
  on(MarketStreamActions.modeChangeRequested, (state, { command }) => ({
    ...state,
    pendingCommand: command.kind,
    commandId: command.commandId,
    error: null,
  })),
  on(MarketStreamActions.commandAcknowledged, (state, { acknowledgement }) => {
    if (
      !isActiveRun(state, acknowledgement.runId) ||
      !matchesPendingCommand(state, acknowledgement.commandId)
    ) {
      return state;
    }

    return {
      ...state,
      status:
        acknowledgement.mode === ProducerMode.Running
          ? MarketStreamStatus.Running
          : MarketStreamStatus.Paused,
      pendingCommand: null,
      error: null,
    };
  }),
  on(MarketStreamActions.snapshotReceived, (state, { snapshot }) => {
    if (
      state.runId !== snapshot.runId ||
      (state.status !== MarketStreamStatus.Starting &&
        state.status !== MarketStreamStatus.Running) ||
      !Number.isSafeInteger(snapshot.sequence) ||
      snapshot.sequence <= state.sequence
    ) {
      return state;
    }

    return { ...state, snapshots: snapshot.instruments, sequence: snapshot.sequence };
  }),
  on(MarketStreamActions.producerFailed, (state, { failure }) => {
    if (!isActiveRun(state, failure.runId)) {
      return state;
    }
    if (failure.commandId === undefined) {
      return endRun(state, failure);
    }
    if (!matchesPendingCommand(state, failure.commandId)) {
      return state;
    }

    return state.pendingCommand === ProducerCommandKind.Start
      ? endRun(state, failure)
      : { ...state, pendingCommand: null, error: { code: failure.code, message: failure.message } };
  }),
  on(MarketStreamActions.transportFailed, (state, { failure }) =>
    isActiveRun(state, failure.runId) ? endRun(state, failure) : state,
  ),
);
