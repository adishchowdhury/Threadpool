"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { signInWithPopup } from "firebase/auth";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { GoogleIcon } from "@/components/landing/google-icon";
import OrbitField, { type OrbitItem } from "@/components/landing/orbit-field";
import { auth, googleProvider, firebaseConfigured } from "@/lib/firebase";
import { useAuthUser } from "@/lib/use-auth-user";

const SIMPLE_ICONS_CDN = "https://cdn.jsdelivr.net/npm/simple-icons@latest/icons";

const OUTER_ORBIT_ITEMS: OrbitItem[] = [
  { type: "logo", src: `${SIMPLE_ICONS_CDN}/openai.svg`, label: "OpenAI", color: "#10A37F" },
  { type: "logo", src: `${SIMPLE_ICONS_CDN}/anthropic.svg`, label: "Anthropic", color: "#D97757" },
  { type: "logo", src: `${SIMPLE_ICONS_CDN}/googlegemini.svg`, label: "Gemini", color: "#4285F4" },
  { type: "logo", src: `${SIMPLE_ICONS_CDN}/meta.svg`, label: "Meta AI", color: "#0866FF" },
  { type: "logo", src: `${SIMPLE_ICONS_CDN}/mistralai.svg`, label: "Mistral AI", color: "#FA520F" },
  { type: "logo", src: `${SIMPLE_ICONS_CDN}/perplexity.svg`, label: "Perplexity", color: "#20808D" },
];

const INNER_ORBIT_ITEMS: OrbitItem[] = [
  { type: "logo", src: `${SIMPLE_ICONS_CDN}/huggingface.svg`, label: "Hugging Face", color: "#FFD21E" },
  { type: "logo", src: `${SIMPLE_ICONS_CDN}/deepmind.svg`, label: "DeepMind", color: "#886FBF" },
  { type: "logo", src: `${SIMPLE_ICONS_CDN}/ollama.svg`, label: "Ollama", color: "#3DDC97" },
  { type: "logo", src: `${SIMPLE_ICONS_CDN}/githubcopilot.svg`, label: "GitHub Copilot", color: "#6E40C9" },
];

const CURSOR_SVG = encodeURIComponent(
  `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="white" stroke="black" stroke-width="1" stroke-linecap="round" stroke-linejoin="round"><path d="M4.037 4.688a.495.495 0 0 1 .651-.651l16 6.5a.5.5 0 0 1-.063.947l-6.124 1.58a2 2 0 0 0-1.438 1.435l-1.579 6.126a.5.5 0 0 1-.947.063z"/></svg>`,
);

const CURSOR_STYLE = {
  cursor: `url("data:image/svg+xml,${CURSOR_SVG}") 2 2, auto`,
} as const;

const COLUMN_WIDTH = 168;
const ROW_HEIGHT = 168;

const DASH_COLUMN_SVG = encodeURIComponent(
  `<svg xmlns="http://www.w3.org/2000/svg" width="${COLUMN_WIDTH}" height="20"><line x1="0.5" y1="0" x2="0.5" y2="20" stroke="white" stroke-opacity="0.14" stroke-width="1" stroke-dasharray="3 5"/></svg>`,
);
const DASH_ROW_SVG = encodeURIComponent(
  `<svg xmlns="http://www.w3.org/2000/svg" width="20" height="${ROW_HEIGHT}"><line x1="0" y1="0.5" x2="20" y2="0.5" stroke="white" stroke-opacity="0.14" stroke-width="1" stroke-dasharray="3 5"/></svg>`,
);

const GRID_BACKGROUND = {
  backgroundImage: `url("data:image/svg+xml,${DASH_COLUMN_SVG}"), url("data:image/svg+xml,${DASH_ROW_SVG}")`,
  backgroundRepeat: "repeat, repeat",
  backgroundSize: `${COLUMN_WIDTH}px 20px, 20px ${ROW_HEIGHT}px`,
} as const;

type Stage = 0 | 1 | 2 | 3;

export default function AgentHero() {
  const router = useRouter();
  const { user, loading } = useAuthUser();
  const [stage, setStage] = useState<Stage>(0);
  const [signingIn, setSigningIn] = useState(false);
  const [authError, setAuthError] = useState<string | null>(null);

  useEffect(() => {
    const timers = [
      setTimeout(() => setStage(1), 150),
      setTimeout(() => setStage(2), 500),
      setTimeout(() => setStage(3), 850),
    ];
    return () => timers.forEach(clearTimeout);
  }, []);

  useEffect(() => {
    if (!loading && user) {
      router.replace("/dashboard");
    }
  }, [loading, user, router]);

  const handleGoogleSignIn = async () => {
    if (!firebaseConfigured) {
      setAuthError("Firebase isn't configured yet — add NEXT_PUBLIC_FIREBASE_* env vars.");
      return;
    }
    setAuthError(null);
    setSigningIn(true);
    try {
      await signInWithPopup(auth, googleProvider);
      router.replace("/dashboard");
    } catch {
      setAuthError("Sign-in failed. Please try again.");
    } finally {
      setSigningIn(false);
    }
  };

  return (
    <main
      style={CURSOR_STYLE}
      className="relative flex h-screen w-full flex-col overflow-hidden bg-black text-white"
    >
      {/* full-bleed dashed column + row ruler */}
      <div
        className="pointer-events-none absolute inset-0 z-0"
        style={GRID_BACKGROUND}
      />

      {/* content row */}
      <div className="relative z-10 flex flex-1 flex-col items-center justify-center overflow-hidden px-8 py-10">
        <OrbitField
          outerItems={OUTER_ORBIT_ITEMS}
          innerItems={INNER_ORBIT_ITEMS}
        />

        {/* text panel */}
        <div className="relative flex w-full max-w-xl flex-col items-center gap-7 text-center">
          <div className="relative flex flex-col items-center gap-6 text-center">
            <h1
              className={`font-serif text-6xl leading-[0.95] tracking-tight transition-all duration-500 ease-out lg:text-8xl ${
                stage >= 1 ? "blur-none opacity-100" : "blur-md opacity-0"
              }`}
            >
              <span className="italic">ASME</span>
            </h1>

            <p
              className={`max-w-sm text-center text-sm text-white/70 transition-all duration-500 ease-out md:text-base ${
                stage >= 2 ? "blur-none opacity-100" : "blur-md opacity-0"
              }`}
            >
              An autonomous AI workforce that discovers, hires, and governs
              its own agents — under budget, on quality, every time.
            </p>

            <div
              className={`w-full max-w-sm transition-all duration-500 ease-out ${
                stage >= 3 ? "blur-none opacity-100" : "blur-md opacity-0"
              }`}
            >
              <Button
                type="button"
                onClick={handleGoogleSignIn}
                disabled={signingIn || loading}
                className="h-11 w-full gap-2.5 rounded-lg bg-white text-black transition-transform duration-200 ease-out hover:scale-[1.02] hover:bg-white/85 active:scale-[0.97]"
              >
                {signingIn ? (
                  <Loader2 className="size-4 animate-spin" />
                ) : (
                  <GoogleIcon className="size-4" />
                )}
                {signingIn ? "Signing in…" : "Continue with Google"}
              </Button>

              {authError && (
                <p className="mt-2.5 text-center font-mono text-xs text-red-400">
                  {authError}
                </p>
              )}
            </div>
          </div>
        </div>
      </div>
    </main>
  );
}
