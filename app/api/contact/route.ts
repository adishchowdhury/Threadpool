import { NextResponse } from "next/server";
import { z } from "zod";

const contactSchema = z.object({
  name: z.string().trim().min(1, "Name is required").max(200),
  email: z.string().trim().email("Enter a valid email address").max(320),
  message: z.string().trim().min(10, "Message is too short").max(5000),
});

export async function POST(request: Request) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  }

  const parsed = contactSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "Invalid input" },
      { status: 400 },
    );
  }

  const apiKey = process.env.FORMAS_API_KEY;
  if (!apiKey) {
    console.error("[contact] FORMAS_API_KEY is not configured");
    return NextResponse.json(
      { error: "Could not deliver your message right now. Please email us directly." },
      { status: 503 },
    );
  }

  try {
    const res = await fetch(`https://www.formas.space/api/submit/${apiKey}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(parsed.data),
    });

    if (!res.ok) {
      console.error("[contact] Formas submission failed", res.status, await res.text());
      return NextResponse.json(
        { error: "Could not deliver your message right now. Please email us directly." },
        { status: 503 },
      );
    }

    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("[contact] failed to submit to Formas", err);
    return NextResponse.json(
      { error: "Could not deliver your message right now. Please email us directly." },
      { status: 503 },
    );
  }
}
