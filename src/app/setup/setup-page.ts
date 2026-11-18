import { DecimalPipe } from '@angular/common';
import { ChangeDetectionStrategy, Component, inject, linkedSignal } from '@angular/core';
import { FormField, FormRoot, form, validateTree } from '@angular/forms/signals';
import {
  PRODUCER_SETTING_LIMITS,
  SettingIssue,
  validateProducerSettings,
  type ProducerSettings,
} from '../../../packages/market-stream/contracts';
import { MarketStreamFacade } from '../../../packages/market-stream/store';
import { ActionButton } from '../action-button/action-button';

type SettingsDraft = Record<keyof ProducerSettings, string>;

const SETUP_FIELDS = [
  { key: 'instrumentCount', label: 'Instrument count' },
  { key: 'updatesPerBatch', label: 'Updates per batch' },
  { key: 'intervalMs', label: 'Batch interval (ms)' },
] as const satisfies readonly { key: keyof ProducerSettings; label: string }[];

const SETTING_ERROR_MESSAGES: Record<SettingIssue, string> = {
  [SettingIssue.Required]: 'Enter a value.',
  [SettingIssue.Integer]: 'Enter a whole number.',
  [SettingIssue.Range]: 'Enter a value in the allowed range.',
};

function parseDraftNumber(value: string): number | '' {
  const text = value.trim();
  if (text === '') {
    return '';
  }
  return /^[+-]?\d+$/.test(text) ? Number(text) : Number.NaN;
}

function readDraft(draft: SettingsDraft): Record<keyof ProducerSettings, number | ''> {
  return {
    instrumentCount: parseDraftNumber(draft.instrumentCount),
    updatesPerBatch: parseDraftNumber(draft.updatesPerBatch),
    intervalMs: parseDraftNumber(draft.intervalMs),
  };
}

@Component({
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [ActionButton, DecimalPipe, FormField, FormRoot],
  selector: 'app-setup-page',
  templateUrl: './setup-page.html',
})
export class SetupPage {
  private readonly facade = inject(MarketStreamFacade);

  protected readonly appliedSettings = this.facade.settings;

  protected readonly fields = SETUP_FIELDS;

  protected readonly limits = PRODUCER_SETTING_LIMITS;

  private readonly draft = linkedSignal<SettingsDraft>(() => {
    const settings = this.appliedSettings();
    return {
      instrumentCount: String(settings.instrumentCount),
      updatesPerBatch: String(settings.updatesPerBatch),
      intervalMs: String(settings.intervalMs),
    };
  });

  protected readonly settingsForm = form(
    this.draft,
    (root) => {
      validateTree(root, ({ value, fieldTree }) => {
        const validation = validateProducerSettings(readDraft(value()));
        if (validation.valid) {
          return;
        }
        return SETUP_FIELDS.flatMap(({ key }) => {
          const issue = validation.errors[key];
          return issue
            ? [{ fieldTree: fieldTree[key], kind: issue, message: SETTING_ERROR_MESSAGES[issue] }]
            : [];
        });
      });
    },
    {
      submission: {
        action: async (fields) => {
          this.facade.applySettings(readDraft(fields().value()));
        },
      },
    },
  );
}
