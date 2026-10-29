"use client";

import * as d3 from "d3";
import { useEffect, useMemo, useRef, useState } from "react";
import type { Insight, Item, Link } from "@/lib/graph";

type Props = {
  items: Item[];
  links: Link[];
  insights: Insight[];
  groupOf: (item: Item) => { key: string; hue: number; name: string };
  onOpenItem: (id: string) => void;
  onOpenInsight: (id: string) => void;
};

type N = d3.SimulationNodeDatum & {
  id: string; kind: "item" | "insight"; r: number; hue: number; group: string; label: string; degree: number;
};
type E = d3.SimulationLinkDatum<N> & { id: string; kind: "bond" | "insight"; strength: number; label: string };

const short = (s: string, n = 30) => (s.length > n ? s.slice(0, n - 1).trimEnd() + "…" : s);

// The "space station": every connected note is a node, bonds are springs that pull related
// notes together, and deductions sit between the notes they came from. Notes gather in a
// labeled region per planet (or moon, inside a planet). Drag a node and its bonds stretch;
// scroll or pinch to zoom, drag the background to pan. Notes with no bonds yet stay hidden
// until asked for, so the web shows what connects.
export default function WebView({ items, links, insights, groupOf, onOpenItem, onOpenInsight }: Props) {
  const [loose, setLoose] = useState(false);
  const svgRef = useRef<SVGSVGElement>(null);
  const openItem = useRef(onOpenItem);
  const openInsight = useRef(onOpenInsight);
  // survive re-renders so new bonds grow the web in place instead of re-scattering it
  const placed = useRef(new Map<string, { x: number; y: number }>());
  const view = useRef<d3.ZoomTransform | null>(null);
  useEffect(() => { openItem.current = onOpenItem; openInsight.current = onOpenInsight; }, [onOpenItem, onOpenInsight]);

  const data = useMemo(() => {
    const all = new Set(items.map(i => i.id));
    const groups = new Map<string, { hue: number; name: string }>();
    const degree = new Map<string, number>();
    const tied = new Set<string>();
    for (const l of links) if (all.has(l.a) && all.has(l.b)) { tied.add(l.a); tied.add(l.b); }
    for (const s of insights) {
      const inScope = s.itemIds.filter(id => all.has(id));
      if (inScope.length >= 2) inScope.forEach(id => tied.add(id));
    }
    const shown = loose ? items : items.filter(i => tied.has(i.id));
    const ids = new Set(shown.map(i => i.id));
    const es: E[] = [];
    for (const l of links) {
      if (!ids.has(l.a) || !ids.has(l.b)) continue;
      es.push({ id: l.id, kind: "bond", source: l.a, target: l.b, strength: l.strength, label: l.label });
      degree.set(l.a, (degree.get(l.a) ?? 0) + l.strength);
      degree.set(l.b, (degree.get(l.b) ?? 0) + l.strength);
    }
    const ns: N[] = shown.map(i => {
      const g = groupOf(i);
      groups.set(g.key, { hue: g.hue, name: g.name });
      const d = degree.get(i.id) ?? 0;
      return { id: i.id, kind: "item", r: 8 + Math.min(9, Math.sqrt(d) * 2.6), hue: g.hue, group: g.key, label: short(i.title), degree: d };
    });
    for (const s of insights) {
      const inScope = s.itemIds.filter(id => ids.has(id));
      if (inScope.length < 2) continue;
      ns.push({ id: s.id, kind: "insight", r: 12, hue: 46, group: "", label: short(s.title, 36), degree: 9 });
      for (const id of inScope) es.push({ id: `${s.id}:${id}`, kind: "insight", source: s.id, target: id, strength: 2, label: "" });
    }
    return { nodes: ns, edges: es, groups, hidden: items.length - shown.length, looseCount: items.length - tied.size };
  }, [items, links, insights, groupOf, loose]);

  useEffect(() => {
    // d3 mutates nodes/edges in place, so work on copies of the memoized data
    const nodes = data.nodes.map(n => ({ ...n }));
    const edges = data.edges.map(e => ({ ...e }));
    const groups = data.groups;
    const svg = d3.select(svgRef.current!);
    svg.selectAll("*").remove();
    // layout size, not the bounding rect: the level is mid scale-in when this runs
    const width = svgRef.current!.clientWidth, height = svgRef.current!.clientHeight;
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

    // one gradient per hue, so every node is a small lit sphere
    const defs = svg.append("defs");
    for (const hue of new Set([...nodes.map(n => n.hue), ...[...groups.values()].map(g => g.hue)])) {
      const g = defs.append("radialGradient").attr("id", `w-orb-${hue}`).attr("cx", "35%").attr("cy", "30%").attr("r", "75%");
      g.append("stop").attr("offset", "0%").attr("stop-color", `hsl(${hue} 100% 90%)`);
      g.append("stop").attr("offset", "35%").attr("stop-color", `hsl(${hue} 80% 62%)`);
      g.append("stop").attr("offset", "100%").attr("stop-color", `hsl(${hue} 80% 22%)`);
      const h = defs.append("radialGradient").attr("id", `w-halo-${hue}`);
      h.append("stop").attr("offset", "0%").attr("stop-color", `hsl(${hue} 95% 60% / 0.45)`);
      h.append("stop").attr("offset", "100%").attr("stop-color", `hsl(${hue} 95% 60% / 0)`);
    }

    const world = svg.append("g");
    const regionLayer = world.append("g");
    const edgeLayer = world.append("g");
    const labelLayer = world.append("g");
    const nodeLayer = world.append("g");

    // cluster anchors on a ring, one per group, far enough apart that regions don't overlap
    const keys = [...groups.keys()];
    const ring = keys.length < 2 ? 0 : Math.max(Math.min(width, height) * 0.5, keys.length * 110);
    const anchor = new Map(keys.map((k, i) => [k, {
      x: Math.cos((i / keys.length) * Math.PI * 2 - Math.PI / 2) * ring,
      y: Math.sin((i / keys.length) * Math.PI * 2 - Math.PI / 2) * ring,
    }]));
    const known = placed.current;
    const fresh = new Set<string>();
    for (const n of nodes) {
      const p = known.get(n.id);
      if (p) { n.x = p.x; n.y = p.y; continue; }
      fresh.add(n.id);
      // a newcomer starts beside whatever it bonds to, else at its group's anchor
      const near = edges.flatMap(e => (e.source === n.id ? [e.target] : e.target === n.id ? [e.source] : []))
        .map(id => known.get(id as string)).filter((q): q is { x: number; y: number } => !!q);
      const a = near.length
        ? { x: near.reduce((t, q) => t + q.x, 0) / near.length, y: near.reduce((t, q) => t + q.y, 0) / near.length }
        : anchor.get(n.group) ?? { x: 0, y: 0 };
      n.x = a.x + (Math.random() - 0.5) * 60;
      n.y = a.y + (Math.random() - 0.5) * 60;
    }
    const growing = nodes.length > 0 && fresh.size <= nodes.length / 2;

    // each planet (or moon) is a soft labeled region around its notes
    const region = regionLayer.selectAll<SVGGElement, string>("g").data(keys.filter(k => k && nodes.some(n => n.group === k))).join("g").attr("class", "w-region");
    region.append("circle").attr("fill", k => `hsl(${groups.get(k)!.hue} 80% 60% / 0.05)`).attr("stroke", k => `hsl(${groups.get(k)!.hue} 80% 70% / 0.22)`);
    region.append("text").attr("class", "w-region-label").attr("text-anchor", "middle").attr("fill", k => `hsl(${groups.get(k)!.hue} 90% 80% / 0.75)`).text(k => groups.get(k)!.name);

    const edge = edgeLayer.selectAll<SVGPathElement, E>("path").data(edges).join("path").attr("fill", "none")
      .attr("class", d => `w-edge w-edge-${d.kind}${d.kind === "bond" && d.strength === 3 ? " w-edge-hot" : ""}`)
      .attr("stroke", d => {
        if (d.kind === "insight") return "hsl(46 100% 70% / 0.55)";
        const s = d.source as unknown as string;
        const hue = nodes.find(n => n.id === s)?.hue ?? 232;
        return `hsl(${hue} 90% 75% / ${0.18 + d.strength * 0.14})`;
      })
      .attr("stroke-width", d => (d.kind === "insight" ? 1 : 0.8 + d.strength * 0.7));

    const edgeLabel = labelLayer.selectAll<SVGTextElement, E>("text").data(edges.filter(e => e.kind === "bond" && e.label)).join("text")
      .attr("class", "w-edge-label").attr("text-anchor", "middle").text(d => d.label);

    const node = nodeLayer.selectAll<SVGGElement, N>("g").data(nodes).join("g")
      .attr("class", d => `w-node w-node-${d.kind}${growing && fresh.has(d.id) ? " w-enter" : ""}`)
      .attr("tabindex", 0)
      .attr("role", "button")
      .attr("aria-label", d => d.label);
    node.filter(d => d.kind === "item").append("circle").attr("class", "w-halo").attr("r", d => d.r * 2.6).attr("fill", d => `url(#w-halo-${d.hue})`);
    node.filter(d => d.kind === "item").append("circle").attr("class", "w-core").attr("r", d => d.r).attr("fill", d => `url(#w-orb-${d.hue})`);
    const gem = node.filter(d => d.kind === "insight").append("g").attr("class", "w-gem");
    gem.append("rect").attr("class", "w-gem-glow").attr("x", -16).attr("y", -16).attr("width", 32).attr("height", 32).attr("rx", 8).attr("transform", "rotate(45)");
    gem.append("rect").attr("class", "w-gem-core").attr("x", -7).attr("y", -7).attr("width", 14).attr("height", 14).attr("rx", 3).attr("transform", "rotate(45)");
    // hubs and deductions are always named; the rest on hover or when zoomed in
    node.append("text").attr("class", "w-label")
      .attr("text-anchor", "middle").attr("dy", d => d.r + 16).text(d => d.label);

    // hover: light up a node's neighborhood and show its bond labels
    const neighbors = new Map<string, Set<string>>();
    for (const e of edges) {
      const s = e.source as unknown as string, t = e.target as unknown as string;
      if (!neighbors.has(s)) neighbors.set(s, new Set());
      if (!neighbors.has(t)) neighbors.set(t, new Set());
      neighbors.get(s)!.add(t); neighbors.get(t)!.add(s);
    }
    const focusOn = (id: string | null) => {
      svg.classed("w-dim", !!id);
      const near = id ? neighbors.get(id) ?? new Set<string>() : new Set<string>();
      node.classed("w-lit", d => !!id && (d.id === id || near.has(d.id)));
      const touches = (e: E) => !!id && ((e.source as N).id === id || (e.target as N).id === id);
      edge.classed("w-lit", touches);
      edgeLabel.classed("w-lit", touches);
    };
    node.on("mouseenter", (_, d) => focusOn(d.id)).on("mouseleave", () => focusOn(null))
      .on("keydown", (ev: KeyboardEvent, d) => {
        if (ev.key === "Enter" || ev.key === " ") (d.kind === "item" ? openItem : openInsight).current(d.id);
      });

    const groupOfNode = new Map(nodes.map(n => [n.id, n.group]));
    const cross = (e: E) => {
      const a = typeof e.source === "string" ? e.source : (e.source as N).id, b = typeof e.target === "string" ? e.target : (e.target as N).id;
      return groupOfNode.get(a) !== groupOfNode.get(b);
    };
    const sim = d3.forceSimulation<N>(nodes)
      // bonds inside a region pull hard; bonds across regions stay long, so regions keep apart
      .force("link", d3.forceLink<N, E>(edges).id(d => d.id)
        .distance(e => (e.kind === "insight" ? 60 : cross(e) ? 260 : [0, 150, 115, 85][e.strength]))
        .strength(e => (e.kind === "insight" ? 0.35 : cross(e) ? 0.015 : [0, 0.12, 0.3, 0.6][e.strength])))
      .force("charge", d3.forceManyBody<N>().strength(d => (d.kind === "insight" ? -120 : -260)).distanceMax(420))
      .force("x", d3.forceX<N>(d => anchor.get(d.group)?.x ?? 0).strength(d => (d.kind === "insight" ? 0.01 : 0.16)))
      .force("y", d3.forceY<N>(d => anchor.get(d.group)?.y ?? 0).strength(d => (d.kind === "insight" ? 0.01 : 0.16)))
      .force("collide", d3.forceCollide<N>(d => d.r + 26))
      .alphaDecay(reduce ? 0.2 : 0.025);

    // labels that would collide with a bigger note's label wait for hover or a closer zoom
    const label = node.select<SVGTextElement>("text.w-label");
    let ticks = 0;
    const declutter = () => {
      const k = view.current?.k ?? 1;
      const close = k > 1.25;
      const boxes: { x0: number; x1: number; y0: number; y1: number }[] = [];
      const order = [...nodes].sort((p, q) => q.degree - p.degree);
      const keep = new Set<string>();
      for (const n of order) {
        if (n.kind === "item" && n.degree < 4 && !close) continue;
        const w = (n.label.length * 6.6) / k, h = 16 / k, y = n.y! + n.r + 16 / k;
        const box = { x0: n.x! - w / 2, x1: n.x! + w / 2, y0: y - h, y1: y + 2 / k };
        if (boxes.some(b => b.x0 < box.x1 && box.x0 < b.x1 && b.y0 < box.y1 && box.y0 < b.y1)) continue;
        boxes.push(box);
        keep.add(n.id);
      }
      label.classed("w-label-hidden", d => !keep.has(d.id));
    };

    const zoom = d3.zoom<SVGSVGElement, unknown>().scaleExtent([0.2, 3])
      .on("zoom", ev => {
        view.current = ev.transform;
        world.attr("transform", ev.transform.toString());
        // text keeps its size on screen however far you zoom, and quiet labels appear up close
        svgRef.current?.style.setProperty("--k", String(ev.transform.k));
      })
      .on("end", () => declutter());
    svg.call(zoom).on("dblclick.zoom", null);
    svg.call(zoom.transform, growing && view.current ? view.current : d3.zoomIdentity.translate(width / 2, height / 2));
    if (growing) sim.alpha(0.3);

    let fitted = growing;
    const fit = () => {
      const xs = nodes.map(n => n.x ?? 0), ys = nodes.map(n => n.y ?? 0);
      const [x0, x1, y0, y1] = [Math.min(...xs) - 120, Math.max(...xs) + 120, Math.min(...ys) - 130, Math.max(...ys) + 150];
      const k = Math.min(1.1, width / (x1 - x0), height / (y1 - y0));
      const t = d3.zoomIdentity.translate(width / 2, height / 2).scale(k).translate(-(x0 + x1) / 2, -(y0 + y1) / 2);
      svg.transition().duration(reduce ? 0 : 900).ease(d3.easeCubicInOut).call(zoom.transform, t);
    };

    sim.on("tick", () => {
      // a gentle arc, so bonds between neighbors don't stack into one line
      edge.attr("d", d => {
        const a = d.source as N, b = d.target as N;
        const mx = (a.x! + b.x!) / 2, my = (a.y! + b.y!) / 2, dx = b.x! - a.x!, dy = b.y! - a.y!;
        const bend = d.kind === "insight" ? 0 : 0.12;
        return `M${a.x},${a.y} Q${mx - dy * bend},${my + dx * bend} ${b.x},${b.y}`;
      });
      region.each(function (k) {
        const ms = nodes.filter(n => n.group === k);
        const cx = ms.reduce((t, n) => t + n.x!, 0) / ms.length, cy = ms.reduce((t, n) => t + n.y!, 0) / ms.length;
        const r = Math.max(70, ...ms.map(n => Math.hypot(n.x! - cx, n.y! - cy) + n.r + 34));
        const g = d3.select(this);
        g.select("circle").attr("cx", cx).attr("cy", cy).attr("r", r);
        g.select("text").attr("x", cx).attr("y", cy - r - 10);
      });
      edgeLabel.attr("x", d => { const a = d.source as N, b = d.target as N; return (a.x! + b.x!) / 2 - (b.y! - a.y!) * 0.06; })
        .attr("y", d => { const a = d.source as N, b = d.target as N; return (a.y! + b.y!) / 2 + (b.x! - a.x!) * 0.06 - 4; });
      node.attr("transform", d => `translate(${d.x},${d.y})`);
      if (ticks++ % 8 === 0) declutter();
      for (const n of nodes) known.set(n.id, { x: n.x!, y: n.y! });
      if (!fitted && sim.alpha() < 0.12 && nodes.length) { fitted = true; fit(); }
    });

    // drag a node to feel the bonds pull; a click without movement opens it
    let moved = 0;
    node.call(d3.drag<SVGGElement, N>()
      .on("start", (ev, d) => { moved = 0; if (!ev.active) sim.alphaTarget(0.25).restart(); d.fx = d.x; d.fy = d.y; })
      .on("drag", (ev, d) => { moved += Math.abs(ev.dx) + Math.abs(ev.dy); d.fx = ev.x; d.fy = ev.y; })
      .on("end", (ev, d) => {
        if (!ev.active) sim.alphaTarget(0);
        d.fx = null; d.fy = null;
        if (moved < 4) (d.kind === "item" ? openItem : openInsight).current(d.id);
      }));

    return () => { sim.stop(); };
  }, [data]);

  return (
    <>
      <svg ref={svgRef} className="w-svg" />
      {data.looseCount > 0 && (
        <button className="c-pill w-loose" onClick={() => setLoose(l => !l)} aria-pressed={loose}>
          {loose ? `Hide ${data.looseCount} unconnected ${data.looseCount === 1 ? "note" : "notes"}` : `Show ${data.looseCount} unconnected ${data.looseCount === 1 ? "note" : "notes"}`}
        </button>
      )}
      {data.nodes.length === 0 && (
        <p className="w-empty">No connections here yet. Find connections to draw them.</p>
      )}
    </>
  );
}
