import { inject, Injectable } from '@angular/core';
import { Actions, createEffect, ofType } from '@ngrx/effects';
import { map, tap } from 'rxjs';
import { ProducerEventKind } from '../worker-protocol';
import { MarketStreamActions } from './actions';
import { MarketWorkerTransport } from './market-worker-transport.service';

@Injectable()
export class MarketStreamEffects {
  private readonly actions$ = inject(Actions);
  private readonly transport = inject(MarketWorkerTransport);

  public readonly workerEvents$ = createEffect(() =>
    this.transport.events$.pipe(
      map((event) => {
        switch (event.kind) {
          case ProducerEventKind.Acknowledged:
            return MarketStreamActions.commandAcknowledged({ acknowledgement: event });
          case ProducerEventKind.Snapshot:
            return MarketStreamActions.snapshotReceived({ snapshot: event });
          case ProducerEventKind.Failed:
            return MarketStreamActions.producerFailed({ failure: event });
          case 'transport-failed':
            return MarketStreamActions.transportFailed({ failure: event });
        }
      }),
    ),
  );

  public readonly sendCommand$ = createEffect(
    () =>
      this.actions$.pipe(
        ofType(MarketStreamActions.startRequested, MarketStreamActions.modeChangeRequested),
        tap(({ command }) => this.transport.send(command)),
      ),
    { dispatch: false },
  );
}
