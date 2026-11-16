export interface WasmProducerExports {
  readonly memory: WebAssembly.Memory;

  /** Resets instrument prices and the PRNG. Counts are 1–50; seeds are unsigned 32-bit. */
  reset(instrumentCount: number, seed: number): void;

  /**
   * Writes exactly updateCount records (1–1000) and returns their aligned byte offset.
   * Records use the little-endian layout in wasm-layout.ts. Read before the next call;
   * the module owns and reuses the buffer. Obtain a fresh view after each call.
   */
  writeBatch(updateCount: number): number;
}
