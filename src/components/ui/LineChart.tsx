"use client";

import { useEffect, useMemo, useRef, useState } from "react";

// One series over time with a soft area, recessive grid and a hover crosshair.
// Gaps (null values) break the line rather than bridging them.
export default function LineChart({ data, hue, format, axis = format, label, height = 200 }: {
  data: [string, number | null][]; hue: number; format: (v: number) => string; axis?: (v: number) => string; label: string; height?: number;
}) {
  const boxRef = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(0);
  const [hover, setHover] = useState<number | null>(null);
  useEffect(() => {
    const el = boxRef.current!;
    const ro = new ResizeObserver(([e]) => setWidth(e.contentRect.width));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const pad = { t: 12, r: 46, b: 24, l: 2 };
  const geo = useMemo(() => {
    const vals = data.map(d => d[1]).filter((v): v is number => v !== null);
    if (!width || vals.length < 2) return null;
    let lo = Math.min(...vals), hi = Math.max(...vals);
    const span = hi - lo || Math.abs(hi) * 0.1 || 1;
    lo -= span * 0.08; hi += span * 0.08;
    const w = width - pad.l - pad.r, h = height - pad.t - pad.b;
    const x = (i: number) => pad.l + (data.length === 1 ? 0 : (i / (data.length - 1)) * w);
    const y = (v: number) => pad.t + (1 - (v - lo) / (hi - lo)) * h;
    let line = "", area = "", run: [number, number][] = [];
    const flush = () => {
      if (run.length > 1) {
        line += run.map(([px, py], k) => `${k ? "L" : "M"}${px.toFixed(1)},${py.toFixed(1)}`).join("");
        area += `M${run[0][0].toFixed(1)},${pad.t + h}` + run.map(([px, py]) => `L${px.toFixed(1)},${py.toFixed(1)}`).join("") + `L${run[run.length - 1][0].toFixed(1)},${pad.t + h}Z`;
      }
      run = [];
    };
    data.forEach(([, v], i) => (v === null ? flush() : run.push([x(i), y(v)])));
    flush();
    // four round-number gridlines
    const step = niceStep((hi - lo) / 4);
    const ticks: number[] = [];
    for (let t = Math.ceil(lo / step) * step; t <= hi; t += step) ticks.push(t);
    // short ranges name the day, longer ones the month and year
    const days = (asDate(data[data.length - 1][0]).getTime() - asDate(data[0][0]).getTime()) / 864e5;
    const dates = [0, Math.round((data.length - 1) / 2), data.length - 1].map(i => ({ i, d: days < 120 ? dayLabel(data[i][0]) : monthLabel(data[i][0]) }));
    return { x, y, line, area, ticks, dates, h };
  }, [data, width, height, pad.l, pad.r, pad.t, pad.b]);

  const id = `lc-${hue}-${label.replace(/\W/g, "")}`;
  const point = hover !== null ? data[hover] : null;
  const onMove = (e: React.PointerEvent<SVGSVGElement>) => {
    if (!geo) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const frac = (e.clientX - rect.left - pad.l) / (width - pad.l - pad.r);
    let i = Math.round(Math.min(1, Math.max(0, frac)) * (data.length - 1));
    // snap to the nearest day that has a value
    for (let d = 0; d < data.length && data[i][1] === null; d++) {
      if (data[i - d]?.[1] != null) { i -= d; break; }
      if (data[i + d]?.[1] != null) { i += d; break; }
    }
    setHover(data[i][1] === null ? null : i);
  };

  return (
    <div ref={boxRef} className="c-chart" style={{ height }}>
      {geo && (
        <svg width={width} height={height} role="img" aria-label={label}
          onPointerMove={onMove} onPointerDown={onMove} onPointerLeave={() => setHover(null)}>
          <defs>
            <linearGradient id={id} x1="0" x2="0" y1="0" y2="1">
              <stop offset="0%" stopColor={`hsl(${hue} 90% 65%)`} stopOpacity="0.28" />
              <stop offset="100%" stopColor={`hsl(${hue} 90% 65%)`} stopOpacity="0" />
            </linearGradient>
          </defs>
          {geo.ticks.map(t => (
            <g key={t}>
              <line className="c-chart-grid" x1={pad.l} x2={width - pad.r} y1={geo.y(t)} y2={geo.y(t)} />
              <text className="c-chart-tick" x={width - pad.r + 8} y={geo.y(t) + 4}>{axis(t)}</text>
            </g>
          ))}
          {geo.dates.map(({ i, d }, k) => (
            <text key={k} className="c-chart-tick" x={geo.x(i)} y={height - 6} textAnchor={k === 0 ? "start" : k === 2 ? "end" : "middle"}>{d}</text>
          ))}
          <path d={geo.area} fill={`url(#${id})`} />
          <path d={geo.line} fill="none" stroke={`hsl(${hue} 90% 70%)`} strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
          {point && point[1] !== null && (
            <g>
              <line className="c-chart-cross" x1={geo.x(hover!)} x2={geo.x(hover!)} y1={pad.t} y2={pad.t + geo.h} />
              <circle cx={geo.x(hover!)} cy={geo.y(point[1])} r={5} fill={`hsl(${hue} 90% 72%)`} stroke="var(--bg)" strokeWidth={2} />
            </g>
          )}
        </svg>
      )}
      {point && point[1] !== null && geo && (
        <div className="c-chart-tip" style={{ left: Math.min(Math.max(geo.x(hover!), 60), width - 60) }}>
          <span className="c-chart-tip-v">{format(point[1])}</span>
          <span className="c-chart-tip-d">{longDate(point[0])}</span>
        </div>
      )}
    </div>
  );
}

function niceStep(raw: number) {
  const p = Math.pow(10, Math.floor(Math.log10(raw || 1)));
  const n = raw / p;
  return (n < 1.5 ? 1 : n < 3 ? 2 : n < 7 ? 5 : 10) * p;
}
const asDate = (d: string) => new Date(`${d}T12:00:00`);
const dayLabel = (d: string) => asDate(d).toLocaleDateString(undefined, { month: "short", day: "numeric" });
const monthLabel = (d: string) => `${asDate(d).toLocaleDateString(undefined, { month: "short" })} \u2019${d.slice(2, 4)}`;
const longDate = (d: string) => asDate(d).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
