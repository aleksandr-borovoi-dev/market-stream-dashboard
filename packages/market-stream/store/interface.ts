import { createInstrumentSnapshots } from '../instrument-snapshots';
import type { InstrumentSnapshot } from '../market-update';
import { DEFAULT_PRODUCER_SETTINGS, type ProducerSettings } from '../settings';
import type { ProducerCommand, ProducerCommandKind, ProducerFailureCode } from '../worker-protocol';

export const MARKET_STREAM_FEATURE_KEY = 'marketStream';

export enum MarketStreamStatus {
  Idle,
  Starting,
  Running,
  Paused,
  Failed,
}

export type StartProducerCommand = Extract<ProducerCommand, { kind: ProducerCommandKind.Start }>;

export type ChangeProducerModeCommand = Exclude<ProducerCommand, StartProducerCommand>;

export enum MarketWorkerTransportFailureCode {
  Creation,
  Send,
  WorkerError,
  MessageError,
}

export interface MarketStreamError {
  readonly code: ProducerFailureCode | MarketWorkerTransportFailureCode;
  readonly message: string;
}

export interface MarketWorkerTransportFailure extends MarketStreamError {
  readonly kind: 'transport-failed';
  readonly runId: number;
  readonly code: MarketWorkerTransportFailureCode;
}

export interface MarketStreamState {
  readonly settings: ProducerSettings;
  readonly status: MarketStreamStatus;
  readonly pendingCommand: ProducerCommandKind | null;
  readonly snapshots: readonly InstrumentSnapshot[];
  readonly error: MarketStreamError | null;
  readonly runId: number;
  readonly commandId: number;
  readonly sequence: number;
}

export const marketStreamInitialState: MarketStreamState = {
  settings: DEFAULT_PRODUCER_SETTINGS,
  status: MarketStreamStatus.Idle,
  pendingCommand: null,
  snapshots: createInstrumentSnapshots(DEFAULT_PRODUCER_SETTINGS.instrumentCount),
  error: null,
  runId: 0,
  commandId: 0,
  sequence: 0,
};
