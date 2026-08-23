"use client";

import { useEffect, useRef, useState } from "react";
import Image from "next/image";
import { FigmaCursor } from "./FigmaCursor";
import { FluidOrb } from "./FluidOrb";
import { MagneticButton } from "./MagneticButton";

const WORDS = ["Kraven", "Innofusion", "Intelligence", "Velocity"];

function useTextScramble(target: string) {
  const [output, setOutput] = useState(target);
  const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789!@#$%";
  const raf = useRef<ReturnType<typeof setTimeout> | null>(null);

  const scramble = (text: string) => {
    let iteration = 0;
    const totalFrames = text.length * 3;
    if (raf.current) clearInterval(raf.current);
    raf.current = setInterval(() => {
      setOutput(
        text
          .split("")
          .map((letter, i) => {
            if (i < Math.floor(iteration / 3)) return letter;
            return chars[Math.floor(Math.random() * chars.length)];
          })
          .join("")
      );
      iteration++;
      if (iteration >= totalFrames) {
        clearInterval(raf.current!);
        setOutput(text);
      }
    }, 30);
  };

  useEffect(() => {
    scramble(target);
    return () => { if (raf.current) clearInterval(raf.current); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [target]);

  return output;
}

function RotatingWord() {
  const [idx, setIdx] = useState(0);
  useEffect(() => {
    const id = setInterval(() => setIdx((i) => (i + 1) % WORDS.length), 2800);
    return () => clearInterval(id);
  }, []);
  const scrambled = useTextScramble(WORDS[idx]);
  return (
    <span className="inline-block text-white/60 font-mono tracking-tight" style={{ minWidth: "12ch" }}>
      {scrambled}
    </span>
  );
}

function MarqueeRow({ items, reverse = false }: { items: string[]; reverse?: boolean }) {
  return (
    <div className="overflow-hidden whitespace-nowrap py-2 border-y border-white/5">
      <div
        className="inline-flex gap-12 text-xs uppercase tracking-[0.3em] text-white/20 font-mono"
        style={{
          animation: `marquee${reverse ? "Rev" : ""} 28s linear infinite`,
        }}
      >
        {[...items, ...items, ...items].map((item, i) => (
          <span key={i}>{item} <span className="opacity-40">✦</span></span>
        ))}
      </div>
    </div>
  );
}

function AnimatedCounter({ target, label }: { target: number; label: string }) {
  const [count, setCount] = useState(0);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          let start = 0;
          const step = target / 60;
          const id = setInterval(() => {
            start += step;
            if (start >= target) { setCount(target); clearInterval(id); }
            else setCount(Math.floor(start));
          }, 16);
        }
      },
      { threshold: 0.5 }
    );
    if (ref.current) observer.observe(ref.current);
    return () => observer.disconnect();
  }, [target]);

  return (
    <div ref={ref} className="text-center">
      <div className="text-4xl md:text-5xl font-bold text-white tabular-nums">
        {count.toLocaleString()}
        <span className="text-white/30">+</span>
      </div>
      <div className="text-xs uppercase tracking-widest text-white/40 mt-2 font-mono">{label}</div>
    </div>
  );
}

function GlassCard({ title, desc, icon }: { title: string; desc: string; icon: string }) {
  const ref = useRef<HTMLDivElement>(null);

  const onMove = (e: React.MouseEvent<HTMLDivElement>) => {
    const el = ref.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const x = ((e.clientX - rect.left) / rect.width) * 100;
    const y = ((e.clientY - rect.top) / rect.height) * 100;
    el.style.setProperty("--mx", `${x}%`);
    el.style.setProperty("--my", `${y}%`);
  };

  return (
    <div
      ref={ref}
      onMouseMove={onMove}
      data-cursor-hover
      className="group relative rounded-2xl border border-white/[0.07] p-8 overflow-hidden transition-all duration-500 hover:border-white/20"
      style={{
        background: "rgba(255,255,255,0.03)",
        backdropFilter: "blur(16px)",
      }}
    >
      {/* Hover spotlight */}
      <div
        className="absolute inset-0 opacity-0 group-hover:opacity-100 transition-opacity duration-500 pointer-events-none"
        style={{
          background: "radial-gradient(200px circle at var(--mx, 50%) var(--my, 50%), rgba(255,255,255,0.06), transparent 70%)",
        }}
      />
      <div className="relative z-10">
        <span className="text-3xl mb-5 block">{icon}</span>
        <h3 className="text-white font-semibold text-lg mb-2">{title}</h3>
        <p className="text-white/40 text-sm leading-relaxed">{desc}</p>
      </div>
      {/* Corner accent */}
      <div className="absolute bottom-0 right-0 w-16 h-16 rounded-tl-full bg-white/[0.02] pointer-events-none" />
    </div>
  );
}

