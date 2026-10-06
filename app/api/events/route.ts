import { eventBus, type KravenEvent } from "@/lib/events/bus";

export const dynamic = "force-dynamic";
// Without an explicit ceiling this SSE connection is held open only for the
// platform's default function duration (well under a minute on Vercel), so
// in production the browser's EventSource got cut and reconnected every few
// seconds - the repeated ERR_NETWORK_IO_SUSPENDED/ERR_INTERNET_DISCONNECTED
// failures against /api/events (and /api/tasks/:id while mid-reconnect) seen
// in the console. Match the budget given to the task invocation itself.
export const maxDuration = 800;

// SSE stream - the frontend's single source of truth for live state. It
// never guesses; it renders purely off events emitted here.
export async function GET(request: Request) {
  const encoder = new TextEncoder();

  const stream = new ReadableStream({
    start(controller) {
      const send = (event: KravenEvent) => {
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(event)}\n\n`));
      };

      const listener = (event: KravenEvent) => send(event);
      eventBus.on("event", listener);

      controller.enqueue(encoder.encode(`event: connected\ndata: {}\n\n`));

      const heartbeat = setInterval(() => {
        controller.enqueue(encoder.encode(`: heartbeat\n\n`));
      }, 15000);

      request.signal.addEventListener("abort", () => {
        clearInterval(heartbeat);
        eventBus.off("event", listener);
        controller.close();
      });
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
    },
  });
}
