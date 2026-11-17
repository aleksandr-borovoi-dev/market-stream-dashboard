import { describe, expect, it, vi } from 'vitest';
import { loadWasmProducer } from './wasm-loader';
import type { WasmLoaderDependencies } from './wasm-loader';

function loaderDependencies(): WasmLoaderDependencies {
  return {
    fetch: vi.fn(async () => new Response(new Uint8Array([0, 97, 115, 109]))),
    instantiate: vi.fn(async () => ({
      exports: {
        memory: new WebAssembly.Memory({ initial: 1 }),
        reset: vi.fn(),
        writeBatch: vi.fn(() => 0),
      },
    })),
  };
}

describe('loadWasmProducer', () => {
  it('fetches the supplied URL with its cancellation signal and instantiates the bytes', async () => {
    const dependencies = loaderDependencies();
    const signal = new AbortController().signal;
    const producer = await loadWasmProducer('/market.wasm', signal, dependencies);
    expect(dependencies.fetch).toHaveBeenCalledExactlyOnceWith('/market.wasm', {
      signal,
    });
    expect(dependencies.instantiate).toHaveBeenCalledExactlyOnceWith(
      new Uint8Array([0, 97, 115, 109]).buffer,
    );
    expect(producer.memory).toBeInstanceOf(WebAssembly.Memory);
    producer.reset(2, 42);
    expect(producer.reset).toHaveBeenCalledExactlyOnceWith(2, 42);
  });

  it('reports HTTP status instead of trying to compile an error response', async () => {
    const dependencies = loaderDependencies();
    vi.mocked(dependencies.fetch).mockResolvedValue(
      new Response('', { status: 404, statusText: 'Not Found' }),
    );
    await expect(
      loadWasmProducer('/missing.wasm', new AbortController().signal, dependencies),
    ).rejects.toThrow('HTTP 404 Not Found');
    expect(dependencies.instantiate).not.toHaveBeenCalled();
  });

  it('preserves a compiler error', async () => {
    const dependencies = loaderDependencies();
    vi.mocked(dependencies.instantiate).mockRejectedValue(
      new WebAssembly.CompileError('invalid Wasm bytes'),
    );
    await expect(
      loadWasmProducer('/broken.wasm', new AbortController().signal, dependencies),
    ).rejects.toThrow('invalid Wasm bytes');
  });

  it('rejects a module missing the declared exports', async () => {
    const dependencies = loaderDependencies();
    vi.mocked(dependencies.instantiate).mockResolvedValue({ exports: {} });
    await expect(
      loadWasmProducer('/wrong.wasm', new AbortController().signal, dependencies),
    ).rejects.toThrow('must export memory, reset and writeBatch');
  });

  it('does no network work after cancellation', async () => {
    const dependencies = loaderDependencies();
    const abort = new AbortController();
    abort.abort();
    await expect(loadWasmProducer('/market.wasm', abort.signal, dependencies)).rejects.toThrow();
    expect(dependencies.fetch).not.toHaveBeenCalled();
  });

  it('does not instantiate bytes from a cancelled download', async () => {
    const dependencies = loaderDependencies();
    const abort = new AbortController();
    vi.mocked(dependencies.fetch).mockImplementation(async () => {
      abort.abort();
      return new Response(new Uint8Array([0]));
    });
    await expect(loadWasmProducer('/market.wasm', abort.signal, dependencies)).rejects.toThrow();
    expect(dependencies.instantiate).not.toHaveBeenCalled();
  });
});
