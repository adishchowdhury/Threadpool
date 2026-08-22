import { EventEmitter } from "events";

// Process-wide in-memory event bus feeding the SSE stream. Fine for a
// single-instance hackathon deployment; the Event table is the durable copy.
const globalForBus = globalThis as unknown as { momentumBus?: EventEmitter };

export const eventBus = globalForBus.momentumBus ?? new EventEmitter();
eventBus.setMaxListeners(100);

if (process.env.NODE_ENV !== "production") globalForBus.momentumBus = eventBus;

export interface MomentumEvent {
  id: string;
  taskId: string | null;
  actor: string;
  eventType: string;
  payload: unknown;
  createdAt: string;
}

export function publish(event: MomentumEvent) {
  eventBus.emit("event", event);
}
