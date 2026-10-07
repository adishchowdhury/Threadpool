"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { ArrowUp, Info, Loader2, Mic, Square, X } from "lucide-react";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import { useAuthUser } from "@/lib/use-auth-user";
import { firebaseConfigured } from "@/lib/firebase";
import { LoginDialog } from "@/components/auth/login-dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ApprovedAgentsPicker } from "@/components/dashboard/ApprovedAgentsPicker";
import { authHeader } from "@/lib/auth/clientAuth";
import { tokenRateLabel, tokensWorthLabel } from "@/lib/economy/tokenValue";

const DATA_LABELS = { PUBLIC: "Public", INTERNAL: "Internal", SENSITIVE: "Sensitive" } as const;
const BAR_COUNT = 32;

// Sarvam's speech-to-text endpoint rejects the webm/opus container
// MediaRecorder produces by default (HTTP 400: "Invalid file type") - it
// only accepts a short list including plain WAV. Rather than depend on a
// browser-specific MediaRecorder codec, capture raw PCM straight from the
// Web Audio graph (the same graph already used for the waveform) and encode
// it as a 16-bit PCM WAV ourselves; that format Sarvam accepts everywhere.
function pcmToWavBlob(samples: Float32Array, sampleRate: number): Blob {
  const buffer = new ArrayBuffer(44 + samples.length * 2);
  const view = new DataView(buffer);
  const writeStr = (offset: number, s: string) => {
    for (let i = 0; i < s.length; i++) view.setUint8(offset + i, s.charCodeAt(i));
  };
  writeStr(0, "RIFF");
  view.setUint32(4, 36 + samples.length * 2, true);
  writeStr(8, "WAVE");
  writeStr(12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true); // PCM
  view.setUint16(22, 1, true); // mono
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true); // byte rate (mono, 16-bit)
  view.setUint16(32, 2, true); // block align
  view.setUint16(34, 16, true); // bits per sample
  writeStr(36, "data");
  view.setUint32(40, samples.length * 2, true);
  let offset = 44;
  for (let i = 0; i < samples.length; i++, offset += 2) {
    const s = Math.max(-1, Math.min(1, samples[i]));
    view.setInt16(offset, s < 0 ? s * 0x8000 : s * 0x7fff, true);
  }
  return new Blob([buffer], { type: "audio/wav" });
}

