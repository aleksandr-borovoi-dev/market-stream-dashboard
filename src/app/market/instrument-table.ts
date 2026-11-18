import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';
import {
  deriveMarketMetrics,
  formatImbalance,
  formatUsd,
  formatVolume,
  type InstrumentSnapshot,
} from '../../../packages/market-stream/contracts';

const INSTRUMENT_SYMBOLS: readonly string[] = [
  'ASTR',
  'BORE',
  'CYGN',
  'DUNE',
  'ECHO',
  'FERN',
  'GLNT',
  'HARB',
  'INDI',
  'JADE',
  'KEST',
  'LUMA',
  'MESA',
  'NORD',
  'ORCA',
  'PINE',
  'QUAD',
  'REEF',
  'SAGE',
  'TERN',
  'URSA',
  'VELA',
  'WREN',
  'XENO',
  'YARD',
  'ZINC',
  'ALTO',
  'BRIO',
  'CORA',
  'DART',
  'ELIO',
  'FLUX',
  'GRIT',
  'HYMN',
  'IRIS',
  'JOLT',
  'KITE',
  'LYRA',
  'MINT',
  'NOVA',
  'OPAL',
  'PACT',
  'QUIL',
  'RIFT',
  'SORA',
  'TIDE',
  'UMBR',
  'VALE',
  'WISP',
  'ZEST',
];

interface InstrumentRow {
  readonly instrumentIndex: number;
  readonly symbol: string;
  readonly lastPrice: string;
  readonly hasPrice: boolean;
  readonly spread: string;
  readonly volume: string;
  readonly vwap: string;
  readonly imbalance: string;
  readonly hasImbalance: boolean;
  readonly negativeImbalance: boolean;
}

function formatInstrument(snapshot: InstrumentSnapshot): InstrumentRow {
  const metrics = deriveMarketMetrics(snapshot);
  const imbalance = formatImbalance(metrics.imbalance);

  return {
    instrumentIndex: snapshot.instrumentIndex,
    symbol: INSTRUMENT_SYMBOLS[snapshot.instrumentIndex],
    lastPrice: formatUsd(metrics.lastPriceCents),
    hasPrice: metrics.lastPriceCents !== null,
    spread: formatUsd(metrics.spreadCents),
    volume: formatVolume(metrics.volume),
    vwap: formatUsd(metrics.vwap),
    imbalance,
    hasImbalance: metrics.imbalance !== null,
    negativeImbalance: /^[-−]/.test(imbalance),
  };
}

@Component({
  changeDetection: ChangeDetectionStrategy.OnPush,
  selector: 'app-instrument-table',
  templateUrl: './instrument-table.html',
  styleUrl: './instrument-table.scss',
})
export class InstrumentTable {
  readonly snapshots = input.required<readonly InstrumentSnapshot[]>();

  protected readonly rows = computed(() => this.snapshots().map(formatInstrument));
}
