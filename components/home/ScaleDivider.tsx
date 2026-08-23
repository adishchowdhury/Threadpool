const STRIPES =
  "repeating-linear-gradient(-45deg, oklch(0.88 0 0) 0 1px, transparent 1px 8px)";

export function ScaleDivider() {
  return (
    <div
      aria-hidden
      className="h-4 w-full border-y border-dotted border-neutral-300"
      style={{ backgroundImage: STRIPES }}
    />
  );
}

export function VerticalScaleBars() {
  return (
    <>
      <div
        aria-hidden
        className="pointer-events-none fixed top-14 bottom-0 left-0 z-0 hidden w-4 border-x border-dotted border-neutral-300 lg:block"
        style={{ backgroundImage: STRIPES }}
      />
      <div
        aria-hidden
        className="pointer-events-none fixed top-14 bottom-0 right-0 z-0 hidden w-4 border-x border-dotted border-neutral-300 lg:block"
        style={{ backgroundImage: STRIPES }}
      />
    </>
  );
}
