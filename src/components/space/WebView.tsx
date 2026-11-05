"use client";

import * as d3 from "d3";
import { useEffect, useMemo, useRef, useState } from "react";
import type { Insight, Item, Link, Stance } from "@/lib/graph";

// A topic shown as a hub in the web: a top-level topic, a subtopic, or a saved pitch.
// `center` is the topic you're inside, which sits in the middle with its subtopics around it.
export type Hub = { id: string; name: string; hue: number; count: number; ticker?: string; stance?: Stance; center?: boolean };

type Props = {
  hubs: Hub[];
  items: Item[];
  links: Link[];
  insights: Insight[];
  hubOf: (item: Item) => string;
  hueOf: (item: Item) => number;
  pulseHub: string | null;
  onOpenHub: (id: string, origin: { x: number; y: number }) => void;
  onOpenItem: (id: string) => void;
  onOpenInsight: (id: string) => void;
};

type Kind = "hub" | "item" | "insight";
type N = d3.SimulationNodeDatum & {
  id: string; kind: Kind; r: number; hue: number; hub: string; label: string; sub: string; degree: number;
  ticker?: string; stance?: Stance; center?: boolean;
};
type E = d3.SimulationLinkDatum<N> & { id: string; kind: "spoke" | "bond" | "insight"; strength: number; label: string; quiet?: boolean };

const short = (s: string, n = 30) => (s.length > n ? s.slice(0, n - 1).trimEnd() + "…" : s);
const idOf = (v: string | number | N) => (typeof v === "object" ? v.id : String(v));

