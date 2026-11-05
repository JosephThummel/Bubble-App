"use client";

import { useEffect, useRef } from "react";

type P = { x: number; y: number; vx: number; vy: number; z: number };

// The living background behind the idea web: a faint dot grid and a slow drift of
// particles that link up when they pass near each other, like thoughts finding each
// other. Each `pulse` increment sends a ripple out from the middle, which is what
// moving in or out of a topic feels like.
export default function Backdrop({ pulse, hue }: { pulse: number; hue: number | null }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const ripple = useRef<{ t: number; dir: number }>({ t: 0, dir: 1 });
  const lastPulse = useRef(pulse);
  const hueRef = useRef(hue);
  useEffect(() => { hueRef.current = hue; }, [hue]);

  useEffect(() => {
    if (pulse !== lastPulse.current) {
      ripple.current = { t: 1, dir: pulse > lastPulse.current ? 1 : -1 };
      lastPulse.current = pulse;
    }
  }, [pulse]);

  useEffect(() => {
    const canvas = canvasRef.current!;
    const ctx = canvas.getContext("2d")!;
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    let w = 0, h = 0, dpr = 1, raf = 0;
    let ps: P[] = [];
    const pointer = { x: 0, y: 0, tx: 0, ty: 0 };

    const resize = () => {
      dpr = Math.min(window.devicePixelRatio || 1, 2);
      w = canvas.clientWidth; h = canvas.clientHeight;
      canvas.width = w * dpr; canvas.height = h * dpr;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      const count = Math.round(Math.min(90, (w * h) / 16000));
      ps = Array.from({ length: count }, () => ({
        x: Math.random() * w, y: Math.random() * h,
        vx: (Math.random() - 0.5) * 0.18, vy: (Math.random() - 0.5) * 0.18,
        z: Math.random() * 0.7 + 0.3,
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
      const rp = ripple.current;
      if (rp.t > 0) rp.t = Math.max(0, rp.t - 0.018 * dt);
      const tint = hueRef.current ?? 220;
      ctx.clearRect(0, 0, w, h);

      // dot grid, nudged by the pointer and pushed outward by a ripple
      const gap = 34;
      const ox = -pointer.x * 6, oy = -pointer.y * 4;
      const cx = w / 2, cy = h / 2;
      const front = (1 - rp.t) * Math.hypot(w, h) * 0.6;
      for (let gx = ((ox % gap) + gap) % gap; gx < w; gx += gap) {
        for (let gy = ((oy % gap) + gap) % gap; gy < h; gy += gap) {
          let a = 0.07;
          let x = gx, y = gy;
          if (rp.t > 0) {
            const d = Math.hypot(gx - cx, gy - cy);
            const band = Math.max(0, 1 - Math.abs(d - front) / 70) * rp.t;
            a += band * 0.5;
            const push = band * 6 * rp.dir;
            x += ((gx - cx) / (d || 1)) * push; y += ((gy - cy) / (d || 1)) * push;
          }
          ctx.fillStyle = `hsla(${tint}, 40%, 80%, ${a})`;
          ctx.fillRect(x - 0.6, y - 0.6, 1.2, 1.2);
        }
      }

      // drifting particles that join up when close
      for (const p of ps) {
        if (!reduce) { p.x += p.vx * dt * p.z; p.y += p.vy * dt * p.z; }
        if (p.x < -20) p.x += w + 40; else if (p.x > w + 20) p.x -= w + 40;
        if (p.y < -20) p.y += h + 40; else if (p.y > h + 20) p.y -= h + 40;
      }
      const near = 130;
      ctx.lineWidth = 0.6;
      for (let i = 0; i < ps.length; i++) {
        const a = ps[i];
        const ax = a.x - pointer.x * 12 * a.z, ay = a.y - pointer.y * 9 * a.z;
        for (let j = i + 1; j < ps.length; j++) {
          const b = ps[j];
          const bx = b.x - pointer.x * 12 * b.z, by = b.y - pointer.y * 9 * b.z;
          const d = Math.hypot(ax - bx, ay - by);
          if (d > near) continue;
          ctx.strokeStyle = `hsla(${tint}, 70%, 75%, ${(1 - d / near) * 0.14 * Math.min(a.z, b.z)})`;
          ctx.beginPath(); ctx.moveTo(ax, ay); ctx.lineTo(bx, by); ctx.stroke();
        }
        ctx.fillStyle = `hsla(${tint}, 80%, 82%, ${0.18 + a.z * 0.3})`;
        ctx.beginPath(); ctx.arc(ax, ay, 0.6 + a.z * 1.1, 0, Math.PI * 2); ctx.fill();
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
