"use client";

import { useEffect, useRef, useState } from "react";

const SCRAMBLE_CHARS = "ABCDEFGHIJKLMNOPQRSTUVWXYZ01!<>-_/[]{}=+*^#";

/** Text that decrypts from scrambled characters into itself while `active` is true. */
export function ScrambleText({
  text,
  active,
}: {
  text: string;
  active: boolean;
}) {
  const [display, setDisplay] = useState(text);
  const frame = useRef(0);
  const measureRef = useRef<HTMLSpanElement>(null);
  const [width, setWidth] = useState<number>();

  // Locks the box to the final text's measured width so random scramble
  // glyphs (which can be wider than the real characters) never resize it.
  useEffect(() => {
    if (measureRef.current) setWidth(measureRef.current.offsetWidth);
  }, [text]);

  useEffect(() => {
    if (!active) {
      setDisplay(text);
      frame.current = 0;
      return;
    }

    const raf = setInterval(() => {
      frame.current += 1;
      const revealCount = Math.floor(frame.current / 2);
      setDisplay(
        text
          .split("")
          .map((char, i) => {
            if (char === " ") return " ";
            if (i < revealCount) return char;
            return SCRAMBLE_CHARS[Math.floor(Math.random() * SCRAMBLE_CHARS.length)];
          })
          .join("")
      );
      if (revealCount >= text.length) clearInterval(raf);
    }, 28);

    return () => clearInterval(raf);
  }, [active, text]);

  return (
    <span className="relative inline-block align-top" style={{ width }}>
      <span ref={measureRef} className="invisible whitespace-nowrap" aria-hidden="true">
        {text}
      </span>
      <span className="absolute inset-0 overflow-hidden whitespace-nowrap">{display}</span>
    </span>
  );
}

/** Hook giving hover handlers to feed into `ScrambleText`'s `active` prop. */
export function useHoverScramble() {
  const [hovered, setHovered] = useState(false);
  return {
    hovered,
    onMouseEnter: () => setHovered(true),
    onMouseLeave: () => setHovered(false),
  };
}
