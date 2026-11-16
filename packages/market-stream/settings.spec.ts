import { describe, expect, it } from 'vitest';
import {
  DEFAULT_PRODUCER_SETTINGS,
  SettingIssue,
  requestedUpdatesPerSecond,
  validateProducerSettings,
  type ProducerSettings,
} from './contracts';

const fieldCases: readonly {
  field: keyof ProducerSettings;
  minimum: number;
  maximum: number;
}[] = [
  { field: 'instrumentCount', minimum: 1, maximum: 50 },
  { field: 'updatesPerBatch', minimum: 1, maximum: 1_000 },
  { field: 'intervalMs', minimum: 50, maximum: 2_000 },
];

describe('producer settings', () => {
  it('accepts the assignment defaults', () => {
    expect(validateProducerSettings(DEFAULT_PRODUCER_SETTINGS)).toEqual({
      valid: true,
      settings: { instrumentCount: 5, updatesPerBatch: 100, intervalMs: 500 },
    });
  });

  describe.each(fieldCases)('$field', ({ field, minimum, maximum }) => {
    it.each([minimum, maximum])('accepts the inclusive boundary %s', (value) => {
      const input = { ...DEFAULT_PRODUCER_SETTINGS, [field]: value };

      expect(validateProducerSettings(input)).toEqual({ valid: true, settings: input });
    });

    it.each([minimum - 1, maximum + 1])('rejects the out-of-range value %s', (value) => {
      expect(validateProducerSettings({ ...DEFAULT_PRODUCER_SETTINGS, [field]: value })).toEqual({
        valid: false,
        errors: { [field]: SettingIssue.Range },
      });
    });

    it('rejects fractions even inside the allowed range', () => {
      expect(
        validateProducerSettings({ ...DEFAULT_PRODUCER_SETTINGS, [field]: minimum + 0.5 }),
      ).toEqual({ valid: false, errors: { [field]: SettingIssue.Integer } });
    });

    it.each([
      { label: 'undefined', value: undefined },
      { label: 'null', value: null },
      { label: 'empty text', value: '' },
      { label: 'whitespace', value: '  ' },
    ])('requires a value for $label', ({ value }) => {
      expect(validateProducerSettings({ ...DEFAULT_PRODUCER_SETTINGS, [field]: value })).toEqual({
        valid: false,
        errors: { [field]: SettingIssue.Required },
      });
    });

    it.each([
      { label: 'NaN', value: Number.NaN },
      { label: 'positive infinity', value: Number.POSITIVE_INFINITY },
      { label: 'negative infinity', value: Number.NEGATIVE_INFINITY },
      { label: 'numeric text', value: String(minimum) },
      { label: 'a boolean', value: true },
    ])('rejects $label instead of coercing it', ({ value }) => {
      expect(validateProducerSettings({ ...DEFAULT_PRODUCER_SETTINGS, [field]: value })).toEqual({
        valid: false,
        errors: { [field]: SettingIssue.Integer },
      });
    });
  });

  it('reports all invalid fields together', () => {
    expect(
      validateProducerSettings({ instrumentCount: 0, updatesPerBatch: 1_001, intervalMs: 50.5 }),
    ).toEqual({
      valid: false,
      errors: {
        instrumentCount: SettingIssue.Range,
        updatesPerBatch: SettingIssue.Range,
        intervalMs: SettingIssue.Integer,
      },
    });
  });

  it('reports a missing field without rejecting valid fields', () => {
    expect(validateProducerSettings({ instrumentCount: 5, updatesPerBatch: 100 })).toEqual({
      valid: false,
      errors: { intervalMs: SettingIssue.Required },
    });
  });

  it.each([undefined, null, [], 42, 'settings'])('rejects a non-settings input %j', (input) => {
    expect(validateProducerSettings(input)).toEqual({
      valid: false,
      errors: {
        instrumentCount: SettingIssue.Required,
        updatesPerBatch: SettingIssue.Required,
        intervalMs: SettingIssue.Required,
      },
    });
  });

  it('keeps validated settings separate from subsequent draft edits', () => {
    const draft = { ...DEFAULT_PRODUCER_SETTINGS };
    const result = validateProducerSettings(draft);
    if (!result.valid) {
      throw new Error('Expected the default draft to be valid.');
    }

    draft.instrumentCount = 17;
    draft.updatesPerBatch = 250;
    draft.intervalMs = 750;

    expect(result.settings).toEqual({ instrumentCount: 5, updatesPerBatch: 100, intervalMs: 500 });
  });
});

describe('requested update rate', () => {
  it.each([1, 5, 50])('is 200 updates per second across %s instruments', (instrumentCount) => {
    expect(requestedUpdatesPerSecond({ ...DEFAULT_PRODUCER_SETTINGS, instrumentCount })).toBe(200);
  });

  it('reaches 20,000 updates per second at the maximum batch size and minimum interval', () => {
    expect(
      requestedUpdatesPerSecond({ instrumentCount: 50, updatesPerBatch: 1_000, intervalMs: 50 }),
    ).toBe(20_000);
  });
});
