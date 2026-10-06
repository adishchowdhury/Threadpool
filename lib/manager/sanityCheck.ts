import { z } from "zod";
import { isSarvamConfigured } from "@/lib/manager/sarvam";
import { generateStructured } from "@/lib/manager/structuredGenerate";

// Runs once, right after basic schema validation and before any planning,
// discovery, escrow or worker spend. Domain-agnostic on purpose: it only
// asks "is there a coherent, actionable request here", never whether the
// request is good, feasible or well-scoped - that judgment stays with the
// planner/QA, which already run after real work has been committed.

const sanityVerdictSchema = z.object({
  valid: z.boolean(),
  reason: z.string().optional(),
});

export type SanityVerdict = {
  valid: boolean;
  reason?: string;
  source: "sarvam" | "local_fallback";
};

// Deterministic fallback for when the Manager LLM is unavailable. It cannot
// judge coherence, so it only screens for cases that need no judgment at
// all: too little information to act on, or text with no real word
// structure (gibberish keymash, a wall of repeated characters). Anything
// with plausible word-like tokens is let through - a false rejection here
// has no human to appeal to, while a false acceptance is just an ordinary
// task that planning/QA can still deal with.
function heuristicSanityCheck(prompt: string): SanityVerdict {
  const trimmed = prompt.trim();
  const words = trimmed.split(/\s+/).filter(Boolean);

  if (words.length < 2) {
    return { valid: false, reason: "too little information to act on", source: "local_fallback" };
  }

  // A real word has vowels, isn't just one letter hammered repeatedly, and
  // doesn't string together a long run of consonants - a cheap stand-in for
  // "is this pronounceable" that catches keyboard mashes like "asdfgh"
  // without a dictionary. It will occasionally flag a genuine but
  // consonant-dense English word (e.g. "strengths"); that's an accepted
  // false positive for one word among many, since the overall verdict below
  // only flips on gibberish when most of the prompt's words fail this way.
  const looksLikeWord = (w: string) => {
    const letters = w.toLowerCase().replace(/[^a-z]/g, "");
    if (letters.length < 2) return true; // numbers, punctuation-only tokens: not evidence either way
    if (!/[aeiou]/.test(letters)) return false;
    if (/^(.)\1+$/.test(letters)) return false;
    if (/[^aeiou]{5,}/.test(letters)) return false;
    return true;
  };
  const wordlike = words.filter(looksLikeWord).length;
  if (wordlike / words.length < 0.5) {
    return { valid: false, reason: "no meaningful word structure", source: "local_fallback" };
  }

  return { valid: true, source: "local_fallback" };
}

export async function checkTaskSanity(prompt: string): Promise<SanityVerdict> {
  if (!isSarvamConfigured()) {
    return heuristicSanityCheck(prompt);
  }

  try {
    const object = await generateStructured({
      schema: sanityVerdictSchema,
      prompt: `You are validating whether a user's request is a meaningful task for an autonomous AI workforce system.

Return valid=true when the request contains enough coherent intent that a workforce could reasonably perform useful work on it.

Return valid=false when the input is clearly:
- random/gibberish text
- meaningless fragments
- a greeting with no task
- a non-actionable personal statement
- an instruction with no meaningful objective

Do NOT reject a request merely because it is:
- unusual, broad, difficult, or creative
- about unfamiliar terminology or a subject you personally lack data on
- missing detail but still expressing a real objective

When uncertain, prefer valid=true over falsely rejecting a legitimate request.

If valid=false, "reason" should briefly state what is missing (not exposed to the end user verbatim).

User request: "${prompt}"`,
    });
    return { ...object, source: "sarvam" };
  } catch (err) {
    console.error("[Manager] Sarvam sanity check failed, using deterministic fallback:", err);
    return heuristicSanityCheck(prompt);
  }
}
