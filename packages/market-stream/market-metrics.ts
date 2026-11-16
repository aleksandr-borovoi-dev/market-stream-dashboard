import type { InstrumentSnapshot } from './market-update';

/** A nonnegative price in cents, represented exactly as numeratorCents / denominator. */
export interface ExactPrice {
  readonly numeratorCents: bigint;
  readonly denominator: bigint;
}

export interface MarketMetrics {
  readonly lastPriceCents: number | null;
  readonly spreadCents: number | null;
  readonly volume: bigint;
  readonly vwap: ExactPrice | null;
  readonly imbalance: number | null;
}

/** Derive the five dashboard metrics without rounding accumulated prices. */
export function deriveMarketMetrics(snapshot: InstrumentSnapshot): MarketMetrics {
  const latest = snapshot.latest;
  const bookQuantity = latest === null ? 0 : latest.bidQuantity + latest.askQuantity;

  return {
    lastPriceCents: latest?.priceCents ?? null,
    spreadCents: latest === null ? null : latest.askCents - latest.bidCents,
    volume: snapshot.volume,
    vwap:
      snapshot.volume === 0n
        ? null
        : { numeratorCents: snapshot.tradedValueCents, denominator: snapshot.volume },
    imbalance:
      latest === null || bookQuantity === 0
        ? null
        : (latest.bidQuantity - latest.askQuantity) / bookQuantity,
  };
}
