"use client";

import { useEffect, useRef } from "react";

interface Particle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  alpha: number;
  size: number;
  color: string;
}

export function FluidOrb() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const mouseRef = useRef({ x: 0, y: 0 });
  const particlesRef = useRef<Particle[]>([]);
  const rafRef = useRef<number>(0);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d")!;

    const resize = () => {
      canvas.width = window.innerWidth;
      canvas.height = window.innerHeight;
    };
    resize();
    window.addEventListener("resize", resize);

    // Initialize particles
    const COLORS = [
      "rgba(255,255,255,",
      "rgba(200,200,255,",
      "rgba(180,180,220,",
    ];
    for (let i = 0; i < 80; i++) {
      particlesRef.current.push({
        x: Math.random() * window.innerWidth,
        y: Math.random() * window.innerHeight,
        vx: (Math.random() - 0.5) * 0.4,
        vy: (Math.random() - 0.5) * 0.4,
        alpha: Math.random() * 0.5 + 0.1,
        size: Math.random() * 2 + 0.5,
        color: COLORS[Math.floor(Math.random() * COLORS.length)],
      });
    }

    const onMove = (e: MouseEvent) => {
      mouseRef.current = { x: e.clientX, y: e.clientY };
    };
    window.addEventListener("mousemove", onMove);

    // Fluid blob parameters
    let t = 0;

    const draw = () => {
      t += 0.005;
      ctx.clearRect(0, 0, canvas.width, canvas.height);

      // Render floating particles
      for (const p of particlesRef.current) {
        p.x += p.vx;
        p.y += p.vy;

        // Mouse repulsion
        const dx = p.x - mouseRef.current.x;
        const dy = p.y - mouseRef.current.y;
        const dist = Math.sqrt(dx * dx + dy * dy);
        if (dist < 120) {
          p.vx += (dx / dist) * 0.08;
          p.vy += (dy / dist) * 0.08;
        }

        // Damping
        p.vx *= 0.98;
        p.vy *= 0.98;

        // Wrap
        if (p.x < 0) p.x = canvas.width;
        if (p.x > canvas.width) p.x = 0;
        if (p.y < 0) p.y = canvas.height;
        if (p.y > canvas.height) p.y = 0;

        ctx.beginPath();
        ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2);
        ctx.fillStyle = p.color + p.alpha + ")";
        ctx.fill();
      }

      // Draw fluid glowing orb
      const cx = canvas.width * 0.5;
      const cy = canvas.height * 0.72;
      const r = Math.min(canvas.width, canvas.height) * 0.42;

      // Multiple layered radial gradients for depth
      const grad1 = ctx.createRadialGradient(cx, cy, 0, cx, cy, r);
      grad1.addColorStop(0, "rgba(255,255,255,0.10)");
      grad1.addColorStop(0.4, "rgba(180,180,200,0.06)");
      grad1.addColorStop(0.75, "rgba(120,120,160,0.03)");
      grad1.addColorStop(1, "rgba(0,0,0,0)");

      // Animated blob shape via bezier approximation
      ctx.save();
      ctx.globalCompositeOperation = "lighter";

      const pts = 6;
      const angleOffset = t * 0.5;
      ctx.beginPath();
      for (let i = 0; i <= pts; i++) {
        const angle = (i / pts) * Math.PI * 2 + angleOffset;
        const wobble = 1 + 0.08 * Math.sin(t * 2 + i * 1.3);
        const px = cx + Math.cos(angle) * r * wobble;
        const py = cy + Math.sin(angle) * r * 0.38 * wobble;
        if (i === 0) ctx.moveTo(px, py);
        else ctx.lineTo(px, py);
      }
      ctx.closePath();
      ctx.fillStyle = grad1;
      ctx.fill();

      // Bright rim glow
      const rimGrad = ctx.createRadialGradient(cx, cy - r * 0.3, r * 0.1, cx, cy, r);
      rimGrad.addColorStop(0, "rgba(255,255,255,0.18)");
      rimGrad.addColorStop(0.5, "rgba(200,200,230,0.06)");
      rimGrad.addColorStop(1, "rgba(0,0,0,0)");
      ctx.beginPath();
      ctx.arc(cx, cy, r, 0, Math.PI * 2);
      ctx.fillStyle = rimGrad;
      ctx.fill();

      ctx.restore();

      rafRef.current = requestAnimationFrame(draw);
    };

    rafRef.current = requestAnimationFrame(draw);

    return () => {
      cancelAnimationFrame(rafRef.current);
      window.removeEventListener("resize", resize);
      window.removeEventListener("mousemove", onMove);
    };
  }, []);

  return (
    <canvas
      ref={canvasRef}
      className="absolute inset-0 w-full h-full pointer-events-none"
      style={{ opacity: 0.85 }}
    />
  );
}

