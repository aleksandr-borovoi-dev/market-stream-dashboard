import { vi } from 'vitest';
import type { MarketWorker, MarketWorkerEventMap } from '../store';
import {
  ProducerEventKind,
  type ProducerCommand,
  type ProducerEvent,
  type ProducerMode,
} from '../worker-protocol';

type WorkerListeners = {
  [Kind in keyof MarketWorkerEventMap]: Set<(event: MarketWorkerEventMap[Kind]) => void>;
};

export class ControlledWorker implements MarketWorker {
  private readonly listeners: WorkerListeners = {
    message: new Set(),
    error: new Set(),
    messageerror: new Set(),
  };

  public readonly commands: ProducerCommand[] = [];

  public readonly terminate = vi.fn<() => void>();

  public sendError: Error | null = null;

  public get listenerCount(): number {
    return Object.values(this.listeners).reduce((count, listeners) => count + listeners.size, 0);
  }

  public get messageListeners(): readonly ((event: MessageEvent<ProducerEvent>) => void)[] {
    return [...this.listeners.message];
  }

  public addEventListener<Kind extends keyof MarketWorkerEventMap>(
    kind: Kind,
    listener: (event: MarketWorkerEventMap[Kind]) => void,
  ): void {
    this.listeners[kind].add(listener);
  }

  public removeEventListener<Kind extends keyof MarketWorkerEventMap>(
    kind: Kind,
    listener: (event: MarketWorkerEventMap[Kind]) => void,
  ): void {
    this.listeners[kind].delete(listener);
  }

  public postMessage(command: ProducerCommand): void {
    if (this.sendError) {
      throw this.sendError;
    }
    this.commands.push(command);
  }

  public emit<Kind extends keyof MarketWorkerEventMap>(
    kind: Kind,
    event: MarketWorkerEventMap[Kind],
  ): void {
    for (const listener of this.listeners[kind]) {
      listener(event);
    }
  }

  public receive(event: ProducerEvent): void {
    this.emit('message', new MessageEvent('message', { data: event }));
  }
}

export function acknowledge(
  worker: ControlledWorker,
  command: ProducerCommand,
  mode: ProducerMode,
  sequence = 0,
): void {
  worker.receive({
    kind: ProducerEventKind.Acknowledged,
    runId: command.runId,
    commandId: command.commandId,
    mode,
    sequence,
  });
}
