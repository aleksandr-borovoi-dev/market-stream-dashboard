import type { InstrumentSnapshot, MarketUpdate } from './market-update';
import { MAX_INSTRUMENT_COUNT, MIN_INSTRUMENT_COUNT } from './producer-limits';

/** Start a new run, ordered by the zero-based instrument index. */
export function createInstrumentSnapshots(instrumentCount: number): readonly InstrumentSnapshot[] {
  if (
    !Number.isInteger(instrumentCount) ||
    instrumentCount < MIN_INSTRUMENT_COUNT ||
    instrumentCount > MAX_INSTRUMENT_COUNT
  ) {
    throw new RangeError(
      `Instrument count must be an integer from ${MIN_INSTRUMENT_COUNT} to ${MAX_INSTRUMENT_COUNT}.`,
    );
  }

  return Array.from({ length: instrumentCount }, (_, instrumentIndex): InstrumentSnapshot => ({
    instrumentIndex,
    latest: null,
    volume: 0n,
    tradedValueCents: 0n,
  }));
}

/** Count every trade once, retaining only each instrument's latest quote and exact totals. */
export function accumulateMarketBatch(
  snapshots: readonly InstrumentSnapshot[],
  updates: readonly MarketUpdate[],
): readonly InstrumentSnapshot[] {
  const nextSnapshots = [...snapshots];

  for (const update of updates) {
    const snapshot = nextSnapshots[update.instrumentIndex];

    if (snapshot === undefined) {
      throw new RangeError(`Unknown instrument index: ${update.instrumentIndex}.`);
    }

    const tradeQuantity = BigInt(update.tradeQuantity);

    nextSnapshots[update.instrumentIndex] = {
      instrumentIndex: snapshot.instrumentIndex,
      latest: { ...update },
      volume: snapshot.volume + tradeQuantity,
      tradedValueCents: snapshot.tradedValueCents + BigInt(update.priceCents) * tradeQuantity,
    };
  }

  return nextSnapshots;
}
