const CORNER_BRACKET_PATH = "M2,10 L2,2 L10,2";

function CornerMark({ className }: { className?: string }) {
  return (
    <svg aria-hidden viewBox="0 0 12 12" className={className}>
      <path
        d={CORNER_BRACKET_PATH}
        fill="none"
        stroke="currentColor"
        strokeWidth="2.4"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

export function CornerMarks({ className }: { className?: string }) {
  const base = "pointer-events-none absolute h-4 w-4 sm:h-5 sm:w-5";
  return (
    <div className={className} aria-hidden>
      <CornerMark className={`${base} -top-3 -left-3`} />
      <CornerMark className={`${base} -top-3 -right-3 -scale-x-100`} />
      <CornerMark className={`${base} -bottom-3 -left-3 -scale-y-100`} />
      <CornerMark className={`${base} -bottom-3 -right-3 -scale-x-100 -scale-y-100`} />
    </div>
  );
}

export function ScratchBox({ className }: { className?: string }) {
  return (
    <svg
      aria-hidden
      viewBox="0 0 620 110"
      preserveAspectRatio="none"
      className={className}
    >
      <defs>
        <pattern
          id="scratch-hatch"
          width="16"
          height="16"
          patternTransform="rotate(45)"
          patternUnits="userSpaceOnUse"
        >
          <line x1="0" y1="0" x2="0" y2="16" stroke="currentColor" strokeWidth="1.5" />
        </pattern>
        <clipPath id="scratch-clip">
          <path d="M0.5,19.9 Q0.0,1.5 64.0,-0.3 Q128.0,-2.0 186.0,-2.4 Q244.0,-2.7 309.3,-2.9 Q374.6,-3.1 434.4,-0.0 Q494.3,3.0 557.1,0.7 Q620.0,-1.6 620.6,19.2 Q621.2,40.1 622.9,56.8 Q624.5,73.5 621.3,91.8 Q618.0,110.0 556.8,109.7 Q495.5,109.4 434.2,108.5 Q372.8,107.6 312.0,106.9 Q251.1,106.2 189.0,105.8 Q126.8,105.4 63.4,106.8 Q0.0,108.2 -0.3,90.9 Q-0.6,73.7 0.2,56.0 Q0.9,38.2 0.5,19.9 Z" />
        </clipPath>
      </defs>
      <rect
        width="620"
        height="110"
        fill="url(#scratch-hatch)"
        clipPath="url(#scratch-clip)"
        opacity="0.5"
      />
    </svg>
  );
}
