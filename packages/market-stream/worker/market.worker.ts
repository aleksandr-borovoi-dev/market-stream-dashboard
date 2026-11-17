import { MarketWorkerRuntime } from './market-worker-runtime';
import { loadWasmProducer } from './wasm-loader';

declare const self: DedicatedWorkerGlobalScope;

// The public factory sends the Wasm URL before any producer commands.
self.onmessage = ({ data: wasmUrl }: MessageEvent<string>): void => {
  const runtime = new MarketWorkerRuntime({
    load: (signal) => loadWasmProducer(wasmUrl, signal),
    publish: (event) => self.postMessage(event),
    schedule: (callback, delayMs) => {
      const timer = self.setTimeout(callback, delayMs);
      return () => self.clearTimeout(timer);
    },
  });
  self.onmessage = ({ data }: MessageEvent<unknown>): void => runtime.receive(data);
};
