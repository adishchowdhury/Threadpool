"use client";

import { useEffect, useRef, useState } from "react";

export function FigmaCursor() {
  const cursorRef = useRef<HTMLDivElement>(null);
  const trailRef = useRef<HTMLDivElement>(null);
  const pos = useRef({ x: -100, y: -100 });
  const trail = useRef({ x: -100, y: -100 });
  const raf = useRef<number>(0);
  const [visible, setVisible] = useState(false);
  const [clicking, setClicking] = useState(false);
  const [hovering, setHovering] = useState(false);

  useEffect(() => {
    const onMove = (e: MouseEvent) => {
      pos.current = { x: e.clientX, y: e.clientY };
      if (!visible) setVisible(true);
    };

    const onDown = () => setClicking(true);
    const onUp = () => setClicking(false);

    const onEnterLink = (e: MouseEvent) => {
      const t = e.target as HTMLElement;
      if (t.closest("a,button,[data-cursor-hover]")) setHovering(true);
    };
    const onLeaveLink = (e: MouseEvent) => {
      const t = e.target as HTMLElement;
      if (t.closest("a,button,[data-cursor-hover]")) setHovering(false);
    };

    document.addEventListener("mousemove", onMove);
    document.addEventListener("mousedown", onDown);
    document.addEventListener("mouseup", onUp);
    document.addEventListener("mouseover", onEnterLink);
    document.addEventListener("mouseout", onLeaveLink);
    document.addEventListener("mouseleave", () => setVisible(false));

    let prevTime = 0;
    const lerp = (a: number, b: number, t: number) => a + (b - a) * t;

    const loop = (time: number) => {
      const dt = Math.min((time - prevTime) / 16.67, 4);
      prevTime = time;
      const speed = 0.12 * dt;
      trail.current.x = lerp(trail.current.x, pos.current.x, speed);
      trail.current.y = lerp(trail.current.y, pos.current.y, speed);

      if (cursorRef.current) {
        cursorRef.current.style.transform = `translate(${pos.current.x}px, ${pos.current.y}px)`;
      }
      if (trailRef.current) {
        trailRef.current.style.transform = `translate(${trail.current.x}px, ${trail.current.y}px)`;
      }
      raf.current = requestAnimationFrame(loop);
    };
    raf.current = requestAnimationFrame(loop);

    return () => {
      document.removeEventListener("mousemove", onMove);
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("mouseup", onUp);
      document.removeEventListener("mouseover", onEnterLink);
      document.removeEventListener("mouseout", onLeaveLink);
      cancelAnimationFrame(raf.current);
    };
  }, [visible]);

  return (
    <>
      {/* Figma-style triangle cursor */}
      <div
        ref={cursorRef}
        className="pointer-events-none fixed left-0 top-0 z-[9999] will-change-transform"
        style={{
          opacity: visible ? 1 : 0,
          transition: "opacity 0.2s",
        }}
      >
        <svg
          width={clicking ? 20 : hovering ? 28 : 24}
          height={clicking ? 20 : hovering ? 28 : 24}
          viewBox="0 0 24 24"
          fill="none"
          style={{
            transition: "width 0.15s, height 0.15s",
            filter: "drop-shadow(0 2px 8px rgba(0,0,0,0.6))",
          }}
        >
          {/* Triangle arrow — Figma style */}
          <path
            d="M4 2L20 12L12 14L8 22L4 2Z"
            fill="white"
            stroke="black"
            strokeWidth="1.5"
            strokeLinejoin="round"
          />
        </svg>
      </div>

      {/* Trailing magnetic dot */}
      <div
        ref={trailRef}
        className="pointer-events-none fixed left-0 top-0 z-[9998] will-change-transform"
        style={{
          opacity: visible ? 1 : 0,
          transition: "opacity 0.2s",
        }}
      >
        <div
          style={{
            width: hovering ? 40 : 10,
            height: hovering ? 40 : 10,
            borderRadius: "50%",
            background: hovering
              ? "rgba(255,255,255,0.08)"
              : "rgba(255,255,255,0.5)",
            border: hovering ? "1px solid rgba(255,255,255,0.3)" : "none",
            transform: "translate(-50%, -50%)",
            transition: "width 0.3s cubic-bezier(.22,1,.36,1), height 0.3s cubic-bezier(.22,1,.36,1), background 0.3s, border 0.3s",
            backdropFilter: hovering ? "blur(4px)" : "none",
          }}
        />
      </div>
    </>
  );
}

