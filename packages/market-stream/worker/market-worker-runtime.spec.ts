import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ProducerSettings } from '../settings';
import type { WasmProducerExports } from '../wasm-producer';
import {
  ProducerCommandKind,
  ProducerEventKind,
  ProducerFailureCode,
  ProducerMode,
} from '../worker-protocol';
import type { ProducerEvent, ProducerSnapshot } from '../worker-protocol';
import { MarketWorkerRuntime } from './market-worker-runtime';
import type { MarketWorkerDependencies } from './market-worker-runtime';

const settings: ProducerSettings = {
  instrumentCount: 2,
  updatesPerBatch: 2,
  intervalMs: 50,
};

function fixtureProducer(): WasmProducerExports {
  const memory = new WebAssembly.Memory({ initial: 1 });
  const view = new DataView(memory.buffer);
  // The assignment's two trades, with valid latest bid/ask snapshots. No generator is implemented here.
  [
    [0, 10000, 10, 9996, 10000, 300, 100],
    [0, 10200, 30, 10196, 10200, 600, 400],
  ].forEach((row, record) => {
    row.forEach((word, index) => view.setUint32(64 + record * 28 + index * 4, word, true));
  });
  return { memory, reset: vi.fn(), writeBatch: vi.fn(() => 64) };
}

interface Deferred<T> {
  readonly promise: Promise<T>;
  resolve(value: T): void;
  reject(reason: Error): void;
}

function deferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void;
  let reject!: (reason: Error) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

interface Harness {
  readonly runtime: MarketWorkerRuntime;
  readonly events: ProducerEvent[];
  readonly signals: AbortSignal[];
  readonly scheduled: (() => void)[];
}

function harness(load: MarketWorkerDependencies['load']): Harness {
  const events: ProducerEvent[] = [];
  const signals: AbortSignal[] = [];
  const scheduled: (() => void)[] = [];
  const runtime = new MarketWorkerRuntime({
    load: (signal) => {
      signals.push(signal);
      return load(signal);
    },
    publish: (event) => events.push(event),
    schedule: (callback, delayMs) => {
      scheduled.push(callback);
      const timer = setTimeout(callback, delayMs);
      return () => clearTimeout(timer);
    },
  });
  return { runtime, events, signals, scheduled };
}

function start(runtime: MarketWorkerRuntime, runId = 1, commandId = 1): void {
  runtime.receive({
    kind: ProducerCommandKind.Start,
    runId,
    commandId,
    settings,
    seed: 42,
  });
}

function snapshots(events: readonly ProducerEvent[]): readonly ProducerSnapshot[] {
  return events.filter((event) => event.kind === ProducerEventKind.Snapshot);
}

beforeEach(() => vi.useFakeTimers());

afterEach(() => vi.useRealTimers());

