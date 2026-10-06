import { eventBus, type KravenEvent } from "@/lib/events/bus";

export const dynamic = "force-dynamic";

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
