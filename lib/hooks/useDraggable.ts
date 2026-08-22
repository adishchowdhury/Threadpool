"use client";

import { useCallback, useRef, useState, type CSSProperties, type PointerEvent as ReactPointerEvent } from "react";

interface DragPosition {
  x: number;
  y: number;
  height: number;
}

/**
 * Lets a fixed/absolute-positioned panel be picked up by a drag handle and
 * dropped anywhere in the viewport. Until the first drag, the panel keeps
 * its original CSS-driven position (nothing is overridden); after that,
 * inline `left`/`top` win over the positioning classes since inline styles
 * always beat stylesheet rules for the same property.
 */
export function useDraggable() {
  const containerRef = useRef<HTMLDivElement>(null);
  const [position, setPosition] = useState<DragPosition | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const dragState = useRef<{ startX: number; startY: number; origX: number; origY: number } | null>(null);

  const onPointerDown = useCallback(
    (e: ReactPointerEvent<HTMLElement>) => {
      // Don't hijack clicks on buttons inside the drag handle (e.g. collapse).
      if ((e.target as HTMLElement).closest("button, a, input, textarea")) return;
      const el = containerRef.current;
      if (!el) return;
      const rect = el.getBoundingClientRect();
      const origX = position?.x ?? rect.left;
      const origY = position?.y ?? rect.top;
      if (!position) {
        setPosition({ x: rect.left, y: rect.top, height: rect.height });
      }
      dragState.current = { startX: e.clientX, startY: e.clientY, origX, origY };
      setIsDragging(true);
      (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    },
    [position],
  );

  const onPointerMove = useCallback((e: ReactPointerEvent<HTMLElement>) => {
    if (!dragState.current) return;
    const el = containerRef.current;
    const width = el?.offsetWidth ?? 0;
    const height = el?.offsetHeight ?? 0;
    const dx = e.clientX - dragState.current.startX;
    const dy = e.clientY - dragState.current.startY;
    const maxX = Math.max(window.innerWidth - width, 0);
    const maxY = Math.max(window.innerHeight - height, 0);
    const x = Math.min(Math.max(dragState.current.origX + dx, 0), maxX);
    const y = Math.min(Math.max(dragState.current.origY + dy, 0), maxY);
    setPosition((p) => (p ? { ...p, x, y } : p));
  }, []);

  const onPointerUp = useCallback((e: ReactPointerEvent<HTMLElement>) => {
    dragState.current = null;
    setIsDragging(false);
    if ((e.currentTarget as HTMLElement).hasPointerCapture(e.pointerId)) {
      (e.currentTarget as HTMLElement).releasePointerCapture(e.pointerId);
    }
  }, []);

  const style: CSSProperties | undefined = position
    ? { position: "fixed", left: position.x, top: position.y, right: "auto", bottom: "auto", height: position.height }
    : undefined;

  const handleProps = {
    onPointerDown,
    onPointerMove,
    onPointerUp,
    onPointerCancel: onPointerUp,
    style: { touchAction: "none", cursor: isDragging ? "grabbing" : "grab" } as CSSProperties,
  };

  return { containerRef, style, isDragging, handleProps };
}
