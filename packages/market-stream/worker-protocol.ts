import type { InstrumentSnapshot } from './market-update';
import type { ProducerSettings } from './settings';

export enum ProducerCommandKind {
  Start = 'start',
  Pause = 'pause',
  Resume = 'resume',
}

export enum ProducerEventKind {
  Acknowledged = 'acknowledged',
  Snapshot = 'snapshot',
  Failed = 'failed',
}

export enum ProducerMode {
  Running = 'running',
  Paused = 'paused',
}

export enum ProducerFailureCode {
  InvalidSettings = 'invalid-settings',
  InvalidCommand = 'invalid-command',
  WasmInitialization = 'wasm-initialization',
  Generation = 'generation',
}

interface CommandIdentity {
  /** Positive safe integer, increased for each new run and never reused by its owner. */
  readonly runId: number;
  /** Positive safe integer, increased for every command, including pause and resume. */
  readonly commandId: number;
}

export type ProducerCommand =
  | (CommandIdentity & {
      readonly kind: ProducerCommandKind.Start;
      readonly settings: ProducerSettings;
      /** Unsigned 32-bit seed; random values are generated inside Wasm. */
      readonly seed: number;
    })
  | (CommandIdentity & { readonly kind: ProducerCommandKind.Pause })
  | (CommandIdentity & { readonly kind: ProducerCommandKind.Resume });

export interface ProducerAcknowledgement {
  readonly kind: ProducerEventKind.Acknowledged;
  readonly runId: number;
  readonly commandId: number;
  readonly mode: ProducerMode;
  /** Last published snapshot, or zero before the first batch. */
  readonly sequence: number;
}

export interface ProducerSnapshot {
  readonly kind: ProducerEventKind.Snapshot;
  readonly runId: number;
  /** Starts at one in each run and increases for every published batch. */
  readonly sequence: number;
  /** One entry per configured instrument, ordered by its index. Totals replace earlier totals. */
  readonly instruments: readonly InstrumentSnapshot[];
}

export interface ProducerFailure {
  readonly kind: ProducerEventKind.Failed;
  readonly runId: number;
  /** Present for a failed command; omitted for errors during batch generation. */
  readonly commandId?: number;
  readonly code: ProducerFailureCode;
  readonly message: string;
}

export type ProducerEvent = ProducerAcknowledgement | ProducerSnapshot | ProducerFailure;
