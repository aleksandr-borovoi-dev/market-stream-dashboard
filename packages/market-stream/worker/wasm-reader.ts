import type { MarketUpdate } from '../market-update';
import { MARKET_RECORD_BYTES, MARKET_WORD_BYTES, MarketRecordField } from '../wasm-layout';
import type { WasmProducerExports } from '../wasm-producer';

export function readMarketBatch(
  producer: WasmProducerExports,
  updateCount: number,
  instrumentCount: number,
): readonly MarketUpdate[] {
  const offset = producer.writeBatch(updateCount);
  // writeBatch can grow memory, invalidating every earlier buffer/view.
  const buffer = producer.memory.buffer;
  const byteLength = updateCount * MARKET_RECORD_BYTES;
  if (
    !Number.isSafeInteger(offset) ||
    offset < 0 ||
    offset % MARKET_WORD_BYTES !== 0 ||
    offset + byteLength > buffer.byteLength
  ) {
    throw new Error('Wasm returned an invalid market batch memory range.');
  }
  const view = new DataView(buffer, offset, byteLength);
  const updates: MarketUpdate[] = [];
  for (let record = 0; record < updateCount; record += 1) {
    const base = record * MARKET_RECORD_BYTES;
    const word = (field: MarketRecordField): number =>
      view.getUint32(base + field * MARKET_WORD_BYTES, true);
    const update: MarketUpdate = {
      instrumentIndex: word(MarketRecordField.InstrumentIndex),
      priceCents: word(MarketRecordField.PriceCents),
      tradeQuantity: word(MarketRecordField.TradeQuantity),
      bidCents: word(MarketRecordField.BidCents),
      askCents: word(MarketRecordField.AskCents),
      bidQuantity: word(MarketRecordField.BidQuantity),
      askQuantity: word(MarketRecordField.AskQuantity),
    };
    if (
      update.instrumentIndex >= instrumentCount ||
      update.tradeQuantity === 0 ||
      update.bidCents === 0 ||
      update.bidCents >= update.askCents ||
      (update.priceCents !== update.bidCents && update.priceCents !== update.askCents)
    ) {
      throw new Error(`Wasm returned an invalid market update at record ${record}.`);
    }
    updates.push(update);
  }
  return updates;
}
