import { createActionGroup, props } from '@ngrx/store';
import type {
  ProducerAcknowledgement,
  ProducerFailure,
  ProducerSnapshot,
} from '../worker-protocol';
import type {
  ChangeProducerModeCommand,
  MarketWorkerTransportFailure,
  StartProducerCommand,
} from './interface';

export const MarketStreamActions = createActionGroup({
  source: 'Market Stream',
  events: {
    'Start Requested': props<{ command: StartProducerCommand }>(),
    'Mode Change Requested': props<{ command: ChangeProducerModeCommand }>(),
    'Command Acknowledged': props<{ acknowledgement: ProducerAcknowledgement }>(),
    'Snapshot Received': props<{ snapshot: ProducerSnapshot }>(),
    'Producer Failed': props<{ failure: ProducerFailure }>(),
    'Transport Failed': props<{ failure: MarketWorkerTransportFailure }>(),
  },
});
