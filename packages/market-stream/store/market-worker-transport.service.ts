import { DOCUMENT, inject, Injectable, InjectionToken, type OnDestroy } from '@angular/core';
import { Subject } from 'rxjs';
import { ProducerCommandKind, type ProducerCommand, type ProducerEvent } from '../worker-protocol';
import { MarketWorkerTransportFailureCode, type MarketWorkerTransportFailure } from './interface';

export interface MarketWorkerEventMap {
  readonly message: MessageEvent<ProducerEvent>;
  readonly error: ErrorEvent;
  readonly messageerror: MessageEvent;
}

export interface MarketWorker {
  addEventListener<Kind extends keyof MarketWorkerEventMap>(
    kind: Kind,
    listener: (event: MarketWorkerEventMap[Kind]) => void,
  ): void;
  removeEventListener<Kind extends keyof MarketWorkerEventMap>(
    kind: Kind,
    listener: (event: MarketWorkerEventMap[Kind]) => void,
  ): void;
  postMessage(command: ProducerCommand): void;
  terminate(): void;
}

export type MarketWorkerFactory = (wasmUrl: URL) => MarketWorker;

export const MARKET_WORKER_FACTORY = new InjectionToken<MarketWorkerFactory>(
  'Market Worker factory',
);

interface MarketWorkerConnection {
  readonly worker: MarketWorker;
  readonly dispose: () => void;
  runId: number;
}

@Injectable()
export class MarketWorkerTransport implements OnDestroy {
  private readonly document = inject(DOCUMENT);
  private readonly createWorker = inject(MARKET_WORKER_FACTORY);

  private readonly workerEvents = new Subject<ProducerEvent | MarketWorkerTransportFailure>();

  private connection: MarketWorkerConnection | null = null;

  public readonly events$ = this.workerEvents.asObservable();

  public send(command: ProducerCommand): void {
    if (command.kind === ProducerCommandKind.Start) {
      if (this.connection) {
        this.connection.runId = command.runId;
      } else {
        try {
          this.connect(command.runId);
        } catch (error) {
          this.fail(
            command.runId,
            MarketWorkerTransportFailureCode.Creation,
            'Unable to create the market worker',
            error,
          );
          return;
        }
      }
    }

    try {
      this.connection?.worker.postMessage(command);
    } catch (error) {
      this.fail(
        command.runId,
        MarketWorkerTransportFailureCode.Send,
        'Unable to send a command to the market worker',
        error,
      );
    }
  }

  public ngOnDestroy(): void {
    this.disconnect();
    this.workerEvents.complete();
  }

  private connect(runId: number): void {
    const worker = this.createWorker(new URL('market-stream.wasm', this.document.baseURI));
    const onMessage = ({ data }: MessageEvent<ProducerEvent>): void => {
      if (this.connection === connection) {
        this.workerEvents.next(data);
      }
    };
    const onError = (event: ErrorEvent): void => {
      if (this.connection === connection) {
        this.fail(
          connection.runId,
          MarketWorkerTransportFailureCode.WorkerError,
          'The market worker stopped unexpectedly',
          event.message,
        );
      }
    };
    const onMessageError = (): void => {
      if (this.connection === connection) {
        this.fail(
          connection.runId,
          MarketWorkerTransportFailureCode.MessageError,
          'The market worker sent an unreadable message',
        );
      }
    };
    const connection: MarketWorkerConnection = {
      worker,
      runId,
      dispose: () => {
        worker.removeEventListener('message', onMessage);
        worker.removeEventListener('error', onError);
        worker.removeEventListener('messageerror', onMessageError);
        worker.terminate();
      },
    };
    this.connection = connection;
    worker.addEventListener('message', onMessage);
    worker.addEventListener('error', onError);
    worker.addEventListener('messageerror', onMessageError);
  }

  private fail(
    runId: number,
    code: MarketWorkerTransportFailureCode,
    message: string,
    cause?: unknown,
  ): void {
    this.disconnect();
    const detail = cause instanceof Error ? cause.message : cause;
    this.workerEvents.next({
      kind: 'transport-failed',
      runId,
      code,
      message: typeof detail === 'string' && detail ? `${message}: ${detail}` : message,
    });
  }

  private disconnect(): void {
    const connection = this.connection;
    this.connection = null;
    connection?.dispose();
  }
}
