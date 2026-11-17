import {
  Component,
  DOCUMENT,
  inject,
  type EnvironmentProviders,
  type Provider,
} from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { RouterTestingHarness } from '@angular/router/testing';
import { provideStore } from '@ngrx/store';
import { describe, expect, it, vi } from 'vitest';
import { createInstrumentSnapshots } from '../instrument-snapshots';
import { DEFAULT_PRODUCER_SETTINGS, SettingIssue } from '../settings';
import {
  ProducerCommandKind,
  ProducerEventKind,
  ProducerFailureCode,
  ProducerMode,
  type ProducerCommand,
  type ProducerEvent,
  type ProducerSnapshot,
} from '../worker-protocol';
import {
  MARKET_WORKER_FACTORY,
  MarketStreamFacade,
  MarketStreamStatus,
  MarketWorkerTransportFailureCode,
  provideMarketStreamStore,
  type MarketWorker,
  type MarketWorkerEventMap,
  type MarketWorkerFactory,
} from './index';

type WorkerListeners = {
  [Kind in keyof MarketWorkerEventMap]: Set<(event: MarketWorkerEventMap[Kind]) => void>;
};

class ControlledWorker implements MarketWorker {
  private readonly listeners: WorkerListeners = {
    message: new Set(),
    error: new Set(),
    messageerror: new Set(),
  };

  public readonly commands: ProducerCommand[] = [];

  public readonly terminate = vi.fn<() => void>();

  public sendError: Error | null = null;

  public get listenerCount(): number {
    return Object.values(this.listeners).reduce((count, listeners) => count + listeners.size, 0);
  }

  public get messageListeners(): readonly ((event: MessageEvent<ProducerEvent>) => void)[] {
    return [...this.listeners.message];
  }

  public addEventListener<Kind extends keyof MarketWorkerEventMap>(
    kind: Kind,
    listener: (event: MarketWorkerEventMap[Kind]) => void,
  ): void {
    this.listeners[kind].add(listener);
  }

  public removeEventListener<Kind extends keyof MarketWorkerEventMap>(
    kind: Kind,
    listener: (event: MarketWorkerEventMap[Kind]) => void,
  ): void {
    this.listeners[kind].delete(listener);
  }

  public postMessage(command: ProducerCommand): void {
    if (this.sendError) {
      throw this.sendError;
    }
    this.commands.push(command);
  }

  public emit<Kind extends keyof MarketWorkerEventMap>(
    kind: Kind,
    event: MarketWorkerEventMap[Kind],
  ): void {
    for (const listener of this.listeners[kind]) {
      listener(event);
    }
  }

  public receive(event: ProducerEvent): void {
    this.emit('message', new MessageEvent('message', { data: event }));
  }
}

@Component({ template: '' })
class MarketRouteComponent {
  public readonly facade = inject(MarketStreamFacade);
}

function configureStore(
  factory: MarketWorkerFactory,
  providers: readonly (EnvironmentProviders | Provider)[] = [],
): MarketStreamFacade {
  TestBed.configureTestingModule({
    providers: [
      provideStore(),
      provideMarketStreamStore(),
      { provide: MARKET_WORKER_FACTORY, useValue: factory },
      ...providers,
    ],
  });
  return TestBed.inject(MarketStreamFacade);
}

function acknowledge(
  worker: ControlledWorker,
  command: ProducerCommand,
  mode: ProducerMode,
  sequence = 0,
): void {
  worker.receive({
    kind: ProducerEventKind.Acknowledged,
    runId: command.runId,
    commandId: command.commandId,
    mode,
    sequence,
  });
}

function snapshot(
  runId: number,
  sequence: number,
  volume: bigint,
  instrumentCount = DEFAULT_PRODUCER_SETTINGS.instrumentCount,
): ProducerSnapshot {
  return {
    kind: ProducerEventKind.Snapshot,
    runId,
    sequence,
    instruments: [
      {
        instrumentIndex: 0,
        latest: {
          instrumentIndex: 0,
          priceCents: 10_200,
          tradeQuantity: 30,
          bidCents: 10_196,
          askCents: 10_200,
          bidQuantity: 600,
          askQuantity: 400,
        },
        volume,
        tradedValueCents: 10_200n * volume,
      },
      ...createInstrumentSnapshots(instrumentCount).slice(1),
    ],
  };
}

