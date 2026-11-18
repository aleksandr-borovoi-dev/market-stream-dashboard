import { signal } from '@angular/core';
import { TestBed, type ComponentFixture } from '@angular/core/testing';
import {
  DEFAULT_PRODUCER_SETTINGS,
  validateProducerSettings,
  type ProducerSettings,
  type SettingsValidation,
} from '../../../packages/market-stream/contracts';
import { MarketStreamFacade } from '../../../packages/market-stream/store';
import { SetupPage } from './setup-page';

describe('SetupPage', () => {
  const settings = signal<ProducerSettings>(DEFAULT_PRODUCER_SETTINGS);
  const applySettings = vi.fn((input: unknown): SettingsValidation => {
    const result = validateProducerSettings(input);
    if (result.valid) {
      settings.set(result.settings);
    }
    return result;
  });

  let fixture: ComponentFixture<SetupPage>;
  let host: HTMLElement;

  function edit(key: keyof ProducerSettings, value: string): void {
    const input = host.querySelector<HTMLInputElement>('#' + key);
    if (!input) {
      throw new Error('Expected a settings input for ' + key);
    }
    input.value = value;
    input.dispatchEvent(new Event('input', { bubbles: true }));
  }

  function submit(): void {
    const button = host.querySelector<HTMLButtonElement>('button[type="submit"]');
    if (!button) {
      throw new Error('Expected an Apply submit button');
    }
    button.click();
  }

  function shownSettings(): string[] {
    return Array.from(host.querySelectorAll('aside dd'), (value) => value.textContent.trim());
  }

  beforeEach(async () => {
    settings.set(DEFAULT_PRODUCER_SETTINGS);
    applySettings.mockClear();
    TestBed.configureTestingModule({
      providers: [{ provide: MarketStreamFacade, useValue: { settings, applySettings } }],
    });
    fixture = TestBed.createComponent(SetupPage);
    host = fixture.nativeElement;
    await fixture.whenStable();
  });

  it('keeps edits in the draft until Apply and reflects the applied values', async () => {
    expect(Array.from(host.querySelectorAll('input'), (field) => field.value)).toEqual([
      '5',
      '100',
      '500',
    ]);

    edit('instrumentCount', '50');
    edit('updatesPerBatch', '1000');
    edit('intervalMs', '50');
    await fixture.whenStable();

    expect(applySettings).not.toHaveBeenCalled();
    expect(shownSettings()).toEqual(['5', '100', '500']);

    submit();
    await fixture.whenStable();

    expect(applySettings).toHaveBeenCalledExactlyOnceWith({
      instrumentCount: 50,
      updatesPerBatch: 1000,
      intervalMs: 50,
    });
    expect(shownSettings()).toEqual(['50', '1,000', '50']);
  });

  it.each<readonly [keyof ProducerSettings, string, string]>([
    ['instrumentCount', '', 'Enter a value.'],
    ['updatesPerBatch', '100.5', 'Enter a whole number.'],
    ['intervalMs', 'word', 'Enter a whole number.'],
    ['instrumentCount', '0', 'Enter a value in the allowed range.'],
    ['updatesPerBatch', '1001', 'Enter a value in the allowed range.'],
    ['intervalMs', '2001', 'Enter a value in the allowed range.'],
  ])('rejects invalid %s input %s and associates its field error', async (key, value, message) => {
    edit(key, value);
    submit();
    await fixture.whenStable();

    expect(applySettings).not.toHaveBeenCalled();
    expect(shownSettings()).toEqual(['5', '100', '500']);
    expect(host.querySelector('#' + key)?.getAttribute('aria-invalid')).toBe('true');
    expect(host.querySelector('#' + key)?.getAttribute('aria-describedby')).toContain(
      key + '-error',
    );
    expect(host.querySelector('#' + key + '-error')?.textContent.trim()).toBe(message);
  });
});