describe('MarketWorkerRuntime', () => {
  it('waits for initialization, resets the supplied Wasm and starts one interval after acknowledgement', async () => {
    const load = deferred<WasmProducerExports>();
    const producer = fixtureProducer();
    const { runtime, events } = harness(() => load.promise);
    start(runtime);
    vi.advanceTimersByTime(5000);
    expect(events).toEqual([]);
    expect(producer.reset).not.toHaveBeenCalled();
    load.resolve(producer);
    await Promise.resolve();
    expect(producer.reset).toHaveBeenCalledExactlyOnceWith(2, 42);
    expect(events).toEqual([
      {
        kind: ProducerEventKind.Acknowledged,
        runId: 1,
        commandId: 1,
        mode: ProducerMode.Running,
        sequence: 0,
      },
    ]);
    vi.advanceTimersByTime(49);
    expect(producer.writeBatch).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(producer.writeBatch).toHaveBeenCalledExactlyOnceWith(2);
  });

  it('aborts a stalled Wasm load at 10 seconds and keeps its late completion out of the next run', async () => {
    const stalled = deferred<WasmProducerExports>();
    const producer = fixtureProducer();
    const load = vi
      .fn<MarketWorkerDependencies['load']>()
      .mockReturnValueOnce(stalled.promise)
      .mockResolvedValueOnce(producer);
    const { runtime, events, signals } = harness(load);
    start(runtime);
    vi.advanceTimersByTime(9_999);
    expect(events).toEqual([]);
    expect(signals[0].aborted).toBe(false);

    vi.advanceTimersByTime(1);
    expect(signals[0].aborted).toBe(true);
    expect(events).toEqual([
      {
        kind: ProducerEventKind.Failed,
        code: ProducerFailureCode.WasmInitialization,
        runId: 1,
        commandId: 1,
        message: expect.stringMatching(/timed out after 10 seconds.*Settings.*Apply/i),
      },
    ]);

    start(runtime, 2, 2);
    stalled.resolve(producer);
    await vi.advanceTimersByTimeAsync(settings.intervalMs);
    expect(producer.reset).toHaveBeenCalledOnce();
    expect(events.slice(1)).toEqual([
      expect.objectContaining({
        kind: ProducerEventKind.Acknowledged,
        runId: 2,
        mode: ProducerMode.Running,
      }),
      expect.objectContaining({ kind: ProducerEventKind.Snapshot, runId: 2, sequence: 1 }),
    ]);
  });

  it('publishes exact cumulative totals for every trade and leaves untouched instruments empty', async () => {
    const producer = fixtureProducer();
    const { runtime, events } = harness(async () => producer);
    start(runtime);
    await Promise.resolve();
    vi.advanceTimersByTime(50);
    expect(snapshots(events)).toEqual([
      {
        kind: ProducerEventKind.Snapshot,
        runId: 1,
        sequence: 1,
        instruments: [
          {
            instrumentIndex: 0,
            latest: {
              instrumentIndex: 0,
              priceCents: 10200,
              tradeQuantity: 30,
              bidCents: 10196,
              askCents: 10200,
              bidQuantity: 600,
              askQuantity: 400,
            },
            volume: 40n,
            tradedValueCents: 406000n,
          },
          {
            instrumentIndex: 1,
            latest: null,
            volume: 0n,
            tradedValueCents: 0n,
          },
        ],
      },
    ]);
    vi.advanceTimersByTime(50);
    expect(snapshots(events)[1]).toMatchObject({
      sequence: 2,
      instruments: [{ volume: 80n, tradedValueCents: 812000n }, { volume: 0n }],
    });
    expect(snapshots(events)[0].instruments[0].volume).toBe(40n);
  });

  it('publishes completed work before pausing, then resumes after one full interval without catch-up', async () => {
    const producer = fixtureProducer();
    const { runtime, events, scheduled } = harness(async () => producer);
    start(runtime);
    await Promise.resolve();
    vi.advanceTimersByTime(50);
    const prePauseTick = scheduled[scheduled.length - 1];
    runtime.receive({
      kind: ProducerCommandKind.Pause,
      runId: 1,
      commandId: 2,
    });
    expect(events.slice(-2)).toEqual([
      expect.objectContaining({
        kind: ProducerEventKind.Snapshot,
        sequence: 1,
      }),
      {
        kind: ProducerEventKind.Acknowledged,
        runId: 1,
        commandId: 2,
        mode: ProducerMode.Paused,
        sequence: 1,
      },
    ]);
    vi.advanceTimersByTime(60000);
    expect(producer.writeBatch).toHaveBeenCalledTimes(1);
    runtime.receive({
      kind: ProducerCommandKind.Resume,
      runId: 1,
      commandId: 3,
    });
    expect(events.at(-1)).toEqual({
      kind: ProducerEventKind.Acknowledged,
      runId: 1,
      commandId: 3,
      mode: ProducerMode.Running,
      sequence: 1,
    });
    // A callback from the cancelled pre-pause timeout must also remain harmless after Resume.
    prePauseTick();
    vi.advanceTimersByTime(49);
    expect(producer.writeBatch).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(1);
    expect(producer.writeBatch).toHaveBeenCalledTimes(2);
    expect(producer.reset).toHaveBeenCalledTimes(1);
    expect(snapshots(events).at(-1)).toMatchObject({
      sequence: 2,
      instruments: [{ volume: 80n }, { volume: 0n }],
    });
  });

  it('repeated Resume does not schedule a second producer', async () => {
    const producer = fixtureProducer();
    const { runtime } = harness(async () => producer);
    start(runtime);
    await Promise.resolve();
    runtime.receive({
      kind: ProducerCommandKind.Resume,
      runId: 1,
      commandId: 2,
    });
    runtime.receive({
      kind: ProducerCommandKind.Resume,
      runId: 1,
      commandId: 3,
    });
    vi.advanceTimersByTime(50);
    expect(producer.writeBatch).toHaveBeenCalledTimes(1);
  });

  it.each([false, true])(
    'Start replaces a %s paused run with empty totals and sequence one',
    async (paused) => {
      const first = fixtureProducer();
      const second = fixtureProducer();
      const load = vi
        .fn<MarketWorkerDependencies['load']>()
        .mockResolvedValueOnce(first)
        .mockResolvedValueOnce(second);
      const { runtime, events, signals, scheduled } = harness(load);
      start(runtime);
      await Promise.resolve();
      vi.advanceTimersByTime(100);
      const oldTick = scheduled[scheduled.length - 1];
      if (paused)
        runtime.receive({
          kind: ProducerCommandKind.Pause,
          runId: 1,
          commandId: 2,
        });
      runtime.receive({
        kind: ProducerCommandKind.Start,
        runId: 2,
        commandId: 3,
        settings: { ...settings, instrumentCount: 1 },
        seed: 0xffff_ffff,
      });
      expect(signals[0].aborted).toBe(true);
      await Promise.resolve();
      expect(events.at(-1)).toEqual({
        kind: ProducerEventKind.Acknowledged,
        runId: 2,
        commandId: 3,
        mode: ProducerMode.Running,
        sequence: 0,
      });
      oldTick();
      vi.advanceTimersByTime(50);
      expect(first.writeBatch).toHaveBeenCalledTimes(2);
      expect(second.reset).toHaveBeenCalledExactlyOnceWith(1, 0xffff_ffff);
      expect(snapshots(events).at(-1)).toMatchObject({
        runId: 2,
        sequence: 1,
        instruments: [{ volume: 40n, tradedValueCents: 406000n }],
      });
      expect(snapshots(events).at(-1)?.instruments).toHaveLength(1);
    },
  );

  it.each(['resolve', 'reject'])(
    'ignores an old asynchronous load that later %ss',
    async (completion) => {
      const firstLoad = deferred<WasmProducerExports>();
      const secondLoad = deferred<WasmProducerExports>();
      const first = fixtureProducer();
      const second = fixtureProducer();
      const load = vi
        .fn<MarketWorkerDependencies['load']>()
        .mockReturnValueOnce(firstLoad.promise)
        .mockReturnValueOnce(secondLoad.promise);
      const { runtime, events, signals } = harness(load);
      start(runtime);
      vi.advanceTimersByTime(6_000);
      start(runtime, 2, 2);
      expect(signals[0].aborted).toBe(true);
      expect(vi.getTimerCount()).toBe(1);
      vi.advanceTimersByTime(4_000);
      expect(events).toEqual([]);
      expect(signals[1].aborted).toBe(false);
      secondLoad.resolve(second);
      await Promise.resolve();
      if (completion === 'resolve') firstLoad.resolve(first);
      else firstLoad.reject(new Error('old download failed'));
      await Promise.resolve();
      vi.advanceTimersByTime(50);
      expect(first.reset).not.toHaveBeenCalled();
      expect(events.every((event) => event.runId === 2)).toBe(true);
      expect(events.some((event) => event.kind === ProducerEventKind.Failed)).toBe(false);
    },
  );

  it('ignores duplicate, reordered, invalid-identity and stale-run commands', async () => {
    const producer = fixtureProducer();
    const { runtime, events } = harness(async () => producer);
    runtime.receive(null);
    start(runtime, 0, 1);
    start(runtime, 1, Number.MAX_SAFE_INTEGER + 1);
    expect(events).toEqual([]);
    start(runtime, 2, 2);
    await Promise.resolve();
    runtime.receive({
      kind: ProducerCommandKind.Pause,
      runId: 1,
      commandId: 3,
    });
    runtime.receive({
      kind: ProducerCommandKind.Pause,
      runId: 2,
      commandId: 1,
    });
    start(runtime, 2, 2);
    vi.advanceTimersByTime(50);
    expect(events).toHaveLength(2);
    expect(snapshots(events)).toHaveLength(1);
  });

  it('rejects bad settings, seed and run controls without loading or changing the active run', async () => {
    const producer = fixtureProducer();
    const load = vi.fn(async () => producer);
    const { runtime, events } = harness(load);
    runtime.receive({
      kind: ProducerCommandKind.Start,
      runId: 1,
      commandId: 1,
      settings: { ...settings, intervalMs: 0 },
      seed: 42,
    });
    runtime.receive({
      kind: ProducerCommandKind.Start,
      runId: 2,
      commandId: 2,
      settings,
      seed: 1.5,
    });
    expect(events).toEqual([
      expect.objectContaining({
        kind: ProducerEventKind.Failed,
        runId: 1,
        commandId: 1,
        code: ProducerFailureCode.InvalidSettings,
      }),
      expect.objectContaining({
        kind: ProducerEventKind.Failed,
        runId: 2,
        commandId: 2,
        code: ProducerFailureCode.InvalidCommand,
      }),
    ]);
    expect(load).not.toHaveBeenCalled();
    start(runtime, 3, 3);
    runtime.receive({
      kind: ProducerCommandKind.Pause,
      runId: 3,
      commandId: 4,
    });
    expect(events.at(-1)).toMatchObject({
      kind: ProducerEventKind.Failed,
      code: ProducerFailureCode.InvalidCommand,
    });
    await Promise.resolve();
    runtime.receive({
      kind: ProducerCommandKind.Pause,
      runId: 4,
      commandId: 5,
    });
    runtime.receive({ kind: 'unknown', runId: 3, commandId: 6 });
    start(runtime, 3, 7);
    vi.advanceTimersByTime(50);
    expect(snapshots(events)).toHaveLength(1);
    expect(load).toHaveBeenCalledTimes(1);
  });

  it.each(['load', 'reset'])(
    'reports a meaningful %s initialization failure tied to Start',
    async (phase) => {
      const producer = fixtureProducer();
      if (phase === 'reset')
        vi.mocked(producer.reset).mockImplementation(() => {
          throw new Error('reset trapped');
        });
      const { runtime, events, signals } = harness(async () => {
        if (phase === 'load') throw new Error('HTTP 404 Not Found');
        return producer;
      });
      start(runtime);
      await Promise.resolve();
      vi.advanceTimersByTime(1000);
      expect(events).toEqual([
        {
          kind: ProducerEventKind.Failed,
          runId: 1,
          commandId: 1,
          code: ProducerFailureCode.WasmInitialization,
          message: expect.stringContaining(phase === 'load' ? 'HTTP 404' : 'reset trapped'),
        },
      ]);
      expect(signals[0].aborted).toBe(true);
      expect(producer.writeBatch).not.toHaveBeenCalled();
    },
  );

  it.each(['trap', 'memory', 'record'])(
    'stops after a %s generation failure with no snapshot or commandId',
    async (failure) => {
      const producer = fixtureProducer();
      if (failure === 'trap')
        vi.mocked(producer.writeBatch).mockImplementation(() => {
          throw new Error('write trapped');
        });
      if (failure === 'memory') vi.mocked(producer.writeBatch).mockReturnValue(1);
      if (failure === 'record') new DataView(producer.memory.buffer).setUint32(64, 99, true);
      const { runtime, events, signals } = harness(async () => producer);
      start(runtime);
      await Promise.resolve();
      vi.advanceTimersByTime(1000);
      expect(events.at(-1)).toEqual({
        kind: ProducerEventKind.Failed,
        runId: 1,
        code: ProducerFailureCode.Generation,
        message: expect.stringContaining('failed:'),
      });
      expect(signals[0].aborted).toBe(true);
      expect(snapshots(events)).toEqual([]);
      expect(producer.writeBatch).toHaveBeenCalledTimes(1);
    },
  );

  it('disposes timers and pending loads and ignores late callbacks, completions and commands', async () => {
    const producer = fixtureProducer();
    const first = harness(async () => producer);
    start(first.runtime);
    await Promise.resolve();
    const pendingTick = first.scheduled[first.scheduled.length - 1];
    first.runtime.dispose();
    pendingTick();
    vi.advanceTimersByTime(1000);
    expect(first.signals[0].aborted).toBe(true);
    expect(producer.writeBatch).not.toHaveBeenCalled();
    expect(first.events).toHaveLength(1);
    const load = deferred<WasmProducerExports>();
    const pending = harness(() => load.promise);
    start(pending.runtime);
    pending.runtime.dispose();
    expect(vi.getTimerCount()).toBe(0);
    start(pending.runtime, 2, 2);
    load.resolve(producer);
    await Promise.resolve();
    expect(pending.signals).toHaveLength(1);
    expect(pending.signals[0].aborted).toBe(true);
    expect(pending.events).toEqual([]);
    expect(producer.reset).toHaveBeenCalledTimes(1);
  });
});
