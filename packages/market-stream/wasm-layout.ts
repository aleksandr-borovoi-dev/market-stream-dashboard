import { MAX_UPDATES_PER_BATCH } from './producer-limits';

// Shared by the TypeScript reader and the AssemblyScript producer. Each field is a u32.
export enum MarketRecordField {
  InstrumentIndex = 0,
  PriceCents = 1,
  TradeQuantity = 2,
  BidCents = 3,
  AskCents = 4,
  BidQuantity = 5,
  AskQuantity = 6,
}

export const MARKET_WORD_BYTES = 4;

export const MARKET_RECORD_WORDS = 7;

export const MARKET_RECORD_BYTES = MARKET_WORD_BYTES * MARKET_RECORD_WORDS;

export const MARKET_BUFFER_BYTES = MAX_UPDATES_PER_BATCH * MARKET_RECORD_BYTES;
