import { describe, expect, it, vi } from 'vitest';
import type { WasmProducerExports } from '../wasm-producer';
import { readMarketBatch } from './wasm-reader';

// Literal byte positions are intentional: the fixture does not repeat the reader's enum mapping.
function putRecords(memory: WebAssembly.Memory, offset: number, rows: readonly number[][]): void {
  const view = new DataView(memory.buffer);
  rows.forEach((row, record) => {
    row.forEach((value, word) => view.setUint32(offset + record * 28 + word * 4, value, true));
  });
}

function fixtureProducer(rows: readonly number[][]): WasmProducerExports {
  const memory = new WebAssembly.Memory({ initial: 1 });
  putRecords(memory, 64, rows);
  return { memory, reset: vi.fn(), writeBatch: vi.fn(() => 64) };
}

describe('readMarketBatch', () => {
  it('requests exactly the batch size and decodes all seven little-endian unsigned words', () => {
    const producer = fixtureProducer([
      [1, 0x11223345, 7, 0x11223344, 0x11223345, 0xaabbccdd, 0xffff_ffff],
      [0, 10000, 10, 9996, 10000, 0, 400],
    ]);
    expect(readMarketBatch(producer, 2, 2)).toEqual([
      {
        instrumentIndex: 1,
        priceCents: 0x11223345,
        tradeQuantity: 7,
        bidCents: 0x11223344,
        askCents: 0x11223345,
        bidQuantity: 0xaabbccdd,
        askQuantity: 0xffff_ffff,
      },
      {
        instrumentIndex: 0,
        priceCents: 10000,
        tradeQuantity: 10,
        bidCents: 9996,
        askCents: 10000,
        bidQuantity: 0,
        askQuantity: 400,
      },
    ]);
    expect(producer.writeBatch).toHaveBeenCalledExactlyOnceWith(2);
  });

  it('takes its view after writeBatch grows memory, and copies records before buffer reuse', () => {
    const producer = fixtureProducer([]);
    vi.mocked(producer.writeBatch).mockImplementation(() => {
      producer.memory.grow(1);
      putRecords(producer.memory, 65536, [[0, 10200, 30, 10196, 10200, 600, 400]]);
      return 65536;
    });
    const updates = readMarketBatch(producer, 1, 1);
    new Uint8Array(producer.memory.buffer).fill(0);
    expect(updates[0]).toEqual({
      instrumentIndex: 0,
      priceCents: 10200,
      tradeQuantity: 30,
      bidCents: 10196,
      askCents: 10200,
      bidQuantity: 600,
      askQuantity: 400,
    });
  });

  it.each([-1, 1, 1.5, NaN, Infinity, 65532])('rejects invalid returned offset %s', (offset) => {
    const producer = fixtureProducer([]);
    vi.mocked(producer.writeBatch).mockReturnValue(offset);
    expect(() => readMarketBatch(producer, 1, 1)).toThrow('memory range');
  });

  it.each([
    [1, 10000, 10, 9996, 10000, 600, 400],
    [0, 10000, 0, 9996, 10000, 600, 400],
    [0, 10000, 10, 0, 10000, 600, 400],
    [0, 10000, 10, 10000, 9996, 600, 400],
    [0, 10000, 10, 10000, 10000, 600, 400],
    [0, 9999, 10, 9996, 10000, 600, 400],
  ])('rejects a record outside the declared trade/quote contract: %j', (...row) => {
    const producer = fixtureProducer([row]);
    expect(() => readMarketBatch(producer, 1, 1)).toThrow('invalid market update at record 0');
  });
});
