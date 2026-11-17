/** Keep this Worker for the producer owner's lifetime; terminate it when that owner is destroyed. */
export function createMarketWorker(wasmUrl: URL): Worker {
  const worker = new Worker(new URL('./worker/market.worker', import.meta.url), { type: 'module' });
  worker.postMessage(wasmUrl.href);
  return worker;
}
