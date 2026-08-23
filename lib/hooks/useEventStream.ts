"use client";

import { useEffect, useRef, useState } from "react";

export interface KravenEvent {
  id: string;
  taskId: string | null;
  actor: string;
  eventType: string;
  payload: unknown;
  createdAt: string;
}

// Connects once to /api/events and keeps a rolling buffer of everything the
// backend has emitted. Consumers filter by taskId themselves — the frontend
// never guesses state, it only renders what the stream said happened.
export function useEventStream(maxEvents = 500) {
  const [events, setEvents] = useState<KravenEvent[]>([]);
  const [connected, setConnected] = useState(false);
  const sourceRef = useRef<EventSource | null>(null);

  useEffect(() => {
    const source = new EventSource("/api/events");
    sourceRef.current = source;

    source.addEventListener("connected", () => setConnected(true));
    source.onmessage = (msg) => {
      try {
        const event = JSON.parse(msg.data) as KravenEvent;
        setEvents((prev) => [...prev.slice(-(maxEvents - 1)), event]);
      } catch {
        // ignore malformed frames
      }
    };
    source.onerror = () => setConnected(false);

    return () => {
      source.close();
    };
  }, [maxEvents]);

  return { events, connected };
}
