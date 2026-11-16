import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const WORD_BYTES = 4;
const RECORD_WORDS = 7;
const RECORD_BYTES = WORD_BYTES * RECORD_WORDS;
const PAGE_BYTES = 64 * 1024;
const wasmBytes = await readFile(new URL('../public/market-stream.wasm', import.meta.url));
const module = await WebAssembly.compile(wasmBytes);

function createProducer() {
  return new WebAssembly.Instance(module, {}).exports;
}

function readBatch(producer, updateCount) {
  const offset = producer.writeBatch(updateCount);
  assert.ok(Number.isInteger(offset) && offset >= 0, 'the buffer offset is a nonnegative integer');
  assert.equal(offset % WORD_BYTES, 0, 'records are word-aligned');
  assert.ok(offset + updateCount * RECORD_BYTES <= producer.memory.buffer.byteLength);
  const view = new DataView(producer.memory.buffer, offset, updateCount * RECORD_BYTES);
  const records = Array.from({ length: updateCount }, (_, recordIndex) =>
    Array.from({ length: RECORD_WORDS }, (_, fieldIndex) =>
      view.getUint32(recordIndex * RECORD_BYTES + fieldIndex * WORD_BYTES, true),
    ),
  );
  return { offset, records };
}

function assertValidRecords(records, instrumentCount) {
  for (const record of records) {
    const [
      instrumentIndex,
      priceCents,
      tradeQuantity,
      bidCents,
      askCents,
      bidQuantity,
      askQuantity,
    ] = record;
    assert.ok(instrumentIndex < instrumentCount, 'instrument indexes belong to this run');
    assert.ok(priceCents > 0, 'trade prices are positive integer cents');
    assert.ok(tradeQuantity > 0, 'trade quantities are positive');
    assert.ok(bidCents > 0 && bidCents < askCents, 'quotes are positive and ordered');
    assert.ok(
      priceCents === bidCents || priceCents === askCents,
      'each trade executes at its own bid or ask',
    );
    for (const quantity of [bidQuantity, askQuantity]) {
      assert.ok(Number.isInteger(quantity) && quantity >= 0 && quantity <= 0xffff_ffff);
    }
  }
}

test('the producer needs no host imports and exports its public API with fixed memory', () => {
  assert.deepEqual(WebAssembly.Module.imports(module), []);
  const producer = createProducer();
  assert.equal(typeof producer.reset, 'function');
  assert.equal(typeof producer.writeBatch, 'function');
  assert.ok(producer.memory instanceof WebAssembly.Memory);
  assert.equal(producer.memory.buffer.byteLength, PAGE_BYTES);
  assert.throws(() => producer.memory.grow(1), RangeError);
});

test('generation before reset traps and a subsequent valid reset initializes the producer', () => {
  const producer = createProducer();
  assert.throws(() => producer.writeBatch(1), WebAssembly.RuntimeError);
  producer.reset(1, 0);
  assertValidRecords(readBatch(producer, 1).records, 1);
});

test('requested batches contain valid records and leave the unused output tail unchanged', () => {
  for (const instrumentCount of [1, 5, 50]) {
    const producer = createProducer();
    producer.reset(instrumentCount, 0xffff_ffff);
    const outputOffset = readBatch(producer, 1).offset;
    for (const updateCount of [1, 100, 1000]) {
      const { offset, records } = readBatch(producer, updateCount);
      assert.equal(offset, outputOffset, 'successive batches reuse the output buffer');
      assertValidRecords(records, instrumentCount);
    }
    for (const updateCount of [1, 100, 999]) {
      const tailOffset = outputOffset + updateCount * RECORD_BYTES;
      const tailLength = (1000 - updateCount) * RECORD_BYTES;
      const expectedTail = new Uint8Array(producer.memory.buffer, tailOffset, tailLength).slice();
      const { offset, records } = readBatch(producer, updateCount);
      assert.equal(offset, outputOffset, 'short batches reuse the same output offset');
      assertValidRecords(records, instrumentCount);
      assert.deepEqual(
        new Uint8Array(producer.memory.buffer, tailOffset, tailLength),
        expectedTail,
        'a batch writes no records after its requested last record',
      );
    }
  }
});

