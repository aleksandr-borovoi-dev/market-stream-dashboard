import type { WasmProducerExports } from '../wasm-producer';

export interface WasmLoaderDependencies {
  fetch(url: string | URL, options: { signal: AbortSignal }): Promise<Response>;
  instantiate(bytes: ArrayBuffer): Promise<WebAssembly.Instance>;
}

const browserDependencies: WasmLoaderDependencies = {
  fetch: (url, options) => fetch(url, options),
  instantiate: async (bytes) => (await WebAssembly.instantiate(bytes)).instance,
};

function hasProducerExports(
  exports: WebAssembly.Exports,
): exports is WebAssembly.Exports & WasmProducerExports {
  return (
    exports['memory'] instanceof WebAssembly.Memory &&
    typeof exports['reset'] === 'function' &&
    typeof exports['writeBatch'] === 'function'
  );
}

export async function loadWasmProducer(
  url: string | URL,
  signal: AbortSignal,
  dependencies: WasmLoaderDependencies = browserDependencies,
): Promise<WasmProducerExports> {
  signal.throwIfAborted();
  const response = await dependencies.fetch(url, { signal });
  if (!response.ok) {
    throw new Error(`Wasm download failed: HTTP ${response.status} ${response.statusText}.`);
  }
  const bytes = await response.arrayBuffer();
  signal.throwIfAborted();
  const instance = await dependencies.instantiate(bytes);
  signal.throwIfAborted();
  if (!hasProducerExports(instance.exports)) {
    throw new Error('Wasm producer must export memory, reset and writeBatch.');
  }
  return instance.exports;
}