const MARQUEE_ITEMS = [
  "AI Workforce", "Neural Networks", "Autonomous Agents", "Real-time Analytics",
  "Fluid Motion", "Precision Tools", "Edge Computing", "Quantum Inference",
];

const FEATURES = [
  { icon: "⚡", title: "Real-time Inference", desc: "Sub-millisecond latency on edge with distributed neural computation across your entire stack." },
  { icon: "🧠", title: "Autonomous Agents", desc: "Self-optimizing workforce clusters that adapt, learn, and re-route decisions autonomously." },
  { icon: "🌊", title: "Fluid Architecture", desc: "Liquid-state design systems that morph to your workflow — no rigidity, pure momentum." },
  { icon: "🔭", title: "Deep Analytics", desc: "Hyperdimensional data mapping with pattern recognition across temporal event streams." },
  { icon: "🛡️", title: "Zero-Trust Security", desc: "Cryptographic attestation at every compute boundary — security that scales with intent." },
  { icon: "🚀", title: "Warp Deployment", desc: "Ship atomic updates globally in under 200ms with rollback-safe blue-green routing." },
];

export function LandingPage() {
  const heroRef = useRef<HTMLDivElement>(null);
  const [scrollY, setScrollY] = useState(0);
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
    const onScroll = () => setScrollY(window.scrollY);
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  return (
    <div
      className="relative min-h-screen bg-black overflow-x-hidden"
      style={{ cursor: "none" }}
    >
      <style>{`
        @keyframes marquee {
          from { transform: translateX(0); }
          to { transform: translateX(-33.333%); }
        }
        @keyframes marqueeRev {
          from { transform: translateX(-33.333%); }
          to { transform: translateX(0); }
        }
        @keyframes fadeUp {
          from { opacity: 0; transform: translateY(32px); }
          to { opacity: 1; transform: translateY(0); }
        }
        @keyframes fadeIn {
          from { opacity: 0; }
          to { opacity: 1; }
        }
        @keyframes glow-pulse {
          0%, 100% { opacity: 0.5; }
          50% { opacity: 1; }
        }
        .anim-fade-up { animation: fadeUp 0.9s cubic-bezier(.22,1,.36,1) both; }
        .anim-fade-in { animation: fadeIn 1.2s ease both; }
        .delay-100 { animation-delay: 0.1s; }
        .delay-200 { animation-delay: 0.2s; }
        .delay-300 { animation-delay: 0.3s; }
        .delay-500 { animation-delay: 0.5s; }
        .delay-700 { animation-delay: 0.7s; }
        .delay-900 { animation-delay: 0.9s; }
        .noise-overlay {
          background-image: url("data:image/svg+xml,%3Csvg viewBox='0 0 256 256' xmlns='http://www.w3.org/2000/svg'%3E%3Cfilter id='noise'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.9' numOctaves='4' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23noise)' opacity='0.4'/%3E%3C/svg%3E");
          background-size: 200px 200px;
          mix-blend-mode: overlay;
          pointer-events: none;
        }
      `}</style>

      {/* Custom cursor */}
      <FigmaCursor />

      {/* Noise texture overlay */}
      <div className="noise-overlay fixed inset-0 z-[100] opacity-[0.03] pointer-events-none" />

      {/* ─── NAVBAR ─── */}
      <nav
        className="fixed top-0 left-0 right-0 z-50 flex items-center justify-between px-8 py-5"
        style={{
          background: scrollY > 40 ? "rgba(0,0,0,0.7)" : "transparent",
          backdropFilter: scrollY > 40 ? "blur(20px)" : "none",
          borderBottom: scrollY > 40 ? "1px solid rgba(255,255,255,0.06)" : "none",
          transition: "background 0.4s, backdrop-filter 0.4s, border 0.4s",
        }}
      >
        <div className="flex items-center">
          <Image
            src="/logo.png"
            alt="Kraven"
            width={2172}
            height={724}
            className="h-6 w-auto invert"
            priority
          />
        </div>
        <div className="hidden md:flex items-center gap-8 text-xs text-white/40 uppercase tracking-widest font-mono">
          {["Product", "Studio", "Docs", "Blog"].map((item) => (
            <a
              key={item}
              href="#"
              className="hover:text-white transition-colors duration-200"
              data-cursor-hover
            >
              {item}
            </a>
          ))}
        </div>
        <MagneticButton>
          <button
            data-cursor-hover
            className="text-xs uppercase tracking-widest text-black bg-white rounded-full px-5 py-2.5 font-semibold hover:bg-white/90 transition-colors duration-200"
          >
            Get Access
          </button>
        </MagneticButton>
      </nav>

      {/* ─── HERO ─── */}
      <section
        ref={heroRef}
        className="relative min-h-screen flex flex-col items-center justify-center overflow-hidden"
      >
        {/* Canvas orb background */}
        <div className="absolute inset-0">
          <FluidOrb />
        </div>

        {/* Radial gradient vignette */}
        <div
          className="absolute inset-0 pointer-events-none"
          style={{
            background: "radial-gradient(ellipse 80% 60% at 50% 60%, transparent 0%, #000 80%)",
          }}
        />

        {/* Scroll parallax on content */}
        <div
          className="relative z-10 flex flex-col items-center text-center px-6 max-w-6xl mx-auto"
          style={{ transform: `translateY(${scrollY * 0.25}px)`, opacity: 1 - scrollY / 600 }}
        >
          {/* Badge */}
          {mounted && (
            <div className="anim-fade-up delay-100 mb-8 flex items-center gap-2 rounded-full border border-white/10 px-4 py-1.5 text-xs text-white/50 font-mono uppercase tracking-widest backdrop-blur-sm bg-white/[0.03]">
              <span
                className="inline-block w-1.5 h-1.5 rounded-full bg-white/60"
                style={{ animation: "glow-pulse 2s ease-in-out infinite" }}
              />
              Innovate Without Limits
              <span className="text-white/20">›</span>
            </div>
          )}

          {/* Headline */}
          {mounted && (
            <h1
              className="anim-fade-up delay-200 font-bold text-white leading-[0.92] tracking-[-0.03em] mb-6"
              style={{ fontSize: "clamp(3rem, 10vw, 9rem)" }}
            >
              Build smarter tools
              <br />
              <span className="text-white/40">for </span>
              <RotatingWord />
              <br />
              <span className="text-white/40">teams.</span>
            </h1>
          )}

          {/* Sub */}
          {mounted && (
            <p className="anim-fade-up delay-300 text-white/35 text-base md:text-lg max-w-xl leading-relaxed mb-12 font-mono">
              Streamline your workflow and boost productivity with intuitive solutions.
              <br />Security, speed, and simplicity — all in one platform.
            </p>
          )}

          {/* CTA row */}
          {mounted && (
            <div className="anim-fade-up delay-500 flex flex-col sm:flex-row items-center gap-4">
              <MagneticButton>
                <button
                  data-cursor-hover
                  className="group relative overflow-hidden rounded-full px-8 py-4 text-sm font-semibold text-black bg-white hover:bg-white/90 transition-colors duration-200"
                >
                  <span className="relative z-10">Explore Now</span>
                </button>
              </MagneticButton>
              <MagneticButton>
                <button
                  data-cursor-hover
                  className="rounded-full px-8 py-4 text-sm font-semibold text-white border border-white/15 hover:border-white/40 transition-colors duration-200 backdrop-blur-sm"
                >
                  Watch Demo →
                </button>
              </MagneticButton>
            </div>
          )}
        </div>

        {/* Scroll indicator */}
        {mounted && (
          <div className="anim-fade-in delay-900 absolute bottom-10 left-1/2 -translate-x-1/2 flex flex-col items-center gap-2 z-10">
            <span className="text-white/20 text-[10px] uppercase tracking-[0.3em] font-mono">Scroll</span>
            <div
              className="w-px h-12 bg-gradient-to-b from-white/30 to-transparent"
              style={{ animation: "glow-pulse 2s ease-in-out infinite" }}
            />
          </div>
        )}
      </section>

      {/* ─── MARQUEE ─── */}
      <div className="py-0">
        <MarqueeRow items={MARQUEE_ITEMS} />
        <MarqueeRow items={MARQUEE_ITEMS} reverse />
      </div>

      {/* ─── STATS ─── */}
      <section className="py-28 px-6">
        <div className="max-w-4xl mx-auto grid grid-cols-2 md:grid-cols-4 gap-8">
          <AnimatedCounter target={12000} label="Active Users" />
          <AnimatedCounter target={99} label="Uptime %" />
          <AnimatedCounter target={450} label="Integrations" />
          <AnimatedCounter target={3} label="ms Latency" />
        </div>
      </section>

      {/* ─── FEATURES ─── */}
      <section className="py-20 px-6 max-w-7xl mx-auto">
        <div className="mb-16 flex flex-col md:flex-row md:items-end justify-between gap-6">
          <div>
            <p className="text-white/30 text-xs uppercase tracking-widest font-mono mb-4">Capabilities</p>
            <h2
              className="text-white font-bold leading-tight"
              style={{ fontSize: "clamp(2rem, 5vw, 4.5rem)", letterSpacing: "-0.03em" }}
            >
              Every tool you need.<br />
              <span className="text-white/30">Nothing you don&apos;t.</span>
            </h2>
          </div>
          <p className="text-white/30 text-sm max-w-xs leading-relaxed font-mono">
            A unified intelligence layer that speaks your language and understands your workflow.
          </p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {FEATURES.map((f) => (
            <GlassCard key={f.title} title={f.title} desc={f.desc} icon={f.icon} />
          ))}
        </div>
      </section>

      {/* ─── CTA BAND ─── */}
      <section className="py-32 px-6 relative overflow-hidden">
        {/* Background glow */}
        <div
          className="absolute inset-0 pointer-events-none"
          style={{
            background: "radial-gradient(ellipse 70% 60% at 50% 50%, rgba(255,255,255,0.04) 0%, transparent 70%)",
          }}
        />
        <div className="relative z-10 max-w-3xl mx-auto text-center">
          <p className="text-white/30 text-xs uppercase tracking-widest font-mono mb-6">Ready when you are</p>
          <h2
            className="text-white font-bold leading-tight mb-8"
            style={{ fontSize: "clamp(2.5rem, 6vw, 5.5rem)", letterSpacing: "-0.04em" }}
          >
            The future is<br />
            <span className="text-white/20">already here.</span>
          </h2>
          <MagneticButton className="inline-block">
            <button
              data-cursor-hover
              className="rounded-full px-10 py-5 text-sm font-semibold text-black bg-white hover:bg-white/90 transition-all duration-300"
            >
              Start Building — it&apos;s free
            </button>
          </MagneticButton>
        </div>
      </section>

      {/* ─── FOOTER ─── */}
      <footer className="border-t border-white/[0.06] py-10 px-8 flex flex-col md:flex-row items-center justify-between gap-4">
        <div className="flex items-center gap-2">
          <svg width="20" height="20" viewBox="0 0 28 28" fill="none">
            <polygon points="14,2 26,24 2,24" fill="white" opacity="0.5" />
          </svg>
          <span className="text-white/30 text-xs font-mono">© 2026 Innofusion. All rights reserved.</span>
        </div>
        <div className="flex items-center gap-6 text-white/20 text-xs font-mono uppercase tracking-widest">
          {["Privacy", "Terms", "Status", "Twitter"].map((item) => (
            <a key={item} href="#" className="hover:text-white/50 transition-colors" data-cursor-hover>
              {item}
            </a>
          ))}
        </div>
      </footer>
    </div>
  );
}