// The idea web. Topics are hubs; every note hangs off its topic on a faint spoke, and the
// connections the AI finds between notes are the bright threads that cut across. Deductions
// sit between the notes they came from. New notes and threads draw themselves in, strong
// threads carry a pulse, and clicking a hub flies into that topic. Drag a node and its
// threads stretch; scroll or pinch to zoom, drag the background to pan.
export default function WebView({ hubs, items, links, insights, hubOf, hueOf, pulseHub, onOpenHub, onOpenItem, onOpenInsight }: Props) {
  const svgRef = useRef<SVGSVGElement>(null);
  // by default only the key threads show: each note's two strongest connections, and the newest deductions
  const [all, setAll] = useState(false);
  const cb = useRef({ onOpenHub, onOpenItem, onOpenInsight });
  // survive re-renders so new threads grow the web in place instead of re-scattering it
  const placed = useRef(new Map<string, { x: number; y: number }>());
  const view = useRef<d3.ZoomTransform | null>(null);
  useEffect(() => { cb.current = { onOpenHub, onOpenItem, onOpenInsight }; }, [onOpenHub, onOpenItem, onOpenInsight]);

  const data = useMemo(() => {
    const hubIds = new Set(hubs.map(h => h.id));
    const ids = new Set(items.map(i => i.id));
    const degree = new Map<string, number>();
    const es: E[] = [];
    const inScope = links.filter(l => ids.has(l.a) && ids.has(l.b));
    const keep = new Set<string>();
    if (all) inScope.forEach(l => keep.add(l.id));
    else {
      const per = new Map<string, number>();
      for (const l of [...inScope].sort((p, q) => q.strength - p.strength)) {
        if (l.strength < 2) continue;
        if ((per.get(l.a) ?? 0) >= 2 && (per.get(l.b) ?? 0) >= 2) continue;
        keep.add(l.id);
        per.set(l.a, (per.get(l.a) ?? 0) + 1); per.set(l.b, (per.get(l.b) ?? 0) + 1);
      }
    }
    // threads between different topics stay hidden until you hover one of their notes
    const hubOfId = new Map(items.map(i => [i.id, hubOf(i)]));
    for (const l of inScope) {
      if (!keep.has(l.id)) continue;
      const quiet = !all && hubOfId.get(l.a) !== hubOfId.get(l.b);
      es.push({ id: l.id, kind: "bond", source: l.a, target: l.b, strength: l.strength, label: l.label, quiet });
      degree.set(l.a, (degree.get(l.a) ?? 0) + l.strength);
      degree.set(l.b, (degree.get(l.b) ?? 0) + l.strength);
    }
    const ns: N[] = hubs.map(h => ({
      id: h.id, kind: "hub", hue: h.hue, hub: h.id, degree: 99,
      r: h.center ? 30 : (h.ticker ? 22 : 16) + Math.min(16, Math.sqrt(h.count) * 3),
      label: h.ticker ? `$${h.ticker}` : short(h.name, 28),
      sub: `${h.count} ${h.count === 1 ? "note" : "notes"}`,
      ticker: h.ticker, stance: h.stance, center: h.center,
    }));
    for (const i of items) {
      const hub = hubOf(i);
      const d = degree.get(i.id) ?? 0;
      ns.push({ id: i.id, kind: "item", r: 4.5 + Math.min(7, Math.sqrt(d) * 2), hue: hueOf(i), hub, label: short(i.title), sub: "", degree: d });
      if (hubIds.has(hub)) es.push({ id: `s:${i.id}`, kind: "spoke", source: hub, target: i.id, strength: 0, label: "" });
    }
    const shownInsights = all ? insights : [...insights].sort((p, q) => q.createdAt - p.createdAt).slice(0, 5);
    for (const s of shownInsights) {
      const inScope = s.itemIds.filter(id => ids.has(id));
      if (inScope.length < 2) continue;
      ns.push({ id: s.id, kind: "insight", r: 9, hue: 46, hub: "", label: short(s.title, 36), sub: "", degree: 50 });
      for (const id of inScope) es.push({ id: `${s.id}:${id}`, kind: "insight", source: s.id, target: id, strength: 2, label: "" });
    }
    const total = inScope.length, hidden = total - keep.size + (insights.length - shownInsights.length);
    return { nodes: ns, edges: es, total, hidden };
  }, [hubs, items, links, insights, hubOf, hueOf, all]);

  useEffect(() => {
    // d3 mutates nodes/edges in place, so work on copies of the memoized data
    const nodes = data.nodes.map(n => ({ ...n }));
    const edges = data.edges.map(e => ({ ...e }));
    const svg = d3.select(svgRef.current!);
    svg.selectAll("*").remove();
    // layout size, not the bounding rect: the level is mid scale-in when this runs
    const width = svgRef.current!.clientWidth, height = svgRef.current!.clientHeight;
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const byId = new Map(nodes.map(n => [n.id, n]));

    const defs = svg.append("defs");
    for (const hue of new Set(nodes.map(n => n.hue))) {
      const h = defs.append("radialGradient").attr("id", `w-halo-${hue}`);
      h.append("stop").attr("offset", "0%").attr("stop-color", `hsl(${hue} 95% 62% / 0.5)`);
      h.append("stop").attr("offset", "100%").attr("stop-color", `hsl(${hue} 95% 62% / 0)`);
    }

    const world = svg.append("g");
    const edgeLayer = world.append("g");
    const flowLayer = world.append("g");
    const labelLayer = world.append("g");
    const nodeLayer = world.append("g");

    // hubs sit on a ring around the middle (or around the topic you're inside)
    const outer = nodes.filter(n => n.kind === "hub" && !n.center);
    const ring = outer.length < 2 ? 0 : Math.max(Math.min(width, height) * 0.6, outer.length * 105, 260);
    const anchor = new Map<string, { x: number; y: number }>();
    outer.forEach((n, i) => anchor.set(n.id, {
      x: Math.cos((i / outer.length) * Math.PI * 2 - Math.PI / 2) * ring,
      y: Math.sin((i / outer.length) * Math.PI * 2 - Math.PI / 2) * ring,
    }));
    for (const n of nodes) if (n.center) anchor.set(n.id, { x: 0, y: 0 });

    const known = placed.current;
    const fresh = new Set<string>();
    for (const n of nodes) {
      const p = known.get(n.id);
      if (p) { n.x = p.x; n.y = p.y; continue; }
      fresh.add(n.id);
      // a newcomer starts at its hub, or beside whatever it connects to
      const near = edges.flatMap(e => (e.source === n.id ? [e.target] : e.target === n.id ? [e.source] : []))
        .map(id => known.get(id as string) ?? anchor.get(id as string)).filter((q): q is { x: number; y: number } => !!q);
      const a = anchor.get(n.id) ?? anchor.get(n.hub) ?? (near.length
        ? { x: near.reduce((t, q) => t + q.x, 0) / near.length, y: near.reduce((t, q) => t + q.y, 0) / near.length }
        : { x: 0, y: 0 });
      n.x = a.x + (Math.random() - 0.5) * 40;
      n.y = a.y + (Math.random() - 0.5) * 40;
    }
    const growing = nodes.length > 0 && fresh.size <= nodes.length / 2;
    const isNew = (id: string) => !growing || fresh.has(id);

    // threads: faint spokes to the topic, bright bonds between notes, gold lines to deductions
    const edge = edgeLayer.selectAll<SVGPathElement, E>("path").data(edges).join("path").attr("fill", "none")
      .attr("class", d => `w-edge w-edge-${d.kind}${d.kind === "bond" && d.strength === 3 ? " w-edge-hot" : ""}${d.quiet ? " w-quiet" : ""}`)
      .attr("stroke", d => {
        if (d.kind === "insight") return "hsl(46 100% 70% / 0.55)";
        const hue = byId.get(idOf(d.target))?.hue ?? 220;
        if (d.kind === "spoke") return `hsl(${hue} 50% 70% / 0.13)`;
        return `hsl(${hue} 90% 72% / ${0.25 + d.strength * 0.15})`;
      })
      .attr("stroke-width", d => (d.kind === "spoke" ? 0.8 : d.kind === "insight" ? 1 : 0.9 + d.strength * 0.6));
    // new threads draw themselves in, a few at a time
    let drawn = 0;
    edge.filter(d => d.kind !== "insight" && (isNew(idOf(d.source)) || isNew(idOf(d.target))))
      .attr("pathLength", 1).classed("w-draw", true)
      .style("animation-delay", d => `${Math.min(1.6, (d.kind === "spoke" ? 0.15 : 0.5) + drawn++ * 0.012)}s`);

    // strong threads carry a traveling pulse
    const flowEdges = edges.filter(e => (e.kind === "bond" && e.strength >= 2 && !e.quiet) || e.kind === "insight");
    const flow = flowLayer.selectAll<SVGPathElement, E>("path").data(flowEdges).join("path").attr("fill", "none")
      .attr("class", d => `w-flow${d.kind === "insight" ? " w-flow-gold" : ""}`).attr("pathLength", 1)
      .attr("stroke", d => (d.kind === "insight" ? "hsl(48 100% 85%)" : `hsl(${byId.get(idOf(d.target))?.hue ?? 220} 100% 88%)`))
      .style("animation-duration", (_, i) => `${2.4 + (i % 5) * 0.5}s`)
      .style("animation-delay", (_, i) => `${(i * 0.37) % 3}s`);

    const edgeLabel = labelLayer.selectAll<SVGTextElement, E>("text").data(edges.filter(e => e.kind === "bond" && e.label)).join("text")
      .attr("class", "w-edge-label").attr("text-anchor", "middle").text(d => d.label);

    const node = nodeLayer.selectAll<SVGGElement, N>("g").data(nodes).join("g")
      .attr("class", d => `w-node w-node-${d.kind}${d.center ? " w-node-center" : ""}${isNew(d.id) ? " w-enter" : ""}${d.id === pulseHub ? " w-ping" : ""}`)
      .attr("tabindex", d => (d.center ? -1 : 0))
      .attr("role", "button")
      .attr("aria-label", d => (d.kind === "hub" ? `${d.label}, ${d.sub}` : d.label))
      .style("--h", d => String(d.hue))
      .style("animation-delay", d => (d.kind === "hub" ? "0s" : `${Math.min(1.2, 0.1 + Math.random() * 0.8)}s`));

    // hubs: a glowing ring with a slowly turning dashed orbit around it
    const hub = node.filter(d => d.kind === "hub");
    hub.append("circle").attr("class", "w-halo").attr("r", d => d.r * 2.4).attr("fill", d => `url(#w-halo-${d.hue})`);
    hub.append("circle").attr("class", "w-hub-orbit").attr("r", d => d.r + 7);
    hub.append("circle").attr("class", "w-hub-core").attr("r", d => d.r);
    hub.filter(d => !d.ticker).append("circle").attr("class", "w-hub-dot").attr("r", d => Math.max(3, d.r * 0.22));
    hub.filter(d => !!d.ticker).append("text").attr("class", "w-hub-ticker").attr("text-anchor", "middle").attr("dy", "0.35em")
      .attr("font-size", d => Math.max(9, Math.min(15, (d.r * 1.7) / Math.max(3, d.ticker!.length)))).text(d => d.ticker!);
    hub.filter(d => !!d.stance && d.stance !== "watch").append("circle").attr("class", d => `w-hub-stance is-${d.stance}`)
      .attr("cx", d => d.r * 0.72).attr("cy", d => -d.r * 0.72).attr("r", 4);

    // notes: a small lit dot
    const item = node.filter(d => d.kind === "item");
    item.append("circle").attr("class", "w-halo").attr("r", d => d.r * 2.8).attr("fill", d => `url(#w-halo-${d.hue})`);
    item.append("circle").attr("class", "w-core").attr("r", d => d.r);
    // a finger-sized target around small notes
    node.filter(d => d.kind !== "hub").append("circle").attr("class", "w-hit").attr("r", d => Math.max(d.r + 6, 14));

    // deductions: a gold diamond
    const gem = node.filter(d => d.kind === "insight").append("g").attr("class", "w-gem");
    gem.append("rect").attr("class", "w-gem-glow").attr("x", -14).attr("y", -14).attr("width", 28).attr("height", 28).attr("rx", 7).attr("transform", "rotate(45)");
    gem.append("rect").attr("class", "w-gem-core").attr("x", -6).attr("y", -6).attr("width", 12).attr("height", 12).attr("rx", 2.5).attr("transform", "rotate(45)");

    // y is in world units and dy in ems, so labels clear the node at any zoom without overlapping each other
    node.append("text").attr("class", "w-label").attr("text-anchor", "middle").attr("y", d => d.r + 4).attr("dy", "1em").text(d => (d.kind === "hub" && d.ticker ? `${d.label}${d.stance && d.stance !== "watch" ? ` · ${d.stance}` : ""}` : d.label));
    hub.append("text").attr("class", "w-sub").attr("text-anchor", "middle").attr("y", d => d.r + 4).attr("dy", "2.75em").text(d => d.sub);

    // hover: light up a node's neighborhood and show what each thread means
    const neighbors = new Map<string, Set<string>>();
    for (const e of edges) {
      const s = idOf(e.source), t = idOf(e.target);
      if (!neighbors.has(s)) neighbors.set(s, new Set());
      if (!neighbors.has(t)) neighbors.set(t, new Set());
      neighbors.get(s)!.add(t); neighbors.get(t)!.add(s);
    }
    const focusOn = (id: string | null) => {
      svg.classed("w-dim", !!id);
      const near = id ? neighbors.get(id) ?? new Set<string>() : new Set<string>();
      node.classed("w-lit", d => !!id && (d.id === id || near.has(d.id)));
      const touches = (e: E) => !!id && (idOf(e.source) === id || idOf(e.target) === id);
      edge.classed("w-lit", touches);
      flow.classed("w-lit", touches);
      edgeLabel.classed("w-lit", touches);
    };
    const open = (ev: Event, d: N) => {
      if (d.center) return;
      if (d.kind === "hub") {
        const r = (ev.currentTarget as Element | null)?.getBoundingClientRect?.();
        cb.current.onOpenHub(d.id, r ? { x: r.left + r.width / 2, y: r.top + r.height / 2 } : { x: width / 2, y: height / 2 });
      } else if (d.kind === "item") cb.current.onOpenItem(d.id);
      else cb.current.onOpenInsight(d.id);
    };
    node.on("mouseenter", (_, d) => focusOn(d.id)).on("mouseleave", () => focusOn(null))
      .on("keydown", (ev: KeyboardEvent, d) => { if (ev.key === "Enter" || ev.key === " ") { ev.preventDefault(); open(ev, d); } });

    const hubOfNode = new Map(nodes.map(n => [n.id, n.hub]));
    const cross = (e: E) => hubOfNode.get(idOf(e.source)) !== hubOfNode.get(idOf(e.target));
    const sim = d3.forceSimulation<N>(nodes)
      .force("link", d3.forceLink<N, E>(edges).id(d => d.id)
        .distance(e => {
          if (e.kind === "spoke") return 70 + (byId.get(idOf(e.source))?.r ?? 20) + Math.random() * 50;
          if (e.kind === "insight") return 55;
          return cross(e) ? 300 : [0, 120, 95, 70][e.strength];
        })
        // spokes keep notes near their topic; bonds across topics stay loose so topics keep apart
        .strength(e => (e.kind === "spoke" ? 0.18 : e.kind === "insight" ? 0.3 : cross(e) ? 0.008 : [0, 0.1, 0.25, 0.5][e.strength])))
      .force("charge", d3.forceManyBody<N>().strength(d => (d.kind === "hub" ? -700 : d.kind === "insight" ? -120 : -90)).distanceMax(380))
      .force("x", d3.forceX<N>(d => anchor.get(d.id)?.x ?? anchor.get(d.hub)?.x ?? 0).strength(d => (d.kind === "hub" ? 0.5 : d.kind === "insight" ? 0.01 : 0.05)))
      .force("y", d3.forceY<N>(d => anchor.get(d.id)?.y ?? anchor.get(d.hub)?.y ?? 0).strength(d => (d.kind === "hub" ? 0.5 : d.kind === "insight" ? 0.01 : 0.05)))
      .force("collide", d3.forceCollide<N>(d => d.r + (d.kind === "hub" ? 46 : 14)))
      .alphaDecay(reduce ? 0.2 : 0.022);

    // hubs and deductions are always named; notes by importance, then on hover or up close
    const label = node.select<SVGTextElement>("text.w-label");
    let ticks = 0;
    const declutter = () => {
      const k = view.current?.k ?? 1;
      const close = k > 1.4;
      const boxes: { x0: number; x1: number; y0: number; y1: number }[] = [];
      const order = [...nodes].sort((p, q) => q.degree - p.degree);
      const keep = new Set<string>();
      for (const n of order) {
        if (n.kind === "item" && n.degree < 5 && !close) continue;
        const w = (n.label.length * 6.6) / k, h = 16 / k, y = n.y! + n.r + 16 / k;
        const box = { x0: n.x! - w / 2, x1: n.x! + w / 2, y0: y - h, y1: y + 2 / k };
        if (n.kind === "item" && boxes.some(b => b.x0 < box.x1 && box.x0 < b.x1 && b.y0 < box.y1 && box.y0 < b.y1)) continue;
        boxes.push(box);
        keep.add(n.id);
      }
      label.classed("w-label-hidden", d => !keep.has(d.id));
    };

    const zoom = d3.zoom<SVGSVGElement, unknown>().scaleExtent([0.15, 3.5])
      .on("zoom", ev => {
        view.current = ev.transform;
        world.attr("transform", ev.transform.toString());
        // text keeps its size on screen however far you zoom
        svgRef.current?.style.setProperty("--k", String(ev.transform.k));
      })
      .on("end", () => declutter());
    svg.call(zoom).on("dblclick.zoom", null);
    svg.call(zoom.transform, growing && view.current ? view.current : d3.zoomIdentity.translate(width / 2, height / 2).scale(Math.min(0.9, Math.min(width, height) / (2 * ring + 320))));
    if (growing) sim.alpha(0.3);

    let fitted = growing;
    const fit = () => {
      const xs = nodes.map(n => n.x ?? 0), ys = nodes.map(n => n.y ?? 0);
      const [x0, x1, y0, y1] = [Math.min(...xs) - 110, Math.max(...xs) + 110, Math.min(...ys) - 90, Math.max(...ys) + 120];
      const k = Math.min(1.15, width / (x1 - x0), height / (y1 - y0));
      const t = d3.zoomIdentity.translate(width / 2, height / 2).scale(k).translate(-(x0 + x1) / 2, -(y0 + y1) / 2);
      svg.transition().duration(reduce ? 0 : 1100).ease(d3.easeCubicInOut).call(zoom.transform, t);
    };

    const path = (d: E) => {
      const a = d.source as N, b = d.target as N;
      const mx = (a.x! + b.x!) / 2, my = (a.y! + b.y!) / 2, dx = b.x! - a.x!, dy = b.y! - a.y!;
      // a gentle arc, so threads between neighbors don't stack into one line
      const bend = d.kind === "bond" ? 0.14 : 0;
      return `M${a.x},${a.y} Q${mx - dy * bend},${my + dx * bend} ${b.x},${b.y}`;
    };
    sim.on("tick", () => {
      edge.attr("d", path);
      flow.attr("d", path);
      edgeLabel.attr("x", d => { const a = d.source as N, b = d.target as N; return (a.x! + b.x!) / 2 - (b.y! - a.y!) * 0.07; })
        .attr("y", d => { const a = d.source as N, b = d.target as N; return (a.y! + b.y!) / 2 + (b.x! - a.x!) * 0.07 - 4; });
      node.attr("transform", d => `translate(${d.x},${d.y})`);
      if (ticks++ % 8 === 0) declutter();
      for (const n of nodes) known.set(n.id, { x: n.x!, y: n.y! });
      if (!fitted && sim.alpha() < 0.1 && nodes.length) { fitted = true; fit(); }
    });
    // the web keeps settling after the first fit, so frame it once more when it comes to rest
    if (!growing) sim.on("end.fit", () => { sim.on("end.fit", null); fit(); });

    // drag a node to feel its threads pull; a click without movement opens it
    let moved = 0;
    node.call(d3.drag<SVGGElement, N>()
      .on("start", (ev, d) => { moved = 0; if (!ev.active) sim.alphaTarget(0.25).restart(); d.fx = d.x; d.fy = d.y; })
      .on("drag", (ev, d) => { moved += Math.abs(ev.dx) + Math.abs(ev.dy); d.fx = ev.x; d.fy = ev.y; })
      .on("end", function (ev, d) {
        if (!ev.active) sim.alphaTarget(0);
        d.fx = null; d.fy = null;
        if (moved < 4) open({ currentTarget: this } as unknown as Event, d);
      }));

    return () => { sim.stop(); };
  }, [data, pulseHub]);

  return (
    <>
      <svg ref={svgRef} className="w-svg" />
      {(data.hidden > 0 || all) && (
        <button className="c-pill w-loose" onClick={() => setAll(a => !a)} aria-pressed={all}>
          {all ? "Show key connections only" : `Show all ${data.total} connections`}
        </button>
      )}
    </>
  );
}
