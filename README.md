# Market Stream Dashboard

Project for the Realtime Fintech Dashboard assignment: an Angular application with a live market dashboard and producer settings. The assignment requires simulated financial data to be generated in WebAssembly inside a Web Worker.

The original requirements are in [Senior Frontend Developer Task.docx](docs/Senior%20Frontend%20Developer%20Task.docx).

The current version contains the application shell and development checks. The `/market` and `/setup` routes show the shell until their pages are implemented.

Live demo: [market-stream-dashboard.vercel.app](https://market-stream-dashboard.vercel.app).

Requires Node.js 24.15.0 and npm 11.12.1. The Node version is recorded in `.nvmrc`.

```sh
npm ci
npm start
```

Open http://localhost:4200.

```sh
npm run check          # Formatting, lint, TypeScript and production build
npm run verify         # Lint, TypeScript and production build
npm run lint
npm run typecheck
npm run format:check
npm run format        # Apply formatting
npm run build
```

Vitest is configured for future tests. After adding `.spec.ts` files, use `npm test` or `npm run test:watch`.

The production output is written to `dist/market-stream-dashboard/browser`.

Pushes to `main` run the `Checks` workflow in GitHub Actions. It uses the Node version from `.nvmrc`, npm 11.12.1, a clean dependency installation, and `npm run check`.

Vercel Hobby deploys the connected repository's `main` branch. Its build checks formatting and runs `npm run verify` before publishing, so a failed application check stops that deployment. Vercel's processed `vercel.json` is excluded from formatting during deployment; the original file is still checked locally and in GitHub Actions. The root URL and two page routes load `index.html`; static files are served directly. An explicit final 404 rule prevents the Angular preset's fallback from serving HTML for missing assets.
