import { isSarvamConfigured } from "@/lib/manager/sarvam";

// Sarvam's Speech-to-Text API (https://api.sarvam.ai/speech-to-text):
// multipart/form-data, `api-subscription-key` header, `language_code: "unknown"`
// for auto-detection across its 22+ supported languages (English + major
// Indian languages). Kept beside sarvam.ts (chat model config) rather than in
// it, matching the existing split between raw provider config and the
// structured-generation helper built on top of it.
//
// The API rejects webm/ogg containers (HTTP 400 "Invalid file type") - it
// only accepts a fixed list (wav, mp3, aac, aiff, raw PCM, ...). The
// Composer therefore sends WAV, encoded client-side from raw PCM rather than
// via MediaRecorder's browser-dependent (and unsupported) codec output.

export type TranscribeResult =
  | { ok: true; transcript: string; languageCode: string | null }
  | { ok: false; reason: string };

export async function transcribeAudio(audio: Blob, filename: string): Promise<TranscribeResult> {
  const apiKey = process.env.SARVAM_API_KEY;
  if (!apiKey) {
    return { ok: false, reason: "SARVAM_API_KEY is not set" };
  }

  const form = new FormData();
  form.append("file", audio, filename);
  form.append("model", "saaras:v4");
  form.append("language_code", "unknown");

  try {
    const res = await fetch("https://api.sarvam.ai/speech-to-text", {
      method: "POST",
      headers: { "api-subscription-key": apiKey },
      body: form,
    });
    if (!res.ok) {
      const detail = await res.text().catch(() => "");
      return { ok: false, reason: `Sarvam STT returned HTTP ${res.status}${detail ? `: ${detail.slice(0, 300)}` : ""}` };
    }
    const data = (await res.json()) as { transcript?: string; language_code?: string };
    return { ok: true, transcript: data.transcript ?? "", languageCode: data.language_code ?? null };
  } catch (err) {
    return { ok: false, reason: err instanceof Error ? err.message : "unknown error" };
  }
}

export { isSarvamConfigured as isSpeechToTextConfigured };