test('reset replays the complete stream for unsigned seeds including zero', () => {
  const producer = createProducer();
  for (const seed of [0, 1, 0x8000_0000, 0xffff_ffff]) {
    producer.reset(5, seed);
    const expected = readBatch(producer, 1000).records;
    readBatch(producer, 100);
    producer.reset(5, seed);
    assert.deepEqual(readBatch(producer, 1000).records, expected);
    const independent = createProducer();
    independent.reset(5, seed);
    assert.deepEqual(readBatch(independent, 1000).records, expected);
  }
});

test('batch boundaries preserve the generated sequence and per-instrument state', () => {
  for (const instrumentCount of [1, 50]) {
    const whole = createProducer();
    const segmented = createProducer();
    whole.reset(instrumentCount, 12345);
    segmented.reset(instrumentCount, 12345);
    const expected = readBatch(whole, 1000).records;
    const actual = [1, 99, 333, 567].flatMap((count) => readBatch(segmented, count).records);
    assert.deepEqual(actual, expected);
    assert.deepEqual(readBatch(segmented, 100).records, readBatch(whole, 100).records);
  }
});

test('invalid counts trap without changing the current output or advancing the run', () => {
  const producer = createProducer();
  const control = createProducer();
  producer.reset(5, 42);
  control.reset(5, 42);
  let previous = readBatch(producer, 100);
  readBatch(control, 100);
  const invalidCounts = [
    0,
    -1,
    1.5,
    NaN,
    Infinity,
    -Infinity,
    2 ** 32 + 1,
    1 - 2 ** 32,
    2 ** 53 + 2,
  ];
  const invalidCases = [
    ...[...invalidCounts, 51, 2 ** 32 + 50].map((count) => () => producer.reset(count, 123)),
    ...[...invalidCounts, 1001, 2 ** 32 + 1000].map((count) => () => producer.writeBatch(count)),
  ];
  for (const invalidCall of invalidCases) {
    const output = new Uint8Array(
      producer.memory.buffer,
      previous.offset,
      previous.records.length * RECORD_BYTES,
    ).slice();
    assert.throws(invalidCall, WebAssembly.RuntimeError);
    assert.deepEqual(
      new Uint8Array(producer.memory.buffer, previous.offset, output.length),
      output,
      'a rejected call preserves the last published output',
    );
    previous = readBatch(producer, 23);
    assert.deepEqual(
      previous.records,
      readBatch(control, 23).records,
      'a rejected call preserves stream state',
    );
  }
});

test('repeated generation and reset reuse the fixed memory without accumulating pages', () => {
  const producer = createProducer();
  const originalBuffer = producer.memory.buffer;
  producer.reset(1, 0);
  const outputOffset = readBatch(producer, 1).offset;
  // More cycles than bytes in the fixed page expose even one leaked byte per cycle.
  for (let iteration = 0; iteration <= PAGE_BYTES; iteration += 1) {
    const instrumentCount = iteration % 2 === 0 ? 1 : 50;
    producer.reset(instrumentCount, iteration);
    const { offset, records } = readBatch(producer, 1);
    assert.equal(offset, outputOffset, 'reset and generation reuse the output allocation');
    assertValidRecords(records, instrumentCount);
    assert.strictEqual(producer.memory.buffer, originalBuffer);
    assert.equal(producer.memory.buffer.byteLength, PAGE_BYTES);
  }
  for (let batch = 0; batch < 100; batch += 1) {
    assert.equal(
      producer.writeBatch(1000),
      outputOffset,
      'an uninterrupted run reuses the output allocation',
    );
    assert.strictEqual(producer.memory.buffer, originalBuffer);
    assert.equal(producer.memory.buffer.byteLength, PAGE_BYTES);
  }
});
