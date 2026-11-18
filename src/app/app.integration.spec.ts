import { TestBed, type ComponentFixture } from '@angular/core/testing';
import { Router } from '@angular/router';
import {
  accumulateMarketBatch,
  createInstrumentSnapshots,
  ProducerCommandKind,
  ProducerEventKind,
  ProducerFailureCode,
  ProducerMode,
  type ProducerCommand,
} from '../../packages/market-stream/contracts';
import {
  MARKET_WORKER_FACTORY,
  type MarketWorkerFactory,
} from '../../packages/market-stream/store';
import {
  acknowledge,
  ControlledWorker,
} from '../../packages/market-stream/testing/controlled-worker';
import { App } from './app';
import { appConfig } from './app.config';

describe('Market and producer settings', () => {
  const createWorker = vi.fn<MarketWorkerFactory>();

  let worker: ControlledWorker;
  let fixture: ComponentFixture<App>;
  let host: HTMLElement;

  function element<T extends Element>(selector: string): T {
    const match = host.querySelector<T>(selector);
    if (!match) {
      throw new Error(`Expected an element matching ${selector}`);
    }
    return match;
  }

  async function navigate(path: string): Promise<void> {
    await TestBed.inject(Router).navigateByUrl(path);
    await fixture.whenStable();
  }

  function sentCommand(index: number): ProducerCommand {
    const command = worker.commands[index];
    if (!command) {
      throw new Error(`Expected a producer command at index ${index}`);
    }
    return command;
  }

  function publishSnapshot(
    start: ProducerCommand,
    sequence: number,
    tradeQuantities: readonly number[],
  ): void {
    if (start.kind !== ProducerCommandKind.Start) {
      throw new Error('Expected a run initiated by a Start command');
    }
    const trades = tradeQuantities.map((tradeQuantity) => ({
      instrumentIndex: 0,
      priceCents: 12_605,
      tradeQuantity,
      bidCents: 12_600,
      askCents: 12_605,
      bidQuantity: 27,
      askQuantity: 63,
    }));
    worker.receive({
      kind: ProducerEventKind.Snapshot,
      runId: start.runId,
      sequence,
      instruments: accumulateMarketBatch(
        createInstrumentSnapshots(start.settings.instrumentCount),
        trades,
      ),
    });
  }

  function volumeTexts(): string[] {
    return Array.from(host.querySelectorAll('tbody tr td:nth-child(4)'), (cell) =>
      cell.textContent.trim(),
    );
  }

  function editInstrumentCount(count: number): void {
    const input = element<HTMLInputElement>('#instrumentCount');
    input.value = String(count);
    input.dispatchEvent(new Event('input', { bubbles: true }));
  }

  beforeEach(async () => {
    createWorker.mockReset();
    worker = new ControlledWorker();
    createWorker.mockReturnValue(worker);

    TestBed.configureTestingModule({
      providers: [
        ...appConfig.providers,
        { provide: MARKET_WORKER_FACTORY, useValue: createWorker },
      ],
    });
    fixture = TestBed.createComponent(App);
    host = fixture.nativeElement;
    await fixture.whenStable();
    await navigate('/market');
  });

  it('preserves the run and accumulated trades across navigation, pause and resume', async () => {
    const start = sentCommand(0);
    acknowledge(worker, start, ProducerMode.Running);
    publishSnapshot(start, 1, [17]);
    await fixture.whenStable();
    expect(volumeTexts()).toEqual(['17', '0', '0', '0', '0']);

    element<HTMLButtonElement>('main button').click();
    const pause = sentCommand(1);
    expect(pause).toMatchObject({ kind: ProducerCommandKind.Pause, runId: start.runId });
    acknowledge(worker, pause, ProducerMode.Paused, 1);
    await fixture.whenStable();

    await navigate('/setup');
    editInstrumentCount(8);
    await fixture.whenStable();
    await navigate('/market');
    expect(element('[role="status"]').textContent.trim()).toBe('Paused');
    expect(volumeTexts()).toEqual(['17', '0', '0', '0', '0']);
    expect(worker.commands).toHaveLength(2);

    element<HTMLButtonElement>('main button').click();
    const resume = sentCommand(2);
    expect(resume).toMatchObject({ kind: ProducerCommandKind.Resume, runId: start.runId });
    acknowledge(worker, resume, ProducerMode.Running, 1);
    await fixture.whenStable();
    expect(element('[role="status"]').textContent.trim()).toBe('Running');
    expect(volumeTexts()[0]).toBe('17');

    publishSnapshot(start, 2, [17, 12]);
    await fixture.whenStable();
    await navigate('/setup');
    await navigate('/market');
    expect(element('[role="status"]').textContent.trim()).toBe('Running');
    expect(volumeTexts()).toEqual(['29', '0', '0', '0', '0']);
    expect(worker.commands).toHaveLength(3);
    expect(createWorker).toHaveBeenCalledOnce();
  });

  it('renders only the latest run after two Apply submissions overlap', async () => {
    const initial = sentCommand(0);
    acknowledge(worker, initial, ProducerMode.Running);
    publishSnapshot(initial, 1, [43]);
    await fixture.whenStable();
    element<HTMLButtonElement>('main button').click();
    acknowledge(worker, sentCommand(1), ProducerMode.Paused, 1);

    await navigate('/setup');
    editInstrumentCount(2);
    element<HTMLButtonElement>('button[type="submit"]').click();
    await fixture.whenStable();
    const superseded = sentCommand(2);
    expect(superseded).toMatchObject({
      kind: ProducerCommandKind.Start,
      settings: { instrumentCount: 2 },
    });

    editInstrumentCount(3);
    element<HTMLButtonElement>('button[type="submit"]').click();
    await fixture.whenStable();
    const current = sentCommand(3);
    expect(current).toMatchObject({
      kind: ProducerCommandKind.Start,
      settings: { instrumentCount: 3 },
    });
    expect(current.runId).toBeGreaterThan(superseded.runId);

    acknowledge(worker, superseded, ProducerMode.Running);
    publishSnapshot(initial, 2, [43, 19]);
    publishSnapshot(superseded, 1, [54]);
    worker.receive({
      kind: ProducerEventKind.Failed,
      runId: superseded.runId,
      code: ProducerFailureCode.Generation,
      message: 'A superseded run failed.',
    });

    await navigate('/market');
    expect(element('[role="status"]').textContent.trim()).toBe('Starting');
    expect(volumeTexts()).toEqual(['0', '0', '0']);

    acknowledge(worker, current, ProducerMode.Running);
    publishSnapshot(current, 1, [11]);
    publishSnapshot(superseded, 2, [54, 23]);
    await fixture.whenStable();
    expect(element('[role="status"]').textContent.trim()).toBe('Running');
    expect(volumeTexts()).toEqual(['11', '0', '0']);
    expect(host.querySelector('[role="alert"]')).toBeNull();
    expect(worker.commands).toHaveLength(4);
    expect(createWorker).toHaveBeenCalledOnce();
  });

  it('lets the user retry a Wasm timeout by clicking Apply with unchanged settings', async () => {
    const start = sentCommand(0);
    const message = 'Loading timed out. Open Settings and select Apply to retry.';
    worker.receive({
      kind: ProducerEventKind.Failed,
      code: ProducerFailureCode.WasmInitialization,
      runId: start.runId,
      commandId: start.commandId,
      message,
    });
    await fixture.whenStable();
    expect(element('[role="status"]').textContent.trim()).toBe('Error');
    expect(element('[role="alert"]').textContent).toBe(message);

    await navigate('/setup');
    element<HTMLButtonElement>('button[type="submit"]').click();
    await fixture.whenStable();
    const retry = sentCommand(1);
    expect(retry.kind).toBe(ProducerCommandKind.Start);
    expect(retry.runId).toBeGreaterThan(start.runId);
    await navigate('/market');
    expect(element('[role="status"]').textContent.trim()).toBe('Starting');
    expect(host.querySelector('[role="alert"]')).toBeNull();

    acknowledge(worker, retry, ProducerMode.Running);
    publishSnapshot(retry, 1, [19]);
    await fixture.whenStable();
    expect(element('[role="status"]').textContent.trim()).toBe('Running');
    expect(volumeTexts()[0]).toBe('19');
  });
});
