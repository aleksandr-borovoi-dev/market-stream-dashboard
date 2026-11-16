import {
  MAX_INSTRUMENT_COUNT,
  MAX_UPDATES_PER_BATCH,
  MIN_INSTRUMENT_COUNT,
  MIN_UPDATES_PER_BATCH,
} from '../packages/market-stream/producer-limits';

import {
  MARKET_BUFFER_BYTES,
  MARKET_RECORD_BYTES,
  MARKET_WORD_BYTES,
  MarketRecordField,
} from '../packages/market-stream/wasm-layout';

const INITIAL_MIDPOINT_CENTS: i32 = 10_000;

const INSTRUMENT_SPACING_CENTS: i32 = 500;

const MIN_MIDPOINT_CENTS: i32 = 100;

const MAX_MIDPOINT_CENTS: i32 = 1_000_000;

const MAX_STEP_CENTS: i32 = 2;

const MAX_HALF_SPREAD_CENTS: u32 = 3;

const MAX_TRADE_QUANTITY: u32 = 100;

const MAX_BOOK_QUANTITY: u32 = 1_000;

const OUTPUT: usize = memory.data(MARKET_BUFFER_BYTES, MARKET_WORD_BYTES);

const MIDPOINTS: usize = memory.data(MAX_INSTRUMENT_COUNT * sizeof<u32>(), MARKET_WORD_BYTES);

let activeInstrumentCount: u32 = 0;

let randomState: u32 = 0;

function checkedCount(value: f64, minimum: i32, maximum: i32): i32 {
  // f64 parameters preserve invalid JS numbers until they can be rejected here.
  if (!(value >= minimum && value <= maximum)) unreachable();
  const count = i32(value);
  if (value != count) unreachable();
  return count;
}

function randomBelow(limit: u32): u32 {
  // Full-period LCG modulo 2^32; seed zero needs no special case.
  randomState = randomState * 1_664_525 + 1_013_904_223;
  return u32((u64(randomState) * limit) >> 32);
}

function writeField(record: usize, field: MarketRecordField, value: u32): void {
  store<u32>(record + usize(field) * MARKET_WORD_BYTES, value);
}

export function reset(instrumentCount: f64, seed: u32): void {
  const count = checkedCount(instrumentCount, MIN_INSTRUMENT_COUNT, MAX_INSTRUMENT_COUNT);
  for (let index = 0; index < count; index++) {
    store<i32>(
      MIDPOINTS + usize(index) * sizeof<u32>(),
      INITIAL_MIDPOINT_CENTS + index * INSTRUMENT_SPACING_CENTS,
    );
  }
  activeInstrumentCount = u32(count);
  randomState = seed;
}

export function writeBatch(updateCount: f64): usize {
  if (activeInstrumentCount == 0) unreachable();
  const count = checkedCount(updateCount, MIN_UPDATES_PER_BATCH, MAX_UPDATES_PER_BATCH);

  for (let index = 0; index < count; index++) {
    const instrument = randomBelow(activeInstrumentCount);
    const midpointAddress = MIDPOINTS + usize(instrument) * sizeof<u32>();
    const movement = i32(randomBelow(u32(2 * MAX_STEP_CENTS + 1))) - MAX_STEP_CENTS;
    const midpoint = min<i32>(
      MAX_MIDPOINT_CENTS,
      max<i32>(MIN_MIDPOINT_CENTS, load<i32>(midpointAddress) + movement),
    );
    store<i32>(midpointAddress, midpoint);

    const halfSpread = 1 + randomBelow(MAX_HALF_SPREAD_CENTS);
    const bid = u32(midpoint) - halfSpread;
    const ask = u32(midpoint) + halfSpread;
    const price = randomBelow(2) == 0 ? bid : ask;
    const record = OUTPUT + usize(index) * MARKET_RECORD_BYTES;

    writeField(record, MarketRecordField.InstrumentIndex, instrument);
    writeField(record, MarketRecordField.PriceCents, price);
    writeField(record, MarketRecordField.TradeQuantity, 1 + randomBelow(MAX_TRADE_QUANTITY));
    writeField(record, MarketRecordField.BidCents, bid);
    writeField(record, MarketRecordField.AskCents, ask);
    writeField(record, MarketRecordField.BidQuantity, randomBelow(MAX_BOOK_QUANTITY + 1));
    writeField(record, MarketRecordField.AskQuantity, randomBelow(MAX_BOOK_QUANTITY + 1));
  }

  return OUTPUT;
}
