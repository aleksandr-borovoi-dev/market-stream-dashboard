import { describe, expect, it } from 'vitest';
import { accumulateMarketBatch, createInstrumentSnapshots } from './instrument-snapshots';
import { formatImbalance, formatUsd, formatVolume } from './market-formatting';
import { deriveMarketMetrics } from './market-metrics';
import type { InstrumentSnapshot, MarketUpdate } from './market-update';

function createTrade(
  instrumentIndex: number,
  priceCents: number,
  tradeQuantity: number,
  quote: Partial<MarketUpdate> = {},
): MarketUpdate {
  return {
    instrumentIndex,
    priceCents,
    tradeQuantity,
    bidCents: priceCents - 1,
    askCents: priceCents,
    bidQuantity: 600,
    askQuantity: 400,
    ...quote,
  };
}

describe('instrument snapshots and market metrics', () => {
  it('starts an ordered run with unavailable metrics and zero volume', () => {
    const snapshots = createInstrumentSnapshots(3);

    expect(snapshots).toEqual([
      { instrumentIndex: 0, latest: null, volume: 0n, tradedValueCents: 0n },
      { instrumentIndex: 1, latest: null, volume: 0n, tradedValueCents: 0n },
      { instrumentIndex: 2, latest: null, volume: 0n, tradedValueCents: 0n },
    ]);
    expect(deriveMarketMetrics(snapshots[0])).toEqual({
      lastPriceCents: null,
      spreadCents: null,
      volume: 0n,
      vwap: null,
      imbalance: null,
    });
    expect(accumulateMarketBatch(snapshots, [])).toEqual(snapshots);
    expect(createInstrumentSnapshots(50)).toHaveLength(50);
  });

  it.each([0, 51, 1.5, Number.NaN, Number.POSITIVE_INFINITY])(
    'rejects an instrument count outside the integer limits: %s',
    (instrumentCount) => {
      expect(() => createInstrumentSnapshots(instrumentCount)).toThrow(RangeError);
    },
  );

  it('reproduces the assignment example and its financial presentation', () => {
    const snapshots = accumulateMarketBatch(createInstrumentSnapshots(1), [
      createTrade(0, 10_000, 10),
      createTrade(0, 10_200, 30, { bidCents: 10_196 }),
    ]);
    const metrics = deriveMarketMetrics(snapshots[0]);

    expect(snapshots[0].tradedValueCents).toBe(406_000n);
    expect(metrics).toEqual({
      lastPriceCents: 10_200,
      spreadCents: 4,
      volume: 40n,
      vwap: { numeratorCents: 406_000n, denominator: 40n },
      imbalance: 0.2,
    });
    expect(formatUsd(metrics.lastPriceCents)).toBe('$102.00');
    expect(formatUsd(metrics.spreadCents)).toBe('$0.04');
    expect(formatUsd(metrics.vwap)).toBe('$101.50');
    expect(formatVolume(metrics.volume)).toBe('40');
    expect(formatImbalance(metrics.imbalance)).toBe('0.20');
  });

  it('makes a zero book denominator unavailable while preserving valid trade metrics', () => {
    const snapshots = accumulateMarketBatch(createInstrumentSnapshots(1), [
      createTrade(0, 101, 2, { bidQuantity: 0, askQuantity: 0 }),
    ]);

    expect(deriveMarketMetrics(snapshots[0])).toEqual({
      lastPriceCents: 101,
      spreadCents: 1,
      volume: 2n,
      vwap: { numeratorCents: 202n, denominator: 2n },
      imbalance: null,
    });
  });

  it('isolates interleaved instruments and uses each latest quote', () => {
    const snapshots = accumulateMarketBatch(createInstrumentSnapshots(2), [
      createTrade(0, 100, 2, { bidQuantity: 10, askQuantity: 5 }),
      createTrade(1, 500, 7, { bidQuantity: 4, askQuantity: 6 }),
      createTrade(0, 200, 3, {
        bidCents: 200,
        askCents: 205,
        bidQuantity: 0,
        askQuantity: 9,
      }),
    ]);

    expect(snapshots.map((snapshot) => snapshot.instrumentIndex)).toEqual([0, 1]);
    expect(deriveMarketMetrics(snapshots[0])).toEqual({
      lastPriceCents: 200,
      spreadCents: 5,
      volume: 5n,
      vwap: { numeratorCents: 800n, denominator: 5n },
      imbalance: -1,
    });
    expect(deriveMarketMetrics(snapshots[1])).toEqual({
      lastPriceCents: 500,
      spreadCents: 1,
      volume: 7n,
      vwap: { numeratorCents: 3_500n, denominator: 7n },
      imbalance: -0.2,
    });
  });

  it('counts identical trades, continues between batches, and resets only with a new run', () => {
    const initial = createInstrumentSnapshots(1);
    const repeatedTrade = createTrade(0, 145, 2);
    const first = accumulateMarketBatch(initial, [repeatedTrade, repeatedTrade]);
    const second = accumulateMarketBatch(first, [createTrade(0, 151, 3)]);
    const reset = createInstrumentSnapshots(1);

    expect(first[0].volume).toBe(4n);
    expect(first[0].tradedValueCents).toBe(580n);
    expect(second[0].volume).toBe(7n);
    expect(second[0].tradedValueCents).toBe(1_033n);
    expect(second[0].latest?.priceCents).toBe(151);
    expect(first[0].latest?.priceCents).toBe(145);
    expect(initial[0].volume).toBe(0n);
    expect(reset).toEqual(initial);
    expect(reset).not.toBe(initial);
  });

  it('preserves frozen snapshots and inputs, including untouched instrument data', () => {
    const initial = Object.freeze(
      createInstrumentSnapshots(2).map((snapshot) => Object.freeze(snapshot)),
    );
    const update = Object.freeze(createTrade(0, 250, 4));
    const batch = Object.freeze([update]);
    const result = accumulateMarketBatch(initial, batch);

    expect(result).not.toBe(initial);
    expect(result[0]).not.toBe(initial[0]);
    expect(result[1]).toEqual(initial[1]);
    expect(result[0].latest).toEqual(update);
    expect(result[0].latest).not.toBe(update);
    expect(initial[0]).toEqual({
      instrumentIndex: 0,
      latest: null,
      volume: 0n,
      tradedValueCents: 0n,
    });
    expect(batch).toEqual([update]);
  });

  it('rejects a trade for an unconfigured instrument without changing the previous run', () => {
    const snapshots = createInstrumentSnapshots(2);

    expect(() =>
      accumulateMarketBatch(snapshots, [createTrade(0, 100, 2), createTrade(2, 100, 1)]),
    ).toThrow(RangeError);
    expect(snapshots[0].volume).toBe(0n);
    expect(snapshots[0].latest).toBeNull();
    expect(snapshots).toHaveLength(2);
  });

  it('multiplies maximum uint32 operands exactly before accumulating', () => {
    const first = accumulateMarketBatch(createInstrumentSnapshots(1), [
      createTrade(0, 4_294_967_295, 4_294_967_295, {
        bidQuantity: 4_294_967_295,
        askQuantity: 4_294_967_295,
      }),
    ]);
    const second = accumulateMarketBatch(first, [
      createTrade(0, 4_294_967_294, 1, { bidCents: 4_294_967_294, askCents: 4_294_967_295 }),
    ]);

    expect(first[0].tradedValueCents).toBe(18_446_744_065_119_617_025n);
    expect(first[0].volume).toBe(4_294_967_295n);
    expect(deriveMarketMetrics(first[0]).imbalance).toBe(0);
    expect(second[0].tradedValueCents).toBe(18_446_744_069_414_584_319n);
    expect(second[0].volume).toBe(4_294_967_296n);
    expect(deriveMarketMetrics(second[0]).vwap).toEqual({
      numeratorCents: 18_446_744_069_414_584_319n,
      denominator: 4_294_967_296n,
    });
    expect(formatUsd(deriveMarketMetrics(first[0]).vwap)).toBe('$42,949,672.95');
  });

  it('continues exact totals above Number.MAX_SAFE_INTEGER and displays their volume exactly', () => {
    const longRun: InstrumentSnapshot = {
      instrumentIndex: 0,
      latest: createTrade(0, 101, 1),
      volume: 9_007_199_254_740_993n,
      tradedValueCents: 909_727_124_728_840_293n,
    };
    const result = accumulateMarketBatch([longRun], [createTrade(0, 102, 9)]);
    const metrics = deriveMarketMetrics(result[0]);

    expect(result[0].volume).toBe(9_007_199_254_741_002n);
    expect(result[0].tradedValueCents).toBe(909_727_124_728_841_211n);
    expect(metrics.vwap).toEqual({
      numeratorCents: 909_727_124_728_841_211n,
      denominator: 9_007_199_254_741_002n,
    });
    expect(formatVolume(metrics.volume)).toBe('9,007,199,254,741,002');
    expect(formatUsd(metrics.vwap)).toBe('$1.01');
    expect(longRun.volume).toBe(9_007_199_254_740_993n);
    expect(formatVolume(longRun.volume)).toBe('9,007,199,254,740,993');
  });

  it('rounds only for display so later trades can move VWAP across a half-cent', () => {
    const first = accumulateMarketBatch(createInstrumentSnapshots(1), [
      createTrade(0, 100, 2),
      createTrade(0, 101, 1),
    ]);
    const firstMetrics = deriveMarketMetrics(first[0]);

    expect(firstMetrics.vwap).toEqual({ numeratorCents: 301n, denominator: 3n });
    expect(formatUsd(firstMetrics.vwap)).toBe('$1.00');

    const second = accumulateMarketBatch(first, [createTrade(0, 101, 1)]);

    expect(deriveMarketMetrics(second[0]).vwap).toEqual({ numeratorCents: 402n, denominator: 4n });
    expect(formatUsd(deriveMarketMetrics(second[0]).vwap)).toBe('$1.01');
    expect(first[0].tradedValueCents).toBe(301n);
    expect(formatUsd(firstMetrics.vwap)).toBe('$1.00');
  });
});

