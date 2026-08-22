"use client";

import type { LucideIcon } from "lucide-react";

export type OrbitItem =
  | { type: "icon"; icon: LucideIcon; label: string }
  | { type: "logo"; src: string; label: string; color: string };

function OrbitNode({ item }: { item: OrbitItem }) {
  if (item.type === "logo") {
    return (
      <div
        title={item.label}
        className="flex size-11 items-center justify-center rounded-full border border-white/20 bg-white/95 p-2.5 shadow-[0_0_0_1px_rgba(255,255,255,0.05),0_8px_24px_rgba(0,0,0,0.5)] md:size-14 md:p-3.5"
      >
        <span
          role="img"
          aria-label={item.label}
          className="block size-full"
          style={{
            backgroundColor: item.color,
            WebkitMaskImage: `url(${item.src})`,
            maskImage: `url(${item.src})`,
            WebkitMaskSize: "contain",
            maskSize: "contain",
            WebkitMaskRepeat: "no-repeat",
            maskRepeat: "no-repeat",
            WebkitMaskPosition: "center",
            maskPosition: "center",
          }}
        />
      </div>
    );
  }

  const Icon = item.icon;
  return (
    <div
      title={item.label}
      className="flex size-11 items-center justify-center rounded-full border border-white/15 bg-white/[0.04] text-white/70 shadow-[0_0_0_1px_rgba(255,255,255,0.05),0_8px_24px_rgba(0,0,0,0.5)] backdrop-blur-sm md:size-14"
    >
      <Icon className="size-4 md:size-5" strokeWidth={1.5} />
    </div>
  );
}

function OrbitRing({
  items,
  radius,
  duration,
  direction,
}: {
  items: OrbitItem[];
  radius: string;
  duration: number;
  direction: "cw" | "ccw";
}) {
  const ringAnim =
    direction === "cw" ? "orbit-spin-cw" : "orbit-spin-ccw";
  const counterAnim =
    direction === "cw" ? "orbit-counter-cw" : "orbit-counter-ccw";

  return (
    <>
      {/* faint orbit path */}
      <div
        className="pointer-events-none absolute rounded-full border border-dashed border-white/[0.08]"
        style={{
          width: `calc(${radius} * 2)`,
          height: `calc(${radius} * 2)`,
          left: "50%",
          top: "50%",
          transform: "translate(-50%, -50%)",
        }}
      />
      <div
        className="pointer-events-none absolute inset-0"
        style={{ animation: `${ringAnim} ${duration}s linear infinite` }}
      >
        {items.map((item, i) => {
          const angle = (360 / items.length) * i;
          return (
            <div
              key={item.label}
              className="absolute left-1/2 top-1/2"
              style={{
                transformOrigin: "0 0",
                transform: `rotate(${angle}deg) translateX(${radius})`,
              }}
            >
              <div className="pointer-events-auto -translate-x-1/2 -translate-y-1/2">
                <div
                  style={{
                    animation: `${counterAnim} ${duration}s linear infinite`,
                  }}
                >
                  <div style={{ transform: `rotate(${-angle}deg)` }}>
                    <OrbitNode item={item} />
                  </div>
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </>
  );
}

export default function OrbitField({
  outerItems,
  innerItems,
  outerRadius = "clamp(170px, 26vw, 320px)",
  innerRadius = "clamp(100px, 15vw, 190px)",
  outerDuration = 38,
  innerDuration = 24,
  className = "",
}: {
  outerItems: OrbitItem[];
  innerItems: OrbitItem[];
  outerRadius?: string;
  innerRadius?: string;
  outerDuration?: number;
  innerDuration?: number;
  className?: string;
}) {
  return (
    <div className={`pointer-events-none absolute inset-0 ${className}`}>
      <OrbitRing
        items={outerItems}
        radius={outerRadius}
        duration={outerDuration}
        direction="cw"
      />
      <OrbitRing
        items={innerItems}
        radius={innerRadius}
        duration={innerDuration}
        direction="ccw"
      />
    </div>
  );
}
