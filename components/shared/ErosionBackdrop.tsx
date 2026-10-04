"use client";

import { useEffect, useRef } from "react";

/**
 * Decorative backdrop: a small Gray-Scott reaction-diffusion simulation (the
 * same mathematical family as the erosion engine's own dissolve/diffuse
 * step), rendered as a soft, low-opacity texture behind the UI.
 */
export function ErosionBackdrop() {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d", { alpha: true });
    if (!ctx) return;

    const W = 140;
    const H = 90;
    canvas.width = W;
    canvas.height = H;

    const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

    const size = W * H;
    let u = new Float32Array(size).fill(1);
    let v = new Float32Array(size).fill(0);
    let u2 = new Float32Array(size);
    let v2 = new Float32Array(size);

    const rand = (seed: () => number, n: number) => Math.floor(seed() * n);
    let seedState = 1337;
    const seededRandom = () => {
      seedState = (seedState * 1103515245 + 12345) & 0x7fffffff;
      return seedState / 0x7fffffff;
    };

    const seedBlob = (cx: number, cy: number, r: number) => {
      for (let y = -r; y <= r; y++) {
        for (let x = -r; x <= r; x++) {
          if (x * x + y * y > r * r) continue;
          const px = (cx + x + W) % W;
          const py = (cy + y + H) % H;
          v[py * W + px] = 1;
          u[py * W + px] = 0;
        }
      }
    };
    for (let i = 0; i < 6; i++) {
      seedBlob(rand(seededRandom, W), rand(seededRandom, H), 2 + rand(seededRandom, 3));
    }

    const Du = 1.0;
    const Dv = 0.5;
    const feed = 0.037;
    const kill = 0.06;
    const dt = 1.0;

    const idx = (x: number, y: number) => ((y + H) % H) * W + ((x + W) % W);

    let raf = 0;
    let disposed = false;

    const step = () => {
      for (let y = 0; y < H; y++) {
        for (let x = 0; x < W; x++) {
          const i = y * W + x;
          const lapU =
            u[idx(x - 1, y)] + u[idx(x + 1, y)] + u[idx(x, y - 1)] + u[idx(x, y + 1)] +
            0.05 * (u[idx(x - 1, y - 1)] + u[idx(x + 1, y - 1)] + u[idx(x - 1, y + 1)] + u[idx(x + 1, y + 1)]) -
            4.2 * u[i];
          const lapV =
            v[idx(x - 1, y)] + v[idx(x + 1, y)] + v[idx(x, y - 1)] + v[idx(x, y + 1)] +
            0.05 * (v[idx(x - 1, y - 1)] + v[idx(x + 1, y - 1)] + v[idx(x - 1, y + 1)] + v[idx(x + 1, y + 1)]) -
            4.2 * v[i];
          const uu = u[i];
          const vv = v[i];
          const reaction = uu * vv * vv;
          u2[i] = uu + (Du * lapU - reaction + feed * (1 - uu)) * dt;
          v2[i] = vv + (Dv * lapV + reaction - (feed + kill) * vv) * dt;
        }
      }
      [u, u2] = [u2, u];
      [v, v2] = [v2, v];
    };

    const draw = () => {
      const img = ctx.createImageData(W, H);
      for (let i = 0; i < size; i++) {
        const vv = Math.max(0, Math.min(1, v[i] * 1.6));
        // black base -> faint pink mid -> faint orange peak (no blue), kept dim throughout
        const r = 8 + vv * (196 * 0.55 - 8) * vv + (1 - vv) * 0;
        const g = 8 + vv * 30;
        const b = 8 + vv * 34 * (1 - vv * 0.6);
        const mix = vv; // blend magenta->orange at higher activity
        const rr = r + mix * mix * 60;
        const o = i * 4;
        img.data[o] = Math.min(255, rr);
        img.data[o + 1] = Math.min(255, g);
        img.data[o + 2] = Math.min(255, b);
        img.data[o + 3] = 255;
      }
      ctx.putImageData(img, 0, 0);
    };

    const loop = () => {
      if (disposed) return;
      if (document.visibilityState === "visible") {
        for (let i = 0; i < 4; i++) step();
        draw();
      }
      if (!reduceMotion) {
        raf = requestAnimationFrame(loop);
      }
    };

    draw();
    if (!reduceMotion) {
      raf = requestAnimationFrame(loop);
    } else {
      for (let i = 0; i < 400; i++) step();
      draw();
    }

    return () => {
      disposed = true;
      cancelAnimationFrame(raf);
    };
  }, []);

  return (
    <div
      aria-hidden
      className="pointer-events-none fixed inset-0 -z-10 overflow-hidden bg-background"
    >
      <canvas
        ref={canvasRef}
        className="h-full w-full opacity-[0.16] blur-[3px]"
        style={{ imageRendering: "auto" }}
      />
      <div className="absolute inset-0 bg-gradient-to-b from-background/60 via-transparent to-background" />
      <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_top,transparent,var(--background)_75%)]" />
    </div>
  );
}
