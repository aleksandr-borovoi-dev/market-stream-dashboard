// Worker-safe public entry point. Keep Angular and application state out of this dependency graph.
export {
  DEFAULT_PRODUCER_SETTINGS,
  PRODUCER_SETTING_LIMITS,
  SettingIssue,
  requestedUpdatesPerSecond,
  validateProducerSettings,
} from './settings';

export type {
  ProducerSettings,
  SettingRange,
  SettingsErrors,
  SettingsValidation,
} from './settings';

export type { InstrumentSnapshot, MarketUpdate } from './market-update';

export {
  ProducerCommandKind,
  ProducerEventKind,
  ProducerFailureCode,
  ProducerMode,
} from './worker-protocol';

export type {
  ProducerAcknowledgement,
  ProducerCommand,
  ProducerEvent,
  ProducerFailure,
  ProducerSnapshot,
} from './worker-protocol';

export {
  MARKET_BUFFER_BYTES,
  MARKET_RECORD_BYTES,
  MARKET_RECORD_WORDS,
  MARKET_WORD_BYTES,
  MarketRecordField,
} from './wasm-layout';

export type { WasmProducerExports } from './wasm-producer';

export { accumulateMarketBatch, createInstrumentSnapshots } from './instrument-snapshots';

export { deriveMarketMetrics } from './market-metrics';

export type { ExactPrice, MarketMetrics } from './market-metrics';

export { formatImbalance, formatUsd, formatVolume } from './market-formatting';
