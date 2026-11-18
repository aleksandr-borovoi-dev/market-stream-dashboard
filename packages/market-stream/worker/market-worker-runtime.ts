import { accumulateMarketBatch, createInstrumentSnapshots } from '../instrument-snapshots';
import type { InstrumentSnapshot } from '../market-update';
import { validateProducerSettings } from '../settings';
import type { ProducerSettings } from '../settings';
import type { WasmProducerExports } from '../wasm-producer';
import {
  ProducerCommandKind,
  ProducerEventKind,
  ProducerFailureCode,
  ProducerMode,
} from '../worker-protocol';
import type { ProducerCommand, ProducerEvent } from '../worker-protocol';
import { readMarketBatch } from './wasm-reader';

const WASM_LOAD_TIMEOUT_MS = 10_000;

export interface MarketWorkerDependencies {
  load(signal: AbortSignal): Promise<WasmProducerExports>;
  publish(event: ProducerEvent): void;
  schedule(callback: () => void, delayMs: number): () => void;
}

type CommandIdentity = Pick<ProducerCommand, 'runId' | 'commandId'>;

interface IncomingCommand extends CommandIdentity {
  readonly kind?: unknown;
  readonly settings?: unknown;
  readonly seed?: unknown;
}

interface ActiveRun {
  readonly runId: number;
  readonly settings: ProducerSettings;
  readonly abort: AbortController;
  instruments: readonly InstrumentSnapshot[];
  sequence: number;
  mode: ProducerMode;
  producer: WasmProducerExports | null;
  cancelNext: (() => void) | null;
}

function hasCommandIdentity(input: unknown): input is IncomingCommand {
  return (
    typeof input === 'object' &&
    input !== null &&
    'runId' in input &&
    typeof input.runId === 'number' &&
    Number.isSafeInteger(input.runId) &&
    input.runId > 0 &&
    'commandId' in input &&
    typeof input.commandId === 'number' &&
    Number.isSafeInteger(input.commandId) &&
    input.commandId > 0
  );
}

