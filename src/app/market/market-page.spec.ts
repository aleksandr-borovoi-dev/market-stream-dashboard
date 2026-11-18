import { signal } from '@angular/core';
import { TestBed, type ComponentFixture } from '@angular/core/testing';
import {
  accumulateMarketBatch,
  createInstrumentSnapshots,
  DEFAULT_PRODUCER_SETTINGS,
  ProducerCommandKind,
  ProducerFailureCode,
  type InstrumentSnapshot,
  type MarketUpdate,
} from '../../../packages/market-stream/contracts';
import {
  MarketStreamFacade,
  MarketStreamStatus,
  type MarketStreamError,
} from '../../../packages/market-stream/store';
import { MarketPage } from './market-page';

const FIRST_TRADE: MarketUpdate = {
  instrumentIndex: 0,
  priceCents: 10_000,
  tradeQuantity: 10,
  bidCents: 9_996,
  askCents: 10_000,
  bidQuantity: 600,
  askQuantity: 400,
};

const SECOND_TRADE: MarketUpdate = {
  ...FIRST_TRADE,
  priceCents: 10_200,
  tradeQuantity: 30,
  bidCents: 10_196,
  askCents: 10_200,
};

function metricsIn(row: Element): string[] {
  return Array.from(row.querySelectorAll('td'), (cell) => cell.textContent?.trim() ?? '');
}

describe('MarketPage', () => {
  const settings = signal(DEFAULT_PRODUCER_SETTINGS);
  const status = signal(MarketStreamStatus.Starting);
  const pendingCommand = signal<ProducerCommandKind | null>(ProducerCommandKind.Start);
  const snapshots = signal<readonly InstrumentSnapshot[]>([]);
  const error = signal<MarketStreamError | null>(null);
  const pause = vi.fn(() => pendingCommand.set(ProducerCommandKind.Pause));
  const resume = vi.fn(() => pendingCommand.set(ProducerCommandKind.Resume));
  const facade = {
    settings,
    status,
    pendingCommand,
    snapshots,
    error,
    pause,
    resume,
  } satisfies Pick<
    MarketStreamFacade,
    'settings' | 'status' | 'pendingCommand' | 'snapshots' | 'error' | 'pause' | 'resume'
  >;

  let fixture: ComponentFixture<MarketPage>;
  let host: HTMLElement;

  function producerButton(): HTMLButtonElement {
    const button = host.querySelector('button');
    if (!button) {
      throw new Error('Expected a producer control');
    }
    return button;
  }

  function expectControl(label: string, confirmedStatus: string, disabled: boolean): void {
    const button = producerButton();
    expect(button.textContent?.trim()).toBe(label);
    expect(button.disabled).toBe(disabled);
    expect(host.querySelector('[role="status"]')?.textContent?.trim()).toBe(confirmedStatus);
  }

  beforeEach(() => {
    settings.set(DEFAULT_PRODUCER_SETTINGS);
    status.set(MarketStreamStatus.Starting);
    pendingCommand.set(ProducerCommandKind.Start);
    snapshots.set(createInstrumentSnapshots(settings().instrumentCount));
    error.set(null);
    pause.mockClear();
    resume.mockClear();

    TestBed.configureTestingModule({
      providers: [{ provide: MarketStreamFacade, useValue: facade }],
    });
    fixture = TestBed.createComponent(MarketPage);
    host = fixture.nativeElement;
  });

  it('shows unavailable metrics and zero volume until the first batch', async () => {
    await fixture.whenStable();

    const rows = host.querySelectorAll('tbody tr');
    expect(rows).toHaveLength(5);
    for (const row of rows) {
      expect(metricsIn(row)).toEqual(['—', '—', '0', '—', '—']);
    }
    expect(host.textContent).toContain('200 updates/s');
    expectControl('Pause', 'Starting', true);
  });

  it('renders the five formatted metrics for a traded instrument', async () => {
    snapshots.set(accumulateMarketBatch(snapshots(), [FIRST_TRADE, SECOND_TRADE]));
    await fixture.whenStable();

    const row = host.querySelector('tbody tr');
    expect(row?.querySelector('th[scope="row"]')?.textContent).toBe('ASTR');
    expect(row && metricsIn(row)).toEqual(['$102.00', '$0.04', '40', '$101.50', '0.20']);
  });

  it('keeps all 50 instrument rows and their DOM identities when snapshots change', async () => {
    settings.set({ instrumentCount: 50, updatesPerBatch: 1000, intervalMs: 50 });
    snapshots.set(createInstrumentSnapshots(settings().instrumentCount));
    await fixture.whenStable();

    const before = Array.from(host.querySelectorAll('tbody tr'));
    const symbols = Array.from(host.querySelectorAll('tbody th'), (cell) => cell.textContent);
    expect(before).toHaveLength(50);
    expect(new Set(symbols).size).toBe(50);
    expect(host.textContent).toContain('20,000 updates/s');
    expect(host.textContent).toContain('50 instruments');

    const wideTrade: MarketUpdate = {
      ...SECOND_TRADE,
      instrumentIndex: 49,
      priceCents: 1_000_003,
      tradeQuantity: 123_456_789,
      bidCents: 999_997,
      askCents: 1_000_003,
    };
    const nextSnapshots = accumulateMarketBatch(snapshots(), [wideTrade]);
    snapshots.set(nextSnapshots.map((snapshot) => ({ ...snapshot })));
    await fixture.whenStable();

    const after = Array.from(host.querySelectorAll('tbody tr'));
    expect(after).toHaveLength(50);
    after.forEach((row, index) => expect(row).toBe(before[index]));
    expect(metricsIn(after[49])).toEqual([
      '$10,000.03',
      '$0.06',
      '123,456,789',
      '$10,000.03',
      '0.20',
    ]);
  });

  it('keeps the confirmed status and the last values until each mode request is acknowledged', async () => {
    snapshots.set(accumulateMarketBatch(snapshots(), [FIRST_TRADE, SECOND_TRADE]));
    status.set(MarketStreamStatus.Running);
    pendingCommand.set(null);
    await fixture.whenStable();
    const tableText = host.querySelector('tbody')?.textContent;
    expectControl('Pause', 'Running', false);

    producerButton().click();
    await fixture.whenStable();
    expect(pause).toHaveBeenCalledOnce();
    expectControl('Pause', 'Running', true);

    producerButton().click();
    expect(pause).toHaveBeenCalledOnce();

    status.set(MarketStreamStatus.Paused);
    pendingCommand.set(null);
    await fixture.whenStable();
    expectControl('Resume', 'Paused', false);
    expect(host.querySelector('tbody')?.textContent).toBe(tableText);

    producerButton().click();
    await fixture.whenStable();
    expect(resume).toHaveBeenCalledOnce();
    expectControl('Resume', 'Paused', true);

    status.set(MarketStreamStatus.Running);
    pendingCommand.set(null);
    await fixture.whenStable();
    expectControl('Pause', 'Running', false);
    expect(host.querySelector('tbody')?.textContent).toBe(tableText);
  });

  it('announces the facade error and disables producer controls on failure', async () => {
    const message = 'The Wasm module could not load.';
    status.set(MarketStreamStatus.Failed);
    pendingCommand.set(null);
    error.set({ code: ProducerFailureCode.WasmInitialization, message });
    await fixture.whenStable();

    expect(host.querySelector('[role="alert"]')?.textContent).toBe(message);
    expectControl('Pause', 'Error', true);
  });
});