describe('financial formatting', () => {
  it('uses an unavailable marker and an explicit zero volume before data', () => {
    expect(formatUsd(null)).toBe('—');
    expect(formatUsd({ numeratorCents: 0n, denominator: 0n })).toBe('—');
    expect(formatImbalance(null)).toBe('—');
    expect(formatVolume(0n)).toBe('0');
    expect(formatUsd(0)).toBe('$0.00');
  });

  it('rounds exact price ratios to cents, with half-cent ties up', () => {
    expect(formatUsd({ numeratorCents: 100n, denominator: 3n })).toBe('$0.33');
    expect(formatUsd({ numeratorCents: 101n, denominator: 3n })).toBe('$0.34');
    expect(formatUsd({ numeratorCents: 101n, denominator: 2n })).toBe('$0.51');
    expect(formatUsd({ numeratorCents: 1_999n, denominator: 2n })).toBe('$10.00');
  });

  it('preserves a half-cent tie beyond the safe number range through final formatting', () => {
    expect(formatUsd({ numeratorCents: 18_014_398_509_481_985n, denominator: 2n })).toBe(
      '$90,071,992,547,409.93',
    );
  });

  it('formats signed imbalance with two decimals without percent scaling or negative zero', () => {
    expect(formatImbalance(-1)).toBe('-1.00');
    expect(formatImbalance(1)).toBe('1.00');
    expect(formatImbalance(0.005)).toBe('0.01');
    expect(formatImbalance(-0.005)).toBe('-0.01');
    expect(formatImbalance(-0.004)).toBe('0.00');
    expect(formatImbalance(1 / 3)).toBe('0.33');
  });
});
