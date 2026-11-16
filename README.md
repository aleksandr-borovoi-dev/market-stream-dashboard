# Market Stream Dashboard

Project for the Realtime Fintech Dashboard assignment: an Angular application with a live market dashboard and producer settings. The assignment requires simulated financial data to be generated in WebAssembly inside a Web Worker.

The original requirements are in [Senior Frontend Developer Task.docx](docs/Senior%20Frontend%20Developer%20Task.docx).

The current version contains the application shell, simulation contracts, settings validation, cumulative metric calculations and a seeded AssemblyScript producer compiled to WebAssembly. The `/market` and `/setup` routes show the shell until their pages are implemented. The Worker and its connection to the UI are not implemented yet.

Live demo: [market-stream-dashboard.vercel.app](https://market-stream-dashboard.vercel.app).

Requires Node.js 24.15.0 and npm 11.12.1. The Node version is recorded in `.nvmrc`.

```sh
npm ci
npm start
```

Open http://localhost:4200.

```sh
npm run check          # Formatting, lint, TypeScript, unit tests and production build
npm run verify         # Lint, TypeScript, unit tests and production build
npm test               # Compile and test Wasm, then run TypeScript unit tests
npm run test:wasm      # Compile and test the real Wasm module
npm run test:watch     # Watch TypeScript unit tests
npm run lint
npm run typecheck
npm run format:check
npm run format        # Apply formatting
npm run build
npm run build:wasm     # Compile assembly/producer.ts to public/market-stream.wasm
```

Vitest runs the unit tests in `src/` and `packages/`. Settings tests cover inclusive limits, invalid and missing inputs, independent field errors, draft isolation and the requested total update rate. Metric tests cover the assignment example, unavailable values, instrument isolation, immutable snapshots, large integer totals and rounding at presentation. Node's test runner instantiates the compiled Wasm module and checks its exports, input limits, deterministic resets, batch continuity, trade/quote invariants and bounded memory. Both test suites are part of `verify`, so they also run in GitHub Actions and the Vercel build.

`start`, `build` and `watch` compile Wasm before starting Angular. After editing AssemblyScript during a running development session, run `npm run build:wasm` again. The generated `.wasm` is ignored by Git and copied from `public/` into the Angular build; only its source and compiler configuration are committed.

The production output is written to `dist/market-stream-dashboard/browser`.

Pushes to `main` run the `Checks` workflow in GitHub Actions. It uses the Node version from `.nvmrc`, npm 11.12.1, a clean dependency installation, and `npm run check`.

Vercel Hobby deploys the connected repository's `main` branch. Its build checks formatting and runs `npm run verify` before publishing, so a failed application check stops that deployment. Vercel's processed `vercel.json` is excluded from formatting during deployment; the original file is still checked locally and in GitHub Actions. The root URL and two page routes load `index.html`; static files are served directly. An explicit final 404 rule prevents the Angular preset's fallback from serving HTML for missing assets.

## Simulation contracts

[`packages/market-stream/contracts.ts`](packages/market-stream/contracts.ts) is the public entry point for plain TypeScript models and validation. It has no Angular or NgRx dependency and can be imported by the UI, the Worker and tests. There is no separate package build or workspace framework.

Settings use numeric values: `instrumentCount` (default 5, range 1–50), `updatesPerBatch` (100, 1–1000) and `intervalMs` (500, 50–2000). Validation accepts only integers, reports errors per field, and returns a separate settings object without coercing strings. The requested rate is `updatesPerBatch * 1000 / intervalMs` across all instruments, independent of instrument count.

### Market calculations

`createInstrumentSnapshots(count)` initializes a run. `accumulateMarketBatch(snapshots, updates)` returns a new snapshot array, retaining each instrument's latest update and cumulative totals. Previous snapshots and inputs stay unchanged; every supplied trade counts, including identical trades. Market updates must satisfy the data contract, and an unconfigured instrument index is rejected.

`deriveMarketMetrics(snapshot)` returns the five dashboard metrics. Volume and traded value use `bigint`, with quantities converted before multiplication. VWAP remains the exact `{ numeratorCents, denominator }` relation until display. Empty data produces zero volume and unavailable metrics; a zero book denominator produces unavailable imbalance.

`formatUsd`, `formatVolume` and `formatImbalance` use fixed English dollar presentation. Currency rounds exact ratios to the nearest cent, with half-cent ties rounded upward. USD and volume formatting preserve large integer values; imbalance uses two decimals without percent scaling. Unavailable values display `—`. These helpers have no Angular dependency and are available through `contracts.ts`.

### Application and Worker

The message types define these lifecycle rules for the upcoming Worker and store implementation:

- `start` carries validated settings and a 32-bit seed. Every start, including Apply while paused, creates a new run with empty totals and starts generation. Draft edits do not send commands; navigation keeps the same producer owner.
- Every command has a positive, increasing `commandId`. Each new run also gets a new `runId`. Commands and acknowledgements must match the active run; acknowledgements also match the pending command. The owner separately rejects messages from a replaced Worker instance.
- Snapshots have an increasing `sequence` starting at 1 for each run. Older or repeated snapshots, statuses and errors from an earlier run cannot replace current state. Snapshots contain cumulative totals, so the receiver replaces them instead of adding them again.
- Pause publishes all completed work before its acknowledgement. Resume preserves Wasm state and totals and schedules the next batch after the configured interval, without catching up for paused time. Contradictory pause/resume commands wait for the pending acknowledgement; a new start can replace a pending run.
- Each instrument retains its latest trade and quote, cumulative volume and `sum(priceCents * tradeQuantity)`. Before its first trade, the latest update is `null` and both totals are `0n`. The two cumulative totals use `bigint`; snapshots travel by [structured clone](https://developer.mozilla.org/en-US/docs/Web/API/Web_Workers_API/Structured_clone_algorithm), rather than JSON. No complete trade history is kept.

### Worker and Wasm

The Wasm module exposes `memory`, `reset(instrumentCount, seed)` and `writeBatch(updateCount)`. Reset sets the starting prices for the configured instruments and restarts the random sequence. Writing a batch returns a byte offset to exactly the requested number of records in a reusable module-owned buffer. The module and its Worker reader are built from the same project, so the contract has no separate version export. Each record holds a trade and its quote. Calls before reset, instrument counts outside 1–50 and batch sizes outside 1–1000 trap without changing an active run. Counts enter Wasm as `f64` and are checked before conversion to integers, so fractions, NaN, infinities and oversized numbers cannot silently become valid counts. The caller must provide numeric values and an unsigned 32-bit seed.

Records contain seven unsigned 32-bit integers in [little-endian memory](https://developer.mozilla.org/en-US/docs/WebAssembly/Reference/JavaScript_interface/Memory/buffer). The layout and capacity constants are shared with the AssemblyScript implementation.

| Byte offset | Field                                           |
| ----------- | ----------------------------------------------- |
| 0           | Instrument index, from 0 to instrumentCount − 1 |
| 4           | Trade price in cents                            |
| 8           | Trade quantity                                  |
| 12          | Bid price in cents                              |
| 16          | Ask price in cents                              |
| 20          | Bid quantity                                    |
| 24          | Ask quantity                                    |

Each record occupies 28 bytes; the maximum batch needs 28,000 bytes. The upcoming Worker must read the returned records before the next module call and obtain a fresh view after each call. It will keep the module's memory private and send accumulated snapshots to the UI.

### Producer model and memory

`assembly/producer.ts` uses a 32-bit linear congruential generator: `state = 1664525 * state + 1013904223 (mod 2^32)`. These standard coefficients come from [Numerical Recipes in C, §7.1, equation 7.1.6](https://library.sciencemadness.org/lanl1_a/lib-www/numerica/c7-1.pdf#page=10). Seed zero is used directly. Bounded random values use the upper 32 bits of `u64(state) * limit`, avoiding selection by the weak low bits of the LCG state. Resetting to the same instrument count and seed repeats the stream; splitting calls into smaller batches preserves the exact sequence. Random values and all price-generation logic execute inside Wasm, with no host imports.

Instrument `i` starts with a quote midpoint of `10000 + i * 500` cents. Every update selects an instrument, moves its previous midpoint by −2 to +2 cents and clamps it to 100–1,000,000 cents. A half-spread of 1–3 cents places bid below and ask above the midpoint, producing spreads of 2, 4 or 6 cents. Trade price is that update's bid or ask, trade quantity is 1–100, and each book quantity is 0–1000. These fixed constants define a simple demonstration model; the assignment requires the trading invariants rather than these specific values. They are not additional user settings.

The module reserves 200 bytes for midpoints and 28,000 bytes for its output using AssemblyScript's static [`memory.data`](https://www.assemblyscript.org/stdlib/globals.html#memory) buffers. There are no per-call object or array allocations. `asconfig.json` selects the [`stub` runtime](https://www.assemblyscript.org/runtime.html#variants) and fixes initial and maximum memory to one 64 KiB page. Producer tests check the assignment's trading rules and the public ABI, including replay, batch segmentation, exact-length writes and rejected-call atomicity. Resource checks cover uninterrupted maximum-size batches and 65,537 reset-and-generate cycles with an unchanged output offset and memory buffer.