function describeError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export class MarketWorkerRuntime {
  private active: ActiveRun | null = null;

  private lastCommandId = 0;

  private lastRunId = 0;

  private disposed = false;

  constructor(private readonly dependencies: MarketWorkerDependencies) {}

  receive(input: unknown): void {
    if (
      this.disposed ||
      !hasCommandIdentity(input) ||
      input.commandId <= this.lastCommandId ||
      input.runId < this.lastRunId
    ) {
      return;
    }
    this.lastCommandId = input.commandId;
    if (input.kind === ProducerCommandKind.Start) {
      this.start(input);
      return;
    }
    if (input.kind !== ProducerCommandKind.Pause && input.kind !== ProducerCommandKind.Resume) {
      this.failCommand(input, ProducerFailureCode.InvalidCommand, 'Unknown producer command.');
      return;
    }
    const run = this.active;
    if (!run || run.runId !== input.runId || !run.producer) {
      this.failCommand(
        input,
        ProducerFailureCode.InvalidCommand,
        'The requested run is not initialized and active.',
      );
      return;
    }
    if (input.kind === ProducerCommandKind.Pause) {
      run.mode = ProducerMode.Paused;
      run.cancelNext?.();
      run.cancelNext = null;
    } else {
      run.mode = ProducerMode.Running;
    }
    this.acknowledge(run, input.commandId);
    this.scheduleNext(run);
  }

  dispose(): void {
    this.disposed = true;
    if (this.active) this.release(this.active);
    this.active = null;
  }

  private start(command: IncomingCommand): void {
    if (command.runId <= this.lastRunId) {
      this.failCommand(command, ProducerFailureCode.InvalidCommand, 'Start needs a new runId.');
      return;
    }
    const validation = validateProducerSettings(command.settings);
    if (!validation.valid) {
      this.failCommand(
        command,
        ProducerFailureCode.InvalidSettings,
        `Invalid producer settings: ${Object.keys(validation.errors).join(', ')}.`,
      );
      return;
    }
    if (
      typeof command.seed !== 'number' ||
      !Number.isInteger(command.seed) ||
      command.seed < 0 ||
      command.seed > 0xffff_ffff
    ) {
      this.failCommand(
        command,
        ProducerFailureCode.InvalidCommand,
        'Seed must be an unsigned 32-bit integer.',
      );
      return;
    }
    if (this.active) this.release(this.active);
    const run: ActiveRun = {
      runId: command.runId,
      settings: validation.settings,
      abort: new AbortController(),
      instruments: createInstrumentSnapshots(validation.settings.instrumentCount),
      sequence: 0,
      mode: ProducerMode.Running,
      producer: null,
      cancelNext: null,
    };
    this.lastRunId = run.runId;
    this.active = run;
    void this.initialize(run, command.commandId, command.seed);
  }

  private async initialize(run: ActiveRun, commandId: number, seed: number): Promise<void> {
    try {
      const { signal } = run.abort;
      const cancelTimeout = this.dependencies.schedule(() => {
        if (this.active !== run || run.producer) return;
        this.failRun(
          run,
          ProducerFailureCode.WasmInitialization,
          `Loading timed out after ${WASM_LOAD_TIMEOUT_MS / 1000} seconds. Open Settings and select Apply to retry.`,
          commandId,
        );
      }, WASM_LOAD_TIMEOUT_MS);
      signal.addEventListener('abort', cancelTimeout, { once: true });
      const producer = await this.dependencies.load(signal);
      if (this.active !== run) return;
      signal.removeEventListener('abort', cancelTimeout);
      cancelTimeout();
      producer.reset(run.settings.instrumentCount, seed);
      run.producer = producer;
      this.acknowledge(run, commandId);
      this.scheduleNext(run);
    } catch (error) {
      if (this.active === run) {
        this.failRun(run, ProducerFailureCode.WasmInitialization, error, commandId);
      }
    }
  }

  private acknowledge(run: ActiveRun, commandId: number): void {
    this.dependencies.publish({
      kind: ProducerEventKind.Acknowledged,
      runId: run.runId,
      commandId,
      mode: run.mode,
      sequence: run.sequence,
    });
  }

  private scheduleNext(run: ActiveRun): void {
    if (this.active === run && run.mode === ProducerMode.Running && !run.cancelNext) {
      const cancel = this.dependencies.schedule(() => {
        if (run.cancelNext !== cancel) return;
        run.cancelNext = null;
        this.generate(run);
      }, run.settings.intervalMs);
      run.cancelNext = cancel;
    }
  }

  private generate(run: ActiveRun): void {
    if (this.active !== run || run.mode !== ProducerMode.Running || !run.producer) {
      return;
    }
    try {
      const updates = readMarketBatch(
        run.producer,
        run.settings.updatesPerBatch,
        run.settings.instrumentCount,
      );
      run.instruments = accumulateMarketBatch(run.instruments, updates);
      run.sequence += 1;
      this.dependencies.publish({
        kind: ProducerEventKind.Snapshot,
        runId: run.runId,
        sequence: run.sequence,
        instruments: run.instruments,
      });
    } catch (error) {
      this.failRun(run, ProducerFailureCode.Generation, error);
      return;
    }
    this.scheduleNext(run);
  }

  private failCommand(command: CommandIdentity, code: ProducerFailureCode, message: string): void {
    this.dependencies.publish({
      kind: ProducerEventKind.Failed,
      runId: command.runId,
      commandId: command.commandId,
      code,
      message,
    });
  }

  private failRun(
    run: ActiveRun,
    code: ProducerFailureCode,
    error: unknown,
    commandId?: number,
  ): void {
    this.release(run);
    this.active = null;
    const phase =
      code === ProducerFailureCode.WasmInitialization ? 'Wasm initialization' : 'Market generation';
    this.dependencies.publish({
      kind: ProducerEventKind.Failed,
      runId: run.runId,
      ...(commandId === undefined ? {} : { commandId }),
      code,
      message: `${phase} failed: ${describeError(error)}`,
    });
  }

  private release(run: ActiveRun): void {
    run.cancelNext?.();
    run.cancelNext = null;
    run.abort.abort();
    run.producer = null;
  }
}
