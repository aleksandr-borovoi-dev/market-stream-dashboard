# Market Stream Dashboard

Project for the Realtime Fintech Dashboard assignment: an Angular application with a live market dashboard and producer settings. The assignment requires simulated financial data to be generated in WebAssembly inside a Web Worker.

The original requirements are in [Senior Frontend Developer Task.docx](docs/Senior%20Frontend%20Developer%20Task.docx).

The current version contains the application shell, simulation contracts, settings validation and development checks. The `/market` and `/setup` routes show the shell until their pages are implemented. The Wasm generator and Worker are not implemented yet.

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
npm test               # Run unit tests once
npm run test:watch
npm run lint
npm run typecheck
npm run format:check
npm run format        # Apply formatting
npm run build
```

Vitest runs the unit tests in `src/` and `packages/`. Settings tests cover inclusive limits, invalid and missing inputs, independent field errors, draft isolation and the requested total update rate. Unit tests are part of `verify`, so they also run in GitHub Actions and the Vercel build.

The production output is written to `dist/market-stream-dashboard/browser`.

Pushes to `main` run the `Checks` workflow in GitHub Actions. It uses the Node version from `.nvmrc`, npm 11.12.1, a clean dependency installation, and `npm run check`.

Vercel Hobby deploys the connected repository's `main` branch. Its build checks formatting and runs `npm run verify` before publishing, so a failed application check stops that deployment. Vercel's processed `vercel.json` is excluded from formatting during deployment; the original file is still checked locally and in GitHub Actions. The root URL and two page routes load `index.html`; static files are served directly. An explicit final 404 rule prevents the Angular preset's fallback from serving HTML for missing assets.

## Simulation contracts

[`packages/market-stream/contracts.ts`](packages/market-stream/contracts.ts) is the public entry point for plain TypeScript models and validation. It has no Angular or NgRx dependency and can be imported by the UI, the Worker and tests. There is no separate package build or workspace framework.

Settings use numeric values: `instrumentCount` (default 5, range 1–50), `updatesPerBatch` (100, 1–1000) and `intervalMs` (500, 50–2000). Validation accepts only integers, reports errors per field, and returns a separate settings object without coercing strings. The requested rate is `updatesPerBatch * 1000 / intervalMs` across all instruments, independent of instrument count.

### Application and Worker

The message types define these lifecycle rules for the upcoming Worker and store implementation:

- `start` carries validated settings and a 32-bit seed. Every start, including Apply while paused, creates a new run with empty totals and starts generation. Draft edits do not send commands; navigation keeps the same producer owner.
- Every command has a positive, increasing `commandId`. Each new run also gets a new `runId`. Commands and acknowledgements must match the active run; acknowledgements also match the pending command. The owner separately rejects messages from a replaced Worker instance.
- Snapshots have an increasing `sequence` starting at 1 for each run. Older or repeated snapshots, statuses and errors from an earlier run cannot replace current state. Snapshots contain cumulative totals, so the receiver replaces them instead of adding them again.
- Pause publishes all completed work before its acknowledgement. Resume preserves Wasm state and totals and schedules the next batch after the configured interval, without catching up for paused time. Contradictory pause/resume commands wait for the pending acknowledgement; a new start can replace a pending run.
- Each instrument retains its latest trade and quote, cumulative volume and `sum(priceCents * tradeQuantity)`. Before its first trade, the latest update is `null` and both totals are `0n`. The two cumulative totals use `bigint`; snapshots travel by [structured clone](https://developer.mozilla.org/en-US/docs/Web/API/Web_Workers_API/Structured_clone_algorithm), rather than JSON. No complete trade history is kept.

### Worker and Wasm

The Wasm module exposes `memory`, `reset(instrumentCount, seed)` and `writeBatch(updateCount)`. Reset sets the starting prices for the configured instruments and restarts the random sequence. Writing a batch returns a byte offset to exactly the requested number of records in a reusable module-owned buffer. The module and its Worker reader will be built together, so the contract has no separate version export. Each record holds a trade and its quote.

Records contain seven unsigned 32-bit integers in [little-endian memory](https://developer.mozilla.org/en-US/docs/WebAssembly/Reference/JavaScript_interface/Memory/buffer). The layout and capacity constants are shared with the future AssemblyScript implementation.

| Byte offset | Field                                           |
| ----------- | ----------------------------------------------- |
| 0           | Instrument index, from 0 to instrumentCount − 1 |
| 4           | Trade price in cents                            |
| 8           | Trade quantity                                  |
| 12          | Bid price in cents                              |
| 16          | Ask price in cents                              |
| 20          | Bid quantity                                    |
| 24          | Ask quantity                                    |

Each record occupies 28 bytes; the maximum batch needs 28,000 bytes. The Worker reads the returned records before the next module call and obtains a fresh view after each call. The memory stays inside the Worker; the UI receives accumulated snapshots. Generator code, allocation behavior and the compiled ABI will be verified when the Wasm implementation is added.
