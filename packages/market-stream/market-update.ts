/**
 * One trade and its current quote, using unsigned 32-bit integers.
 * Instrument indexes start at zero; 0 < bidCents < askCents, and priceCents is one of them.
 * Trade quantity is positive; book quantities can be zero.
 */
export interface MarketUpdate {
  readonly instrumentIndex: number;
  readonly priceCents: number;
  readonly tradeQuantity: number;
  readonly bidCents: number;
  readonly askCents: number;
  readonly bidQuantity: number;
  readonly askQuantity: number;
}

/**
 * Retains the latest update for instrumentIndex and exact cumulative totals from its trades.
 * Initially latest is null and both totals are 0n; book quantities never add to volume.
 */
export interface InstrumentSnapshot {
  readonly instrumentIndex: number;
  readonly latest: MarketUpdate | null;
  readonly volume: bigint;
  readonly tradedValueCents: bigint;
}
