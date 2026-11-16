import {
  MAX_BATCH_INTERVAL_MS,
  MAX_INSTRUMENT_COUNT,
  MAX_UPDATES_PER_BATCH,
  MIN_BATCH_INTERVAL_MS,
  MIN_INSTRUMENT_COUNT,
  MIN_UPDATES_PER_BATCH,
} from './producer-limits';

export interface ProducerSettings {
  readonly instrumentCount: number;
  readonly updatesPerBatch: number;
  readonly intervalMs: number;
}

export interface SettingRange {
  readonly minimum: number;
  readonly maximum: number;
}

export const PRODUCER_SETTING_LIMITS = Object.freeze({
  instrumentCount: Object.freeze({
    minimum: MIN_INSTRUMENT_COUNT,
    maximum: MAX_INSTRUMENT_COUNT,
  }),
  updatesPerBatch: Object.freeze({
    minimum: MIN_UPDATES_PER_BATCH,
    maximum: MAX_UPDATES_PER_BATCH,
  }),
  intervalMs: Object.freeze({
    minimum: MIN_BATCH_INTERVAL_MS,
    maximum: MAX_BATCH_INTERVAL_MS,
  }),
});

export const DEFAULT_PRODUCER_SETTINGS: ProducerSettings = Object.freeze({
  instrumentCount: 5,
  updatesPerBatch: 100,
  intervalMs: 500,
});

export enum SettingIssue {
  Required = 'required',
  Integer = 'integer',
  Range = 'range',
}

export type SettingsErrors = Readonly<Partial<Record<keyof ProducerSettings, SettingIssue>>>;

export type SettingsValidation =
  | { readonly valid: true; readonly settings: ProducerSettings }
  | { readonly valid: false; readonly errors: SettingsErrors };

type IntegerValidation =
  | { readonly valid: true; readonly value: number }
  | { readonly valid: false; readonly issue: SettingIssue };

/** Validates without coercion and returns a copy separate from the editable input. */
export function validateProducerSettings(input: unknown): SettingsValidation {
  const candidate =
    typeof input === 'object' && input !== null && !Array.isArray(input) ? input : {};
  const instrumentCount = validateInteger(
    'instrumentCount' in candidate ? candidate.instrumentCount : undefined,
    PRODUCER_SETTING_LIMITS.instrumentCount,
  );
  const updatesPerBatch = validateInteger(
    'updatesPerBatch' in candidate ? candidate.updatesPerBatch : undefined,
    PRODUCER_SETTING_LIMITS.updatesPerBatch,
  );
  const intervalMs = validateInteger(
    'intervalMs' in candidate ? candidate.intervalMs : undefined,
    PRODUCER_SETTING_LIMITS.intervalMs,
  );

  if (instrumentCount.valid && updatesPerBatch.valid && intervalMs.valid) {
    return {
      valid: true,
      settings: {
        instrumentCount: instrumentCount.value,
        updatesPerBatch: updatesPerBatch.value,
        intervalMs: intervalMs.value,
      },
    };
  }

  const errors: Partial<Record<keyof ProducerSettings, SettingIssue>> = {};
  if (!instrumentCount.valid) {
    errors.instrumentCount = instrumentCount.issue;
  }
  if (!updatesPerBatch.valid) {
    errors.updatesPerBatch = updatesPerBatch.issue;
  }
  if (!intervalMs.valid) {
    errors.intervalMs = intervalMs.issue;
  }
  return { valid: false, errors };
}

/** Requested rate across all instruments; scheduling can make the actual rate lower. */
export function requestedUpdatesPerSecond(settings: ProducerSettings): number {
  return (settings.updatesPerBatch * 1_000) / settings.intervalMs;
}

function validateInteger(value: unknown, range: SettingRange): IntegerValidation {
  if (value === undefined || value === null || (typeof value === 'string' && value.trim() === '')) {
    return { valid: false, issue: SettingIssue.Required };
  }
  if (typeof value !== 'number' || !Number.isInteger(value)) {
    return { valid: false, issue: SettingIssue.Integer };
  }
  if (value < range.minimum || value > range.maximum) {
    return { valid: false, issue: SettingIssue.Range };
  }
  return { valid: true, value };
}
