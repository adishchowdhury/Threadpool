"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { ArrowUp, Loader2, Mic, Sparkles, Square, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { useAuthUser } from "@/lib/use-auth-user";
import { firebaseConfigured } from "@/lib/firebase";
import { LoginDialog } from "@/components/auth/login-dialog";

const DEMO_PROMPT =
  "Analyze the fintech startup market, identify promising segments, estimate key financial metrics, and produce an investment-style report.";

const BAR_COUNT = 32;

type SpeechRecognitionLike = {
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  onresult: ((event: any) => void) | null;
  onerror: ((event: any) => void) | null;
  onend: (() => void) | null;
  start: () => void;
  stop: () => void;
  abort: () => void;
};

function getSpeechRecognitionCtor(): (new () => SpeechRecognitionLike) | null {
  if (typeof window === "undefined") return null;
  const w = window as any;
  return w.SpeechRecognition || w.webkitSpeechRecognition || null;
}

export function FloatingChatBar({
  onCreated,
  disabled,
  isRunning,
  elapsedSeconds,
  onCancel,
}: {
  onCreated: (taskId: string) => void;
  disabled?: boolean;
  isRunning: boolean;
  elapsedSeconds: number;
  onCancel: () => void;
}) {
  const [prompt, setPrompt] = useState(DEMO_PROMPT);
  const [budget, setBudget] = useState(30);
  const [qualityThreshold, setQualityThreshold] = useState(70);
  const [submitting, setSubmitting] = useState(false);
  const [optimizing, setOptimizing] = useState(false);
  const [optimized, setOptimized] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loginOpen, setLoginOpen] = useState(false);

  const { user, loading: authLoading } = useAuthUser();
  const requiresAuth = firebaseConfigured && !authLoading && !user;

  const [isRecording, setIsRecording] = useState(false);
  const speechSupported = useMemo(() => getSpeechRecognitionCtor() !== null, []);

  const recognitionRef = useRef<SpeechRecognitionLike | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const audioCtxRef = useRef<AudioContext | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const rafRef = useRef<number | null>(null);
  const barRefs = useRef<Array<HTMLSpanElement | null>>([]);
  const finalTranscriptRef = useRef("");
  const basePromptRef = useRef("");

  const isDemo = prompt === DEMO_PROMPT;

  const stopMediaAndAudio = useCallback(() => {
    if (rafRef.current !== null) {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    }
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
    audioCtxRef.current?.close().catch(() => {});
    audioCtxRef.current = null;
    analyserRef.current = null;
    barRefs.current.forEach((bar) => bar?.style.setProperty("--level", "0.08"));
  }, []);

  const stopRecognition = useCallback(() => {
    if (recognitionRef.current) {
      recognitionRef.current.onresult = null;
      recognitionRef.current.onerror = null;
      recognitionRef.current.onend = null;
      try {
        recognitionRef.current.stop();
      } catch {
        // already stopped
      }
      recognitionRef.current = null;
    }
  }, []);

  const teardownRecording = useCallback(() => {
    stopRecognition();
    stopMediaAndAudio();
    setIsRecording(false);
  }, [stopRecognition, stopMediaAndAudio]);

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
    if (disabled || isRunning || submitting) return;
    setError(null);
    basePromptRef.current = isDemo ? "" : prompt;
    finalTranscriptRef.current = "";

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
    } catch {
      setError("Microphone access was denied.");
      return;
    }

    const Ctor = getSpeechRecognitionCtor();
    if (Ctor) {
      const recognition = new Ctor();
      recognition.continuous = true;
      recognition.interimResults = true;
      recognition.lang = "en-US";
      recognition.onresult = (event: any) => {
        let interim = "";
        for (let i = event.resultIndex; i < event.results.length; i++) {
          const result = event.results[i];
          if (result.isFinal) {
            finalTranscriptRef.current += result[0].transcript;
          } else {
            interim += result[0].transcript;
          }
        }
        const combined = `${finalTranscriptRef.current}${interim}`.trim();
        setPrompt([basePromptRef.current, combined].filter(Boolean).join(" ").trim());
      };
      recognition.onerror = () => {
        // keep recording UI open; user can still stop manually
      };
      recognition.onend = () => {
        recognitionRef.current = null;
      };
      recognitionRef.current = recognition;
      try {
        recognition.start();
      } catch {
        recognitionRef.current = null;
      }
    }

    setIsRecording(true);
  }

  function cancelRecording() {
    setPrompt(basePromptRef.current);
    teardownRecording();
  }

  function finishRecording() {
    teardownRecording();
  }

  async function finishAndSubmit() {
    teardownRecording();
    if (!prompt.trim()) return;
    await submit();
  }

  useEffect(() => () => teardownRecording(), [teardownRecording]);

  async function optimizePrompt() {
    if (!prompt.trim() || optimizing) return;
    setOptimizing(true);
    setError(null);
    try {
      const res = await fetch("/api/prompt-optimizer", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ prompt }),
      });
      const data = await res.json();
      const objective = data?.optimizedTask?.objective;
      if (!res.ok || typeof objective !== "string" || !objective.trim()) {
        setError(typeof data.error === "string" ? data.error : "Couldn't optimize the prompt.");
        return;
      }
      setPrompt(objective);
      setOptimized(true);
    } catch {
      setError("Couldn't reach the server. Check your connection and try again.");
    } finally {
      setOptimizing(false);
    }
  }

  async function submit(optMode: "A" | "B" = "A", skipAuthCheck = false) {
    if (!prompt.trim()) return;
    if (!skipAuthCheck && requiresAuth) {
      setLoginOpen(true);
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch("/api/tasks", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ prompt, budget, qualityThreshold, optimizationMode: optMode }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(typeof data.error === "string" ? data.error : "Couldn't start the task.");
        return;
      }
      onCreated(data.task.id);
    } catch {
      setError("Couldn't reach the server. Check your connection and try again.");
    } finally {
      setSubmitting(false);
    }
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      if (disabled || submitting || optimizing || !prompt.trim()) return;
      if (e.ctrlKey || e.metaKey) {
        submit("A");
        return;
      }
      if (optimized) submit("A");
      else optimizePrompt();
    }
  }

  return (
    <>
    <LoginDialog open={loginOpen} onOpenChange={setLoginOpen} onSuccess={() => submit("A", true)} />
    <div className="pointer-events-none absolute inset-x-0 bottom-0 z-30 flex flex-col items-center gap-2 px-4 pb-5">
      <div className="pointer-events-auto w-full max-w-2xl">
        {error && (
          <div className="animate-in fade-in slide-in-from-bottom-1 mb-2 rounded-md border border-destructive/40 bg-destructive/10 px-3 py-1.5 text-xs text-destructive duration-200">
            {error}
          </div>
        )}

        {isRecording ? (
          <div className="flex items-center gap-2 rounded-full border border-panel-border bg-panel px-3 py-2 shadow-2xl backdrop-blur-xl">
            <Button
              type="button"
              size="icon"
              onClick={cancelRecording}
              className="size-8 shrink-0 rounded-full bg-panel-elevated text-panel-muted transition-transform hover:text-panel-foreground active:scale-90"
              aria-label="Cancel recording"
            >
              <X className="size-4" />
            </Button>

            <div className="flex h-8 flex-1 items-center justify-center gap-[3px] overflow-hidden">
              {Array.from({ length: BAR_COUNT }).map((_, i) => (
                <span
                  key={i}
                  ref={(el) => {
                    barRefs.current[i] = el;
                  }}
                  style={{ ["--level" as string]: "0.08" }}
                  className="voice-bar inline-block w-[3px] shrink-0 rounded-full bg-accent-strong"
                />
              ))}
            </div>

            <span className="hidden shrink-0 font-mono text-[11px] text-panel-muted sm:inline">
              {speechSupported ? "listening" : "recording"}
            </span>

            <Button
              type="button"
              size="icon"
              onClick={finishRecording}
              className="size-8 shrink-0 rounded-full bg-panel-elevated text-panel-foreground transition-transform hover:opacity-90 active:scale-90"
              aria-label="Stop recording"
            >
              <Square className="size-3.5 fill-current" />
            </Button>

            <Button
              type="button"
              size="icon"
              onClick={finishAndSubmit}
              disabled={!prompt.trim()}
              className="size-8 shrink-0 rounded-full bg-accent-strong text-accent-strong-foreground transition-transform hover:opacity-90 active:scale-90 disabled:opacity-40"
              aria-label="Send"
            >
              <ArrowUp className="size-4" />
            </Button>
          </div>
        ) : (
          <div
            className={cn(
              "rounded-2xl border border-panel-border bg-panel p-3 shadow-2xl backdrop-blur-xl transition-opacity duration-300",
              disabled && "opacity-70",
            )}
          >
            <Textarea
              value={prompt}
              onChange={(e) => {
                setPrompt(e.target.value);
                setOptimized(false);
              }}
              onKeyDown={handleKeyDown}
              rows={2}
              disabled={disabled || optimizing}
              placeholder="Describe the task for the AI workforce..."
              className="max-h-32 min-h-14 resize-none border-none bg-transparent px-3 py-3 text-[15px] text-panel-foreground shadow-none placeholder:text-panel-muted focus-visible:ring-0 disabled:cursor-not-allowed disabled:opacity-100"
            />

            <div className="mt-1 flex flex-wrap items-center justify-between gap-2">
              <div className="flex items-center gap-1.5">
                <div className="flex items-center gap-0.5 rounded-full bg-panel-elevated p-0.5 text-[11px]">
                  <button
                    type="button"
                    onClick={() => {
                      setPrompt(DEMO_PROMPT);
                      setOptimized(false);
                    }}
                    disabled={disabled}
                    className={cn(
                      "rounded-full px-2.5 py-1 font-medium transition-colors",
                      isDemo ? "bg-accent-strong text-accent-strong-foreground" : "text-panel-muted hover:text-panel-foreground",
                    )}
                  >
                    Demo
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setPrompt((p) => (p === DEMO_PROMPT ? "" : p));
                      setOptimized(false);
                    }}
                    disabled={disabled}
                    className={cn(
                      "rounded-full px-2.5 py-1 font-medium transition-colors",
                      !isDemo ? "bg-accent-strong text-accent-strong-foreground" : "text-panel-muted hover:text-panel-foreground",
                    )}
                  >
                    Custom
                  </button>
                </div>
              </div>

              <div className="flex items-center gap-2">
                <div className="flex items-center gap-1.5 rounded-full bg-panel-elevated px-2.5 py-1 text-[11px] text-panel-muted">
                  <label className="flex items-center gap-1">
                    <span className="hidden sm:inline">Budget</span>
                    <input
                      type="number"
                      min={1}
                      value={budget}
                      disabled={disabled}
                      onChange={(e) => setBudget(Number(e.target.value))}
                      className="w-9 bg-transparent text-right font-mono text-panel-foreground outline-none [appearance:textfield] disabled:opacity-60 [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
                    />
                  </label>
                  <span className="text-panel-border">·</span>
                  <label className="flex items-center gap-1">
                    <span className="hidden sm:inline">Quality</span>
                    <input
                      type="number"
                      min={0}
                      max={100}
                      value={qualityThreshold}
                      disabled={disabled}
                      onChange={(e) => setQualityThreshold(Number(e.target.value))}
                      className="w-8 bg-transparent text-right font-mono text-panel-foreground outline-none [appearance:textfield] disabled:opacity-60 [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
                    />
                  </label>
                </div>

                {isRunning ? (
                  <Button
                    size="icon"
                    onClick={onCancel}
                    className="size-8 shrink-0 rounded-full bg-destructive/15 text-destructive transition-transform hover:bg-destructive/25 active:scale-90"
                    aria-label="Cancel task"
                  >
                    <X className="size-4" />
                  </Button>
                ) : !prompt.trim() ? (
                  <Button
                    size="icon"
                    onClick={startRecording}
                    disabled={disabled || submitting}
                    className="size-8 shrink-0 rounded-full bg-accent-strong text-accent-strong-foreground transition-transform hover:opacity-90 active:scale-90"
                    aria-label="Start voice input"
                  >
                    <Mic className="size-4" />
                  </Button>
                ) : optimized ? (
                  <Button
                    type="button"
                    onClick={() => submit("A")}
                    disabled={disabled || submitting || !prompt.trim()}
                    className="size-8 shrink-0 rounded-full bg-accent-strong text-accent-strong-foreground transition-transform hover:opacity-90 active:scale-90 disabled:opacity-40"
                    aria-label="Send"
                  >
                    {submitting ? <Loader2 className="size-3.5 animate-spin" /> : <ArrowUp className="size-4" />}
                  </Button>
                ) : (
                  <div className="flex items-center gap-1.5">
                    <button
                      type="button"
                      onClick={() => submit("A")}
                      disabled={disabled || optimizing || submitting || !prompt.trim()}
                      title="Send the prompt as-is, skipping optimization"
                      className="rounded-full px-2.5 h-8 shrink-0 text-[11px] font-medium text-panel-muted hover:text-panel-foreground hover:bg-panel-elevated transition-colors disabled:opacity-40"
                    >
                      {submitting ? "Sending…" : "Run unoptimized"}
                    </button>
                    <Button
                      type="button"
                      onClick={optimizePrompt}
                      disabled={disabled || optimizing || submitting || !prompt.trim()}
                      className="gap-1.5 px-3 h-8 shrink-0 rounded-full bg-accent-strong text-accent-strong-foreground text-xs font-semibold hover:opacity-90 transition-all active:scale-95 disabled:opacity-40"
                    >
                      {optimizing ? (
                        <Loader2 className="size-3.5 animate-spin" />
                      ) : (
                        <>
                          <Sparkles className="size-3.5" />
                          Optimize Prompt
                        </>
                      )}
                    </Button>
                  </div>
                )}
              </div>
            </div>
          </div>
        )}

        {isRunning && (
          <div className="relative mt-2.5 h-4 text-center text-[11px]">
            <div key="running" className="animate-in fade-in flex items-center justify-center gap-2 text-panel-muted duration-300">
              <span className="relative h-1 w-28 overflow-hidden rounded-full bg-panel-elevated">
                <span className="absolute inset-y-0 left-0 w-1/3 animate-pulse rounded-full bg-accent-strong" />
              </span>
              <span className="font-mono">{elapsedSeconds}s</span>
              <span>workforce running</span>
            </div>
          </div>
        )}
      </div>
    </div>
    </>
  );
}
