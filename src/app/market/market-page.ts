import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import { requestedUpdatesPerSecond } from '../../../packages/market-stream/contracts';
import { MarketStreamFacade, MarketStreamStatus } from '../../../packages/market-stream/store';
import { ActionButton } from '../action-button/action-button';
import { InstrumentTable } from './instrument-table';

const STATUS_DISPLAY = {
  [MarketStreamStatus.Idle]: { label: 'Idle', appearance: 'waiting' },
  [MarketStreamStatus.Starting]: { label: 'Starting', appearance: 'waiting' },
  [MarketStreamStatus.Running]: { label: 'Running', appearance: 'running' },
  [MarketStreamStatus.Paused]: { label: 'Paused', appearance: 'waiting' },
  [MarketStreamStatus.Failed]: { label: 'Error', appearance: 'error' },
} satisfies Record<MarketStreamStatus, { label: string; appearance: string }>;

const RATE_FORMATTER = new Intl.NumberFormat('en-US', { maximumFractionDigits: 2 });

@Component({
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [ActionButton, InstrumentTable],
  selector: 'app-market-page',
  templateUrl: './market-page.html',
  styleUrl: './market-page.scss',
})
export class MarketPage {
  private readonly facade = inject(MarketStreamFacade);

  protected readonly snapshots = this.facade.snapshots;

  protected readonly error = this.facade.error;

  protected readonly confirmedStatus = computed(() => STATUS_DISPLAY[this.facade.status()]);

  protected readonly configuredRate = computed(() =>
    RATE_FORMATTER.format(requestedUpdatesPerSecond(this.facade.settings())),
  );

  protected readonly actionLabel = computed(() =>
    this.facade.status() === MarketStreamStatus.Paused ? 'Resume' : 'Pause',
  );

  protected readonly actionDisabled = computed(() => {
    const status = this.facade.status();
    const canToggle = status === MarketStreamStatus.Running || status === MarketStreamStatus.Paused;

    return !canToggle || this.facade.pendingCommand() !== null;
  });

  protected toggleProducer(): void {
    if (this.actionDisabled()) {
      return;
    }

    if (this.facade.status() === MarketStreamStatus.Paused) {
      this.facade.resume();
    } else {
      this.facade.pause();
    }
  }
}
