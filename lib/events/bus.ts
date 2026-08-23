import { EventEmitter } from "events";

// Process-wide in-memory event bus feeding the SSE stream. Fine for a
// single-instance hackathon deployment; the Event table is the durable copy.
const globalForBus = globalThis as unknown as { kravenBus?: EventEmitter };

export const eventBus = globalForBus.kravenBus ?? new EventEmitter();
eventBus.setMaxListeners(100);

if (process.env.NODE_ENV !== "production") globalForBus.kravenBus = eventBus;

export interface KravenEvent {
  id: string;
  taskId: string | null;
  actor: string;
  eventType: string;
  payload: unknown;
  createdAt: string;
}

export function publish(event: KravenEvent) {
  eventBus.emit("event", event);
}
