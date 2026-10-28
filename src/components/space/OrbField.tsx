"use client";

import * as d3 from "d3";
import { useEffect, useMemo, useRef, useState } from "react";
import Orb from "./Orb";
import { deepCount, type Bubble, type Item } from "@/lib/graph";

type Props = {
  bubbles: Bubble[]; // the orbs to show at this level
  allBubbles: Bubble[];
  items: Item[];
  pulseId: string | null;
  onOpen: (id: string, origin: { x: number; y: number }) => void;
};

const radiusFor = (n: number) => Math.min(150, 66 + Math.sqrt(n) * 19);
// Sub-topics share their theme's hue, nudged a little apart so siblings read as distinct.
const hueFor = (b: Bubble, seed: number) => (b.parentId === null ? b.hue : b.hue + ((seed % 5) - 2) * 16);

// Lays the orbs out once per set with a force simulation, then scales the whole
// arrangement to fit the viewport.
export default function OrbField({ bubbles, allBubbles, items, pulseId, onOpen }: Props) {
  const boxRef = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ w: 0, h: 0 });

  useEffect(() => {
    const el = boxRef.current!;
    const ro = new ResizeObserver(([e]) => setSize({ w: e.contentRect.width, h: e.contentRect.height }));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // On a tall screen (a phone) stack the orbs in a column so they fill it and stay big.
  const tall = size.h > size.w * 1.15;
  const nodes = useMemo(() => {
    const ns = bubbles.map(b => {
      const n = deepCount(b.id, allBubbles, items);
      // seed positions deterministically so the layout doesn't jump between renders
      const seed = [...b.id].reduce((a, c) => a + c.charCodeAt(0), 0);
      return { id: b.id, b, n, seed, r: radiusFor(n), x: Math.cos(seed) * 80, y: Math.sin(seed) * 80 };
    });
    const sim = d3.forceSimulation(ns as (typeof ns[number] & d3.SimulationNodeDatum)[])
      .force("charge", d3.forceManyBody().strength(-120))
      .force("x", d3.forceX(0).strength(tall ? 0.16 : 0.07))
      .force("y", d3.forceY(0).strength(tall ? 0.035 : 0.11))
      .force("collide", d3.forceCollide<typeof ns[number]>(d => d.r + 54).iterations(4))
      .stop();
    for (let i = 0; i < 300; i++) sim.tick();
    return ns;
  }, [bubbles, allBubbles, items, tall]);

  // fit the padded bounds (labels and the pill below included) to the viewport and center them;
  // a sparse level may grow a little to fill it
  const { scale, cx } = useMemo(() => {
    if (!size.w || !nodes.length) return { scale: 1, cx: { x: 0, y: 0 } };
    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
    for (const n of nodes) {
      minX = Math.min(minX, n.x - n.r - 30); maxX = Math.max(maxX, n.x + n.r + 30);
      minY = Math.min(minY, n.y - n.r - 30); maxY = Math.max(maxY, n.y + n.r + 110);
    }
    return {
      scale: Math.min(1.2, size.w / (maxX - minX), size.h / (maxY - minY)),
      cx: { x: (minX + maxX) / 2, y: (minY + maxY) / 2 },
    };
  }, [nodes, size]);

  return (
    <div ref={boxRef} className="c-field">
      <div className="c-field-inner" style={{ transform: `scale(${scale})` }}>
        {nodes.map((n, i) => (
          <div key={n.id} className="c-slot" style={{ transform: `translate(${n.x - cx.x}px, ${n.y - cx.y}px)` }}>
            <Orb
              name={n.b.name}
              count={n.n}
              hue={hueFor(n.b, n.seed)}
              r={n.r}
              pinned={n.b.pinned}
              satellites={n.n}
              moonCount={allBubbles.filter(x => x.parentId === n.id).length}
              pulse={pulseId === n.id}
              delay={i}
              onOpen={origin => onOpen(n.id, origin)}
            />
          </div>
        ))}
      </div>
    </div>
  );
}