// The task composer: one prompt box with the two numbers that govern a run
// (budget and quality bar) and voice input.
export function Composer({
  onCreated,
  isRunning,
  onCancel,
  budget,
  onBudgetChange,
  qualityThreshold,
  onQualityThresholdChange,
  prefill,
  autoFocus,
}: {
  onCreated: (taskId: string) => void;
  isRunning: boolean;
  onCancel: () => void;
  // Owned by the parent so the chosen budget survives the move from the
  // empty-state composer to the one docked under a conversation.
  budget: number;
  onBudgetChange: (value: number) => void;
  qualityThreshold: number;
  onQualityThresholdChange: (value: number) => void;
  // Setting a new `nonce` replaces the box contents (used by example prompts).
  prefill?: { text: string; nonce: number } | null;
  autoFocus?: boolean;
}) {
  const [prompt, setPrompt] = useState("");
  const [dataSensitivity, setDataSensitivity] = useState<"PUBLIC" | "INTERNAL" | "SENSITIVE">("PUBLIC");
  const [approvedAgentIds, setApprovedAgentIds] = useState<string[]>([]);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loginOpen, setLoginOpen] = useState(false);

  const { user, loading: authLoading } = useAuthUser();
  const requiresAuth = firebaseConfigured && !authLoading && !user;

  const [isRecording, setIsRecording] = useState(false);
  const [isTranscribing, setIsTranscribing] = useState(false);
  const recordingSupported = useMemo(() => typeof navigator !== "undefined" && !!navigator.mediaDevices?.getUserMedia, []);

  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const audioCtxRef = useRef<AudioContext | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const processorRef = useRef<ScriptProcessorNode | null>(null);
  const silentGainRef = useRef<GainNode | null>(null);
  const pcmChunksRef = useRef<Float32Array[]>([]);
  const rafRef = useRef<number | null>(null);
  const barRefs = useRef<Array<HTMLSpanElement | null>>([]);
  const basePromptRef = useRef("");

  // An example prompt replaces the box contents once per `nonce`. Derived
  // during render (not in an effect) so it applies in the same pass.
  const [appliedNonce, setAppliedNonce] = useState<number | null>(null);
  if (prefill && prefill.nonce !== appliedNonce) {
    setAppliedNonce(prefill.nonce);
    setPrompt(prefill.text);
    setError(null);
  }
  useEffect(() => {
    if (prefill) textareaRef.current?.focus();
  }, [prefill]);

  useEffect(() => {
    if (autoFocus) textareaRef.current?.focus();
  }, [autoFocus]);

  const stopMediaAndAudio = useCallback(() => {
    if (rafRef.current !== null) {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    }
    processorRef.current?.disconnect();
    processorRef.current = null;
    silentGainRef.current?.disconnect();
    silentGainRef.current = null;
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
    audioCtxRef.current?.close().catch(() => {});
    audioCtxRef.current = null;
    analyserRef.current = null;
    pcmChunksRef.current = [];
    barRefs.current.forEach((bar) => bar?.style.setProperty("--level", "0.08"));
  }, []);

  const teardownRecording = useCallback(() => {
    stopMediaAndAudio();
    setIsRecording(false);
    setIsTranscribing(false);
  }, [stopMediaAndAudio]);

  const runLevelLoop = useCallback(() => {
    const analyser = analyserRef.current;
    if (!analyser) return;
    const data = new Uint8Array(analyser.frequencyBinCount);
    const tick = () => {
      analyser.getByteFrequencyData(data);
      let sum = 0;
      for (let i = 0; i < data.length; i++) sum += data[i];
      const avg = sum / data.length / 255;
      barRefs.current.forEach((bar, i) => {
        if (!bar) return;
        const wobble = Math.sin(Date.now() / 120 + i) * 0.15;
        const level = Math.min(1, Math.max(0.08, avg * 1.8 + wobble * avg));
        bar.style.setProperty("--level", level.toFixed(3));
      });
      rafRef.current = requestAnimationFrame(tick);
    };
    tick();
  }, []);

  async function startRecording() {
    if (isRunning || submitting) return;
    setError(null);
    basePromptRef.current = prompt;
    pcmChunksRef.current = [];

    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;
      const AudioCtx = window.AudioContext || (window as any).webkitAudioContext;
      const audioCtx: AudioContext = new AudioCtx();
      audioCtxRef.current = audioCtx;
      const source = audioCtx.createMediaStreamSource(stream);

      const analyser = audioCtx.createAnalyser();
      analyser.fftSize = 128;
      source.connect(analyser);
      analyserRef.current = analyser;
      runLevelLoop();

      // ScriptProcessorNode is deprecated but universally supported and
      // simple - no separate worklet module to load for a hackathon feature.
      // It must be connected through to the destination (via a silenced
      // gain node, so nothing is actually audible) or some browsers never
      // fire onaudioprocess.
      const processor = audioCtx.createScriptProcessor(4096, 1, 1);
      const silentGain = audioCtx.createGain();
      silentGain.gain.value = 0;
      source.connect(processor);
      processor.connect(silentGain);
      silentGain.connect(audioCtx.destination);
      processor.onaudioprocess = (e) => {
        pcmChunksRef.current.push(new Float32Array(e.inputBuffer.getChannelData(0)));
      };
      processorRef.current = processor;
      silentGainRef.current = silentGain;
    } catch {
      setError("Microphone access was denied.");
      stopMediaAndAudio();
      return;
    }

    setIsRecording(true);
  }

  // Stops recording, encodes the captured PCM as WAV, sends it to Sarvam's
  // speech-to-text (multilingual, auto-detects the spoken language), and
  // returns the transcript merged with whatever was already typed before
  // recording started. Tears down the mic stream/visualizer regardless of
  // outcome.
  async function stopAndTranscribe(): Promise<string> {
    setIsTranscribing(true);
    const sampleRate = audioCtxRef.current?.sampleRate ?? 48000;
    const chunks = pcmChunksRef.current;
    stopMediaAndAudio();

    let transcript = "";
    const totalLength = chunks.reduce((n, c) => n + c.length, 0);
    if (totalLength > 0) {
      const merged = new Float32Array(totalLength);
      let offset = 0;
      for (const chunk of chunks) {
        merged.set(chunk, offset);
        offset += chunk.length;
      }
      const blob = pcmToWavBlob(merged, sampleRate);

      try {
        const form = new FormData();
        form.append("audio", blob, "recording.wav");
        const res = await fetch("/api/speech/transcribe", { method: "POST", body: form });
        const data = await res.json();
        if (!res.ok) {
          setError(typeof data.error === "string" ? data.error : "Couldn't transcribe your recording.");
        } else if (typeof data.transcript === "string") {
          transcript = data.transcript;
        }
      } catch {
        setError("Couldn't reach the server to transcribe your recording.");
      }
    }

    setIsTranscribing(false);
    return [basePromptRef.current, transcript].filter((s) => s.trim()).join(" ").trim();
  }

  function cancelRecording() {
    setPrompt(basePromptRef.current);
    teardownRecording();
  }

  async function stopAndKeep() {
    const combined = await stopAndTranscribe();
    setPrompt(combined);
    setIsRecording(false);
  }

  async function stopAndSubmit() {
    const combined = await stopAndTranscribe();
    setPrompt(combined);
    setIsRecording(false);
    if (combined.trim()) await submit(false, combined);
  }

  useEffect(() => () => teardownRecording(), [teardownRecording]);

  async function submit(skipAuthCheck = false, overridePrompt?: string) {
    const text = overridePrompt ?? prompt;
    if (!text.trim() || submitting || isRunning) return;
    if (!skipAuthCheck && requiresAuth) {
      setLoginOpen(true);
      return;
    }
    if (!Number.isFinite(budget) || budget < 1) {
      setError("Set a budget of at least 1 token.");
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch("/api/tasks", {
        method: "POST",
        headers: { "Content-Type": "application/json", ...(await authHeader()) },
        body: JSON.stringify({ prompt: text, budget, qualityThreshold, dataSensitivity, approvedAgentIds: dataSensitivity === "PUBLIC" ? [] : approvedAgentIds }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(typeof data.error === "string" ? data.error : "Couldn't start the task.");
        return;
      }
      setPrompt("");
      onCreated(data.task.id);
    } catch {
      setError("Couldn't reach the server. Check your connection and try again.");
    } finally {
      setSubmitting(false);
    }
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault();
      void submit();
    }
  }

  const canSend = prompt.trim().length > 0 && !submitting && !isRunning;

  return (
    <>
      <LoginDialog open={loginOpen} onOpenChange={setLoginOpen} onSuccess={() => submit(true)} />

      {error && (
        <div
          role="alert"
          className="animate-in fade-in mb-2 rounded-xl border border-destructive/30 bg-destructive/10 px-3.5 py-2 text-sm text-destructive duration-200"
        >
          {error}
        </div>
      )}

      {isRecording ? (
        <div className="animate-in fade-in zoom-in-95 flex items-center gap-2 rounded-3xl border border-border bg-card px-3 py-2.5 shadow-sm duration-200 ease-out">
          <Button
            type="button"
            size="icon"
            variant="ghost"
            onClick={cancelRecording}
            disabled={isTranscribing}
            className="size-9 shrink-0 rounded-full"
            aria-label="Cancel recording"
          >
            <X className="size-4" />
          </Button>

          <div className="flex h-9 flex-1 items-center justify-center gap-0.75 overflow-hidden" aria-hidden>
            {isTranscribing ? (
              <Loader2 className="size-4 animate-spin text-muted-foreground" />
            ) : (
              Array.from({ length: BAR_COUNT }).map((_, i) => (
                <span
                  key={i}
                  ref={(el) => {
                    barRefs.current[i] = el;
                  }}
                  style={{ ["--level" as string]: "0.08" }}
                  className="voice-bar inline-block w-0.75 shrink-0 rounded-full bg-foreground"
                />
              ))
            )}
          </div>

          <span className="hidden shrink-0 text-xs text-muted-foreground sm:inline">
            {isTranscribing ? "Transcribing…" : "Listening… (any language)"}
          </span>

          <Button
            type="button"
            size="icon"
            variant="ghost"
            onClick={stopAndKeep}
            disabled={isTranscribing}
            className="size-9 shrink-0 rounded-full"
            aria-label="Stop recording"
          >
            <Square className="size-3.5 fill-current" />
          </Button>

          <Button
            type="button"
            size="icon"
            onClick={stopAndSubmit}
            disabled={isTranscribing}
            className="size-9 shrink-0 rounded-full"
            aria-label="Send"
          >
            <ArrowUp className="size-4" />
          </Button>
        </div>
      ) : (
        <div
          className={cn(
            "animate-in fade-in zoom-in-95 rounded-3xl border border-border bg-card shadow-sm transition-shadow duration-200 ease-out focus-within:shadow-md",
            isRunning && "opacity-80",
          )}
        >
          <Textarea
            ref={textareaRef}
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            onKeyDown={handleKeyDown}
            rows={1}
            disabled={isRunning}
            aria-label="Describe the task"
            placeholder={isRunning ? "Your workforce is working…" : "Describe what you want done - Kraven will assemble the team"}
            className="max-h-52 min-h-13 resize-none rounded-3xl border-none bg-transparent px-5 pb-1 pt-4 text-[15px] leading-relaxed shadow-none placeholder:text-muted-foreground focus-visible:ring-0 disabled:cursor-not-allowed disabled:bg-transparent disabled:opacity-100 dark:bg-transparent"
          />

          <div className="flex flex-wrap items-center gap-2 px-3 pb-3 pt-1">
            <div className="flex items-center gap-1 rounded-full bg-muted px-3 py-1.5 text-xs text-muted-foreground">
              <label className="flex items-center gap-1.5">
                <span>Budget</span>
                <input
                  type="number"
                  min={1}
                  value={Number.isFinite(budget) ? budget : ""}
                  disabled={isRunning}
                  onChange={(e) => onBudgetChange(Number(e.target.value))}
                  aria-label="Budget in tokens"
                  className="w-10 bg-transparent text-right font-mono text-sm text-foreground outline-none [appearance:textfield] disabled:opacity-60 [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
                />
                <span className="hidden whitespace-nowrap sm:inline">({tokensWorthLabel(Math.max(budget || 0, 0))})</span>
              </label>
              <span className="mx-1.5 h-3.5 w-px bg-border" aria-hidden />
              <label className="flex items-center gap-1.5">
                <span>Quality bar</span>
                <input
                  type="number"
                  min={0}
                  max={100}
                  value={Number.isFinite(qualityThreshold) ? qualityThreshold : ""}
                  disabled={isRunning}
                  onChange={(e) => onQualityThresholdChange(Number(e.target.value))}
                  aria-label="Minimum quality score"
                  className="w-8 bg-transparent text-right font-mono text-sm text-foreground outline-none [appearance:textfield] disabled:opacity-60 [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
                />
              </label>
              <span className="mx-1.5 h-3.5 w-px bg-border" aria-hidden />
              <div className="flex items-center gap-1.5">
                <span>Data</span>
                <Select value={dataSensitivity} onValueChange={(v) => v && setDataSensitivity(v as typeof dataSensitivity)} disabled={isRunning}>
                  <SelectTrigger
                    aria-label="Data sensitivity"
                    className="h-auto w-auto gap-1 border-0 bg-transparent p-0 text-sm text-foreground shadow-none focus-visible:ring-0 dark:bg-transparent dark:hover:bg-transparent"
                  >
                    <SelectValue>{DATA_LABELS[dataSensitivity]}</SelectValue>
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="PUBLIC">Public</SelectItem>
                    <SelectItem value="INTERNAL">Internal</SelectItem>
                    <SelectItem value="SENSITIVE">Sensitive</SelectItem>
                  </SelectContent>
                </Select>
                {dataSensitivity !== "PUBLIC" && (
                  <button
                    type="button"
                    disabled={isRunning}
                    onClick={() => setPickerOpen(true)}
                    className="rounded-full border border-border px-2 py-0.5 text-[11px] text-foreground transition-colors hover:bg-background disabled:opacity-60"
                    title="Choose marketplace or certified agents that may also receive this task's data"
                  >
                    {approvedAgentIds.length > 0 ? `+ ${approvedAgentIds.length} allowed` : "+ Allow agents"}
                  </button>
                )}
              </div>
              {dataSensitivity !== "PUBLIC" && (
                <ApprovedAgentsPicker
                  open={pickerOpen}
                  onOpenChange={setPickerOpen}
                  level={dataSensitivity}
                  selected={approvedAgentIds}
                  onChange={setApprovedAgentIds}
                />
              )}
              <TooltipProvider delay={100}>
                <Tooltip>
                  <TooltipTrigger
                    type="button"
                    aria-label="What are Budget, Quality bar and Data?"
                    className="ml-0.5 flex size-5 shrink-0 items-center justify-center rounded-full text-muted-foreground transition-colors hover:text-foreground focus-visible:text-foreground focus-visible:outline-none"
                  >
                    <Info className="size-3.5" />
                  </TooltipTrigger>
                  <TooltipContent side="top" className="max-w-64 flex-col items-start gap-2 py-2 text-[11px] leading-snug">
                    <p>
                      <strong>Budget</strong> - the most this task can spend, in tokens. Agents are paid from it and nothing beyond it is ever
                      spent. {tokenRateLabel()}.
                    </p>
                    <p>
                      <strong>Quality bar</strong> - the minimum score (0–100) the work must reach. Work scoring lower isn&apos;t paid and is
                      retried or reassigned. Higher is stricter and can cost more; 70 is a good starting point.
                    </p>
                    <p>
                      <strong>Data</strong> - how sensitive your task data is. <em>Public</em>: any agent you can see. <em>Internal</em>: Kraven
                      Certified and your own agents only. <em>Sensitive</em>: only your organization&apos;s private agents. Use <em>Allow agents</em> to also let specific agents you trust receive the data.
                    </p>
                  </TooltipContent>
                </Tooltip>
              </TooltipProvider>
            </div>

            <div className="ml-auto flex items-center gap-1.5">
              {isRunning ? (
                <Button
                  type="button"
                  size="icon"
                  onClick={onCancel}
                  className="size-9 shrink-0 rounded-full"
                  aria-label="Stop task"
                  title="Stop task"
                >
                  <Square className="size-3.5 fill-current" />
                </Button>
              ) : prompt.trim() ? (
                <Button
                  type="button"
                  size="icon"
                  onClick={() => submit()}
                  disabled={!canSend}
                  className="size-9 shrink-0 rounded-full"
                  aria-label="Start task"
                  title="Start task"
                >
                  {submitting ? <Loader2 className="size-4 animate-spin" /> : <ArrowUp className="size-4" />}
                </Button>
              ) : (
                <Button
                  type="button"
                  size="icon"
                  variant="ghost"
                  onClick={startRecording}
                  disabled={submitting || !recordingSupported}
                  className="size-9 shrink-0 rounded-full text-muted-foreground hover:text-foreground"
                  aria-label="Start voice input"
                  title={recordingSupported ? "Voice input (any language)" : "Voice input needs microphone access"}
                >
                  <Mic className="size-4" />
                </Button>
              )}
            </div>
          </div>
        </div>
      )}
    </>
  );
}
