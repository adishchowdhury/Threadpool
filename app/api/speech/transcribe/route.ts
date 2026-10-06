import { NextResponse } from "next/server";
import { isSpeechToTextConfigured, transcribeAudio } from "@/lib/manager/speechToText";

// Proxies a recorded clip to Sarvam's STT API server-side (the API key never
// reaches the browser) and returns the transcript plus the language Sarvam
// auto-detected. Used by the Composer's mic button in place of the browser's
// built-in (English-only, Chrome-only) SpeechRecognition.
export async function POST(request: Request) {
  if (!isSpeechToTextConfigured()) {
    return NextResponse.json({ error: "Voice input is not configured on this server." }, { status: 503 });
  }

  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return NextResponse.json({ error: "Expected multipart form data." }, { status: 400 });
  }

  const audio = form.get("audio");
  if (!(audio instanceof Blob) || audio.size === 0) {
    return NextResponse.json({ error: "No audio was provided." }, { status: 400 });
  }
  // A generous but bounded cap - this is a short voice note, not a file upload feature.
  if (audio.size > 15 * 1024 * 1024) {
    return NextResponse.json({ error: "Recording is too long." }, { status: 413 });
  }

  const result = await transcribeAudio(audio, "recording.wav");
  if (!result.ok) {
    console.error("[Speech] transcription failed:", result.reason);
    return NextResponse.json({ error: "Couldn't transcribe that recording. Please try again or type your task." }, { status: 502 });
  }

  return NextResponse.json({ transcript: result.transcript, languageCode: result.languageCode });
}
