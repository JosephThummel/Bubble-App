"use client";

import { useEffect, useRef } from "react";

type Star = { x: number; y: number; z: number; r: number; tw: number };

// A slow, layered starfield drawn on one canvas. Nearer stars drift and
// parallax more; `warp` increments make the field rush outward briefly,
// which sells the feeling of flying into a bubble.
export default function Starfield({ warp, hue }: { warp: number; hue: number | null }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const warpRef = useRef({ t: 0, dir: 1 });
  const lastWarp = useRef(warp);
  const hueRef = useRef(hue);
  useEffect(() => { hueRef.current = hue; }, [hue]);

  useEffect(() => {
    if (warp !== lastWarp.current) {
      warpRef.current = { t: 1, dir: warp > lastWarp.current ? 1 : -1 };
      lastWarp.current = warp;
    }
  }, [warp]);

  useEffect(() => {
    const canvas = canvasRef.current!;
    const ctx = canvas.getContext("2d")!;
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    let w = 0, h = 0, dpr = 1, raf = 0;
    let stars: Star[] = [];
    const pointer = { x: 0, y: 0, tx: 0, ty: 0 };

    const resize = () => {
      dpr = Math.min(window.devicePixelRatio || 1, 2);
      w = canvas.clientWidth; h = canvas.clientHeight;
      canvas.width = w * dpr; canvas.height = h * dpr;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      const count = Math.round(Math.min(260, (w * h) / 5200));
      stars = Array.from({ length: count }, () => ({
        x: Math.random() * w - w / 2,
        y: Math.random() * h - h / 2,
        z: Math.random() * 0.85 + 0.15, // depth: 1 = near
        r: Math.random() * 1.1 + 0.25,
        tw: Math.random() * Math.PI * 2,
      }));
    };
    const onMove = (e: PointerEvent) => {
      pointer.tx = (e.clientX / w - 0.5) * 2;
      pointer.ty = (e.clientY / h - 0.5) * 2;
    };

    let last = performance.now();
    const frame = (now: number) => {
      const dt = Math.min(48, now - last) / 16.7;
      last = now;
      pointer.x += (pointer.tx - pointer.x) * 0.04 * dt;
      pointer.y += (pointer.ty - pointer.y) * 0.04 * dt;
      const wp = warpRef.current;
      const boost = wp.t > 0 ? Math.pow(wp.t, 2) * 22 * wp.dir : 0;
      if (wp.t > 0) wp.t = Math.max(0, wp.t - 0.028 * dt);

      ctx.clearRect(0, 0, w, h);
      const tint = hueRef.current;
      for (const s of stars) {
        if (!reduce) {
          s.x += 0.02 * s.z * dt;
          if (boost) {
            const len = Math.hypot(s.x, s.y) || 1;
            s.x += (s.x / len) * boost * s.z * dt;
            s.y += (s.y / len) * boost * s.z * dt;
          }
          s.tw += 0.02 * dt;
        }
        // wrap around the edges
        if (s.x > w / 2) s.x -= w; else if (s.x < -w / 2) s.x += w;
        if (s.y > h / 2) s.y -= h; else if (s.y < -h / 2) s.y += h;

        const px = w / 2 + s.x - pointer.x * 14 * s.z;
        const py = h / 2 + s.y - pointer.y * 10 * s.z;
        const a = (0.25 + 0.55 * s.z) * (0.75 + 0.25 * Math.sin(s.tw));
        ctx.fillStyle = tint !== null && s.z > 0.7 ? `hsla(${tint}, 80%, 85%, ${a})` : `rgba(255,255,255,${a})`;
        if (Math.abs(boost) > 2) {
          // streaks during warp
          const len = Math.hypot(s.x, s.y) || 1;
          const k = Math.abs(boost) * s.z * 0.9;
          ctx.strokeStyle = ctx.fillStyle;
          ctx.lineWidth = s.r;
          ctx.beginPath();
          ctx.moveTo(px, py);
          ctx.lineTo(px - (s.x / len) * k * Math.sign(boost), py - (s.y / len) * k * Math.sign(boost));
          ctx.stroke();
        } else {
          ctx.beginPath();
          ctx.arc(px, py, s.r * (0.6 + s.z * 0.6), 0, Math.PI * 2);
          ctx.fill();
        }
      }
      raf = requestAnimationFrame(frame);
    };

    resize();
    window.addEventListener("resize", resize);
    window.addEventListener("pointermove", onMove);
    raf = requestAnimationFrame(frame);
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("resize", resize);
      window.removeEventListener("pointermove", onMove);
    };
  }, []);

  return <canvas ref={canvasRef} className="c-stars" aria-hidden />;
}
