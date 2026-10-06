"use client";

import { useState, type FormEvent } from "react";

type Status = "idle" | "submitting" | "success" | "error";

export function ContactForm() {
  const [status, setStatus] = useState<Status>("idle");
  const [error, setError] = useState<string | null>(null);

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = e.currentTarget;
    const data = {
      name: (form.elements.namedItem("name") as HTMLInputElement).value,
      email: (form.elements.namedItem("email") as HTMLInputElement).value,
      message: (form.elements.namedItem("message") as HTMLTextAreaElement).value,
    };

    setStatus("submitting");
    setError(null);

    try {
      const res = await fetch("/api/contact", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data),
      });
      const json = await res.json();
      if (!res.ok) {
        setError(json.error ?? "Something went wrong. Please try again.");
        setStatus("error");
        return;
      }
      setStatus("success");
      form.reset();
    } catch {
      setError("Network error. Please try again or email us directly.");
      setStatus("error");
    }
  }

  if (status === "success") {
    return (
      <div className="py-6 text-center">
        <p className="mb-2 text-lg font-semibold text-neutral-900">Message sent.</p>
        <p className="text-sm text-neutral-500">
          Thanks for reaching out - we&apos;ll get back to you at the email address you provided.
        </p>
        <button
          type="button"
          onClick={() => setStatus("idle")}
          className="mt-6 inline-flex h-8 items-center border border-neutral-300 px-4 font-mono text-[12px] uppercase tracking-wider text-neutral-700 transition-colors hover:border-neutral-900 hover:text-neutral-900"
        >
          Send another message
        </button>
      </div>
    );
  }

  return (
    <form onSubmit={onSubmit} className="space-y-8 max-w-xl">
      <div>
        <label htmlFor="name" className="mb-2 block font-mono text-[11px] uppercase tracking-wider text-neutral-400">
          Name
        </label>
        <input
          id="name"
          name="name"
          type="text"
          required
          maxLength={200}
          disabled={status === "submitting"}
          className="w-full border-0 border-b border-neutral-200 bg-transparent px-0 py-2.5 text-sm text-neutral-900 placeholder:text-neutral-400 outline-none transition-colors focus:border-neutral-900 disabled:opacity-50"
          placeholder="Your name"
        />
      </div>
      <div>
        <label htmlFor="email" className="mb-2 block font-mono text-[11px] uppercase tracking-wider text-neutral-400">
          Email
        </label>
        <input
          id="email"
          name="email"
          type="email"
          required
          maxLength={320}
          disabled={status === "submitting"}
          className="w-full border-0 border-b border-neutral-200 bg-transparent px-0 py-2.5 text-sm text-neutral-900 placeholder:text-neutral-400 outline-none transition-colors focus:border-neutral-900 disabled:opacity-50"
          placeholder="you@example.com"
        />
      </div>
      <div>
        <label htmlFor="message" className="mb-2 block font-mono text-[11px] uppercase tracking-wider text-neutral-400">
          Message
        </label>
        <textarea
          id="message"
          name="message"
          required
          minLength={10}
          maxLength={5000}
          rows={5}
          disabled={status === "submitting"}
          className="w-full resize-none border-0 border-b border-neutral-200 bg-transparent px-0 py-2.5 text-sm text-neutral-900 placeholder:text-neutral-400 outline-none transition-colors focus:border-neutral-900 disabled:opacity-50"
          placeholder="How can we help?"
        />
      </div>

      {error && <p className="text-sm text-red-600">{error}</p>}

      <button
        type="submit"
        disabled={status === "submitting"}
        className="inline-flex h-11 items-center justify-center bg-neutral-900 px-7 text-sm font-medium text-white transition-colors hover:bg-neutral-800 disabled:opacity-50"
      >
        {status === "submitting" ? "Sending…" : "Send message"}
      </button>
    </form>
  );
}
