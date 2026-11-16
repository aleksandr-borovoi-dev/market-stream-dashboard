import { describe, expect, it } from 'vitest';
import {
  DEFAULT_PRODUCER_SETTINGS,
  PRODUCER_SETTING_LIMITS,
  SettingIssue,
  requestedUpdatesPerSecond,
  validateProducerSettings,
} from './contracts';
import type { ProducerSettings, SettingsErrors } from './contracts';

const defaults: ProducerSettings = { instrumentCount: 5, updatesPerBatch: 100, intervalMs: 500 };

const fields: readonly (keyof ProducerSettings)[] = [
  'instrumentCount',
  'updatesPerBatch',
  'intervalMs',
];

function expectInvalid(input: unknown, errors: SettingsErrors): void {
  const result = validateProducerSettings(input);
  expect(result).toMatchObject({ valid: false });
  if (result.valid) {
    throw new Error('Expected invalid settings');
  }
  expect(result.errors).toEqual(errors);
}

describe('producer settings', () => {
  it('exposes the assignment defaults and inclusive limits', () => {
    expect(DEFAULT_PRODUCER_SETTINGS).toEqual(defaults);
    expect(PRODUCER_SETTING_LIMITS).toEqual({
      instrumentCount: { minimum: 1, maximum: 50 },
      updatesPerBatch: { minimum: 1, maximum: 1000 },
      intervalMs: { minimum: 50, maximum: 2000 },
    });
    expect(validateProducerSettings(defaults)).toEqual({ valid: true, settings: defaults });
  });

  it('accepts all combinations of inclusive lower and upper bounds', () => {
    for (const instrumentCount of [1, 50]) {
      for (const updatesPerBatch of [1, 1000]) {
        for (const intervalMs of [50, 2000]) {
          const settings = { instrumentCount, updatesPerBatch, intervalMs };
          expect(validateProducerSettings(settings)).toEqual({ valid: true, settings });
        }
      }
    }
  });

  it('reports required fields for missing and blank values', () => {
    for (const field of fields) {
      const missing: Partial<ProducerSettings> = { ...defaults };
      delete missing[field];
      expectInvalid(missing, { [field]: SettingIssue.Required });
      for (const value of [undefined, null, '', ' \t\n ']) {
        expectInvalid({ ...defaults, [field]: value }, { [field]: SettingIssue.Required });
      }
    }
  });

  it('requires finite integers without coercing other values', () => {
    for (const field of fields) {
      for (const value of [
        1.5,
        NaN,
        Infinity,
        -Infinity,
        '5',
        'invalid',
        true,
        false,
        {},
        [],
        5n,
        Symbol('value'),
      ]) {
        expectInvalid({ ...defaults, [field]: value }, { [field]: SettingIssue.Integer });
      }
    }
  });

  it('reports range errors only after the integer requirement is met', () => {
    const bounds: Record<keyof ProducerSettings, readonly [number, number]> = {
      instrumentCount: [1, 50],
      updatesPerBatch: [1, 1000],
      intervalMs: [50, 2000],
    };
    for (const field of fields) {
      const [minimum, maximum] = bounds[field];
      for (const value of [minimum - 1, maximum + 1, -100]) {
        expectInvalid({ ...defaults, [field]: value }, { [field]: SettingIssue.Range });
      }
      for (const value of [minimum - 0.5, maximum + 0.5]) {
        expectInvalid({ ...defaults, [field]: value }, { [field]: SettingIssue.Integer });
      }
    }
  });

  it('collects every invalid field and omits valid fields from errors', () => {
    expectInvalid(
      { instrumentCount: null, updatesPerBatch: '100', intervalMs: 2001 },
      {
        instrumentCount: SettingIssue.Required,
        updatesPerBatch: SettingIssue.Integer,
        intervalMs: SettingIssue.Range,
      },
    );
    expectInvalid(
      { ...defaults, instrumentCount: 0, intervalMs: undefined },
      {
        instrumentCount: SettingIssue.Range,
        intervalMs: SettingIssue.Required,
      },
    );
  });

  it('rejects non-settings inputs without throwing', () => {
    for (const input of [
      undefined,
      null,
      '',
      'settings',
      5,
      NaN,
      true,
      false,
      [],
      {},
      5n,
      Symbol('settings'),
    ]) {
      const result = validateProducerSettings(input);
      expect(result.valid).toBe(false);
    }
    expectInvalid(
      {},
      {
        instrumentCount: SettingIssue.Required,
        updatesPerBatch: SettingIssue.Required,
        intervalMs: SettingIssue.Required,
      },
    );
  });

  it('returns settings detached from subsequent edits to the input', () => {
    const input = { ...defaults };
    const result = validateProducerSettings(input);
    expect(result.valid).toBe(true);
    if (!result.valid) {
      throw new Error('Expected valid settings');
    }
    expect(result.settings).not.toBe(input);
    input.instrumentCount = 50;
    input.updatesPerBatch = 1000;
    input.intervalMs = 2000;
    expect(result.settings).toEqual(defaults);
  });
});

describe('requested updates per second', () => {
  it('calculates the total nominal rate independently of instrument count', () => {
    for (const instrumentCount of [1, 5, 50]) {
      expect(requestedUpdatesPerSecond({ ...defaults, instrumentCount })).toBe(200);
    }
  });

  it('supports fractional rates and the fastest allowed configuration', () => {
    expect(
      requestedUpdatesPerSecond({ instrumentCount: 1, updatesPerBatch: 1, intervalMs: 2000 }),
    ).toBe(0.5);
    expect(
      requestedUpdatesPerSecond({ instrumentCount: 50, updatesPerBatch: 1000, intervalMs: 50 }),
    ).toBe(20000);
    expect(
      requestedUpdatesPerSecond({ instrumentCount: 5, updatesPerBatch: 1, intervalMs: 333 }),
    ).toBeCloseTo(1000 / 333, 12);
  });
});
