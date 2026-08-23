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

  useEffect(() => {
    if (!active) {
      setDisplay(text);
      frame.current = 0;
      return;
    }

    let raf: ReturnType<typeof setInterval>;
    raf = setInterval(() => {
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
    <span className="relative inline-grid">
      {/* Reserves the final text's box size so scrambled glyphs never shift layout. */}
      <span className="invisible col-start-1 row-start-1" aria-hidden="true">
        {text}
      </span>
      <span className="col-start-1 row-start-1">{display}</span>
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