describe('Market Stream store', () => {
  it('starts defaults at bootstrap and shares the paused run across route navigation', async () => {
    const worker = new ControlledWorker();
    const factory = vi.fn<MarketWorkerFactory>(() => worker);
    const facade = configureStore(factory, [
      provideRouter([
        { path: 'dashboard', component: MarketRouteComponent },
        { path: 'settings', component: MarketRouteComponent },
      ]),
    ]);

    expect(factory).toHaveBeenCalledTimes(1);
    expect(worker.commands).toHaveLength(1);
    const [start] = worker.commands;
    expect(start).toMatchObject({
      kind: ProducerCommandKind.Start,
      settings: DEFAULT_PRODUCER_SETTINGS,
      runId: 1,
      commandId: 1,
    });
    if (start.kind === ProducerCommandKind.Start) {
      expect(Number.isInteger(start.seed)).toBe(true);
      expect(start.seed).toBeGreaterThanOrEqual(0);
      expect(start.seed).toBeLessThanOrEqual(0xffff_ffff);
    }
    expect(facade.settings()).toEqual(DEFAULT_PRODUCER_SETTINGS);
    expect(facade.status()).toBe(MarketStreamStatus.Starting);
    expect(facade.pendingCommand()).toBe(ProducerCommandKind.Start);
    expect(facade.snapshots()).toEqual(
      createInstrumentSnapshots(DEFAULT_PRODUCER_SETTINGS.instrumentCount),
    );

    const harness = await RouterTestingHarness.create();
    const dashboard = await harness.navigateByUrl('/dashboard', MarketRouteComponent);
    expect(dashboard.facade).toBe(facade);
    acknowledge(worker, start, ProducerMode.Running);
    dashboard.facade.pause();
    acknowledge(worker, worker.commands[1], ProducerMode.Paused);

    const settings = await harness.navigateByUrl('/settings', MarketRouteComponent);
    expect(settings.facade).toBe(facade);
    const reopened = await harness.navigateByUrl('/dashboard', MarketRouteComponent);
    expect(reopened.facade.status()).toBe(MarketStreamStatus.Paused);
    expect(worker.commands).toHaveLength(2);
    expect(factory).toHaveBeenCalledTimes(1);

    TestBed.resetTestingModule();
    expect(worker.terminate).toHaveBeenCalledTimes(1);
    expect(worker.listenerCount).toBe(0);
  });

  it('resolves the Wasm asset relative to the document base', () => {
    const scopedDocument = document.implementation.createHTMLDocument();
    const base = scopedDocument.createElement('base');
    base.href = 'https://example.test/market/dashboard/';
    scopedDocument.head.append(base);
    const factory = vi.fn<MarketWorkerFactory>(() => new ControlledWorker());

    configureStore(factory, [{ provide: DOCUMENT, useValue: scopedDocument }]);

    expect(factory).toHaveBeenCalledExactlyOnceWith(
      new URL('https://example.test/market/dashboard/market-stream.wasm'),
    );
  });

  it('keeps invalid settings local and starts a clean run with a valid Apply while paused', () => {
    const worker = new ControlledWorker();
    const facade = configureStore(() => worker);
    const [start] = worker.commands;
    acknowledge(worker, start, ProducerMode.Running);
    const accumulated = snapshot(start.runId, 1, 40n);
    worker.receive(accumulated);
    facade.pause();
    const pause = worker.commands[1];
    acknowledge(worker, pause, ProducerMode.Paused, 1);

    const draft = { instrumentCount: 2, updatesPerBatch: 0, intervalMs: 50 };
    expect(facade.applySettings(draft)).toEqual({
      valid: false,
      errors: { updatesPerBatch: SettingIssue.Range },
    });
    expect(facade.settings()).toEqual(DEFAULT_PRODUCER_SETTINGS);
    expect(facade.snapshots()).toBe(accumulated.instruments);
    expect(facade.status()).toBe(MarketStreamStatus.Paused);
    expect(worker.commands).toHaveLength(2);

    draft.updatesPerBatch = 1_000;
    expect(facade.applySettings(draft).valid).toBe(true);
    const nextStart = worker.commands[2];
    expect(nextStart).toMatchObject({
      kind: ProducerCommandKind.Start,
      runId: start.runId + 1,
      commandId: pause.commandId + 1,
      settings: draft,
    });
    expect(facade.settings()).toEqual(draft);
    draft.updatesPerBatch = 42;
    expect(facade.settings().updatesPerBatch).toBe(1_000);
    expect(facade.status()).toBe(MarketStreamStatus.Starting);
    expect(facade.snapshots()).toEqual(createInstrumentSnapshots(2));
    acknowledge(worker, nextStart, ProducerMode.Running);
    expect(facade.status()).toBe(MarketStreamStatus.Running);
  });

  it('keeps confirmed modes while controls are pending and accepts the final snapshot before pause', () => {
    const worker = new ControlledWorker();
    const facade = configureStore(() => worker);
    const [start] = worker.commands;
    facade.pause();
    facade.resume();
    expect(worker.commands).toHaveLength(1);
    acknowledge(worker, start, ProducerMode.Running);

    facade.pause();
    const pause = worker.commands[1];
    expect(pause).toEqual({
      kind: ProducerCommandKind.Pause,
      runId: start.runId,
      commandId: start.commandId + 1,
    });
    facade.pause();
    facade.resume();
    expect(worker.commands).toHaveLength(2);
    expect(facade.status()).toBe(MarketStreamStatus.Running);
    expect(facade.pendingCommand()).toBe(ProducerCommandKind.Pause);

    const finalBatch = snapshot(start.runId, 1, 40n);
    worker.receive(finalBatch);
    acknowledge(worker, pause, ProducerMode.Paused, finalBatch.sequence);
    expect(facade.status()).toBe(MarketStreamStatus.Paused);
    expect(facade.pendingCommand()).toBeNull();
    worker.receive(snapshot(start.runId, 2, 99n));
    expect(facade.snapshots()).toBe(finalBatch.instruments);

    facade.resume();
    const resume = worker.commands[2];
    expect(resume).toEqual({
      kind: ProducerCommandKind.Resume,
      runId: start.runId,
      commandId: pause.commandId + 1,
    });
    facade.resume();
    facade.pause();
    expect(worker.commands).toHaveLength(3);
    expect(facade.status()).toBe(MarketStreamStatus.Paused);
    expect(facade.pendingCommand()).toBe(ProducerCommandKind.Resume);

    acknowledge(worker, resume, ProducerMode.Running, finalBatch.sequence);
    expect(facade.status()).toBe(MarketStreamStatus.Running);
    expect(facade.pendingCommand()).toBeNull();
    expect(facade.snapshots()).toBe(finalBatch.instruments);
    const resumedBatch = snapshot(start.runId, 2, 45n);
    worker.receive(resumedBatch);
    expect(facade.snapshots()).toBe(resumedBatch.instruments);
  });

  it('supersedes a pending command and ignores stale outcomes and invalid snapshot sequences', () => {
    const worker = new ControlledWorker();
    const facade = configureStore(() => worker);
    const [initialStart] = worker.commands;
    acknowledge(worker, initialStart, ProducerMode.Running);
    facade.pause();
    const previousPause = worker.commands[1];

    facade.applySettings(DEFAULT_PRODUCER_SETTINGS);
    const start = worker.commands[2];
    acknowledge(worker, previousPause, ProducerMode.Paused);
    acknowledge(worker, { ...start, commandId: previousPause.commandId }, ProducerMode.Paused);
    worker.receive(snapshot(previousPause.runId, 10, 100n));
    worker.receive({
      kind: ProducerEventKind.Failed,
      runId: previousPause.runId,
      code: ProducerFailureCode.Generation,
      message: 'Previous run',
    });
    worker.receive({
      kind: ProducerEventKind.Failed,
      runId: start.runId,
      commandId: previousPause.commandId,
      code: ProducerFailureCode.InvalidCommand,
      message: 'Different command',
    });
    expect(facade.status()).toBe(MarketStreamStatus.Starting);
    expect(facade.pendingCommand()).toBe(ProducerCommandKind.Start);
    expect(facade.error()).toBeNull();
    expect(facade.snapshots()[0].volume).toBe(0n);

    acknowledge(worker, start, ProducerMode.Running);
    acknowledge(worker, start, ProducerMode.Paused);
    expect(facade.status()).toBe(MarketStreamStatus.Running);

    worker.receive(snapshot(start.runId, 1, 80n));
    worker.receive(snapshot(start.runId, Number.NaN, 300n));
    worker.receive(snapshot(start.runId, Infinity, 300n));
    const latest = snapshot(start.runId, 2, 9_007_199_254_740_993n);
    worker.receive(latest);
    worker.receive(snapshot(start.runId, 1, 99n));
    worker.receive(snapshot(start.runId, 2, 99n));
    expect(facade.snapshots()).toBe(latest.instruments);
    expect(facade.snapshots()[0].volume).toBe(9_007_199_254_740_993n);
    expect(facade.snapshots()[0].tradedValueCents).toBe(91_873_432_398_358_128_600n);
  });

  it('clears rejected pause and resume commands and retains acknowledged mode and totals', () => {
    const worker = new ControlledWorker();
    const facade = configureStore(() => worker);
    const [start] = worker.commands;
    acknowledge(worker, start, ProducerMode.Running);
    const cumulative = snapshot(start.runId, 1, 15n);
    worker.receive(cumulative);

    facade.pause();
    const pause = worker.commands[1];
    const rejection = {
      kind: ProducerEventKind.Failed,
      runId: start.runId,
      commandId: pause.commandId,
      code: ProducerFailureCode.InvalidCommand,
      message: 'Pause rejected',
    } satisfies ProducerEvent;
    worker.receive(rejection);
    expect(facade.pendingCommand()).toBeNull();
    expect(facade.error()).toEqual({ code: rejection.code, message: rejection.message });
    expect(facade.status()).toBe(MarketStreamStatus.Running);
    expect(facade.snapshots()).toBe(cumulative.instruments);

    facade.pause();
    expect(facade.error()).toBeNull();
    acknowledge(worker, worker.commands[2], ProducerMode.Paused, cumulative.sequence);
    facade.resume();
    worker.receive({
      ...rejection,
      commandId: worker.commands[3].commandId,
      message: 'Resume rejected',
    });
    expect(facade.pendingCommand()).toBeNull();
    expect(facade.status()).toBe(MarketStreamStatus.Paused);
    expect(facade.error()?.message).toBe('Resume rejected');
    expect(facade.snapshots()).toBe(cumulative.instruments);
    expect(worker.terminate).not.toHaveBeenCalled();
  });

  it('ends failed producer runs and reuses the channel when Apply explicitly restarts generation', () => {
    const worker = new ControlledWorker();
    const factory = vi.fn<MarketWorkerFactory>(() => worker);
    const facade = configureStore(factory);
    const [start] = worker.commands;

    worker.receive({
      kind: ProducerEventKind.Failed,
      runId: start.runId,
      commandId: start.commandId,
      code: ProducerFailureCode.WasmInitialization,
      message: 'Unable to load Wasm',
    });
    expect(facade.status()).toBe(MarketStreamStatus.Failed);
    expect(facade.error()).toEqual({
      code: ProducerFailureCode.WasmInitialization,
      message: 'Unable to load Wasm',
    });
    expect(facade.pendingCommand()).toBeNull();
    expect(worker.commands).toHaveLength(1);

    facade.applySettings(DEFAULT_PRODUCER_SETTINGS);
    const restart = worker.commands[1];
    acknowledge(worker, restart, ProducerMode.Running);
    const cumulative = snapshot(restart.runId, 1, 25n);
    worker.receive(cumulative);
    worker.receive({
      kind: ProducerEventKind.Failed,
      runId: restart.runId,
      code: ProducerFailureCode.Generation,
      message: 'Wasm generation failed',
    });
    worker.receive(snapshot(restart.runId, 2, 50n));
    expect(facade.status()).toBe(MarketStreamStatus.Failed);
    expect(facade.error()?.code).toBe(ProducerFailureCode.Generation);
    expect(facade.snapshots()).toBe(cumulative.instruments);
    expect(worker.commands).toHaveLength(2);
    expect(factory).toHaveBeenCalledTimes(1);
    expect(worker.terminate).not.toHaveBeenCalled();
  });

  it('reports creation failure at bootstrap and opens a Worker on valid Apply', () => {
    const worker = new ControlledWorker();
    const factory = vi
      .fn<MarketWorkerFactory>(() => worker)
      .mockImplementationOnce(() => {
        throw new Error('Creation blocked');
      });
    const facade = configureStore(factory);
    expect(facade.status()).toBe(MarketStreamStatus.Failed);
    expect(facade.pendingCommand()).toBeNull();
    expect(facade.error()).toEqual({
      code: MarketWorkerTransportFailureCode.Creation,
      message: 'Unable to create the market worker: Creation blocked',
    });
    expect(factory).toHaveBeenCalledTimes(1);

    facade.applySettings(DEFAULT_PRODUCER_SETTINGS);
    expect(worker.commands[0]).toMatchObject({ runId: 2, commandId: 2 });
    expect(facade.error()).toBeNull();
    expect(facade.status()).toBe(MarketStreamStatus.Starting);
    expect(factory).toHaveBeenCalledTimes(2);
  });

  it('retires a Worker after a postMessage failure and discards callbacks from that Worker', () => {
    const first = new ControlledWorker();
    const second = new ControlledWorker();
    const factory = vi.fn<MarketWorkerFactory>(() => second).mockReturnValueOnce(first);
    const facade = configureStore(factory);
    acknowledge(first, first.commands[0], ProducerMode.Running);
    const [callbackFromFirst] = first.messageListeners;

    first.sendError = new Error('Channel closed');
    facade.pause();
    expect(facade.status()).toBe(MarketStreamStatus.Failed);
    expect(facade.pendingCommand()).toBeNull();
    expect(facade.error()).toEqual({
      code: MarketWorkerTransportFailureCode.Send,
      message: 'Unable to send a command to the market worker: Channel closed',
    });
    expect(first.terminate).toHaveBeenCalledTimes(1);
    expect(first.listenerCount).toBe(0);
    expect(factory).toHaveBeenCalledTimes(1);

    facade.applySettings(DEFAULT_PRODUCER_SETTINGS);
    const [restart] = second.commands;
    acknowledge(second, restart, ProducerMode.Running);
    callbackFromFirst(new MessageEvent('message', { data: snapshot(restart.runId, 1, 300n) }));
    expect(facade.snapshots()[0].volume).toBe(0n);
    const cumulative = snapshot(restart.runId, 1, 40n);
    second.receive(cumulative);
    expect(facade.snapshots()).toBe(cumulative.instruments);
    expect(factory).toHaveBeenCalledTimes(2);
  });

  it('reports native error and messageerror events and detaches their Workers', () => {
    const first = new ControlledWorker();
    const second = new ControlledWorker();
    const factory = vi.fn<MarketWorkerFactory>(() => second).mockReturnValueOnce(first);
    const facade = configureStore(factory);
    acknowledge(first, first.commands[0], ProducerMode.Running);

    first.emit('error', new ErrorEvent('error', { message: 'Worker script failed' }));
    expect(facade.status()).toBe(MarketStreamStatus.Failed);
    expect(facade.error()).toEqual({
      code: MarketWorkerTransportFailureCode.WorkerError,
      message: 'The market worker stopped unexpectedly: Worker script failed',
    });
    expect(first.terminate).toHaveBeenCalledTimes(1);
    expect(first.listenerCount).toBe(0);

    facade.applySettings(DEFAULT_PRODUCER_SETTINGS);
    second.emit('messageerror', new MessageEvent('messageerror'));
    expect(facade.status()).toBe(MarketStreamStatus.Failed);
    expect(facade.error()?.code).toBe(MarketWorkerTransportFailureCode.MessageError);
    expect(second.terminate).toHaveBeenCalledTimes(1);
    expect(second.listenerCount).toBe(0);
    expect(factory).toHaveBeenCalledTimes(2);
  });
});
