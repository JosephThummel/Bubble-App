"use client";

import { AnimatePresence, MotionConfig, motion, type Variants } from "motion/react";
import { ArrowLeft, Bookmark, BookmarkMinus, FileUp, Gem, Link2, Lock, LogOut, PencilLine, Plus, Search, Sparkles, StickyNote, Trash2, Wand2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import ItemGrid from "@/components/space/ItemGrid";
import ListView from "@/components/space/ListView";
import OrbField from "@/components/space/OrbField";
import Starfield from "@/components/space/Starfield";
import WebView from "@/components/space/WebView";
import AddSheet from "@/components/ui/AddSheet";
import AskSheet from "@/components/ui/AskSheet";
import CommandPalette from "@/components/ui/CommandPalette";
import { ConfirmDialog, CoverDialog, MoveDialog, NameDialog } from "@/components/ui/Dialogs";
import Island from "@/components/ui/Island";
import InsightPanel from "@/components/ui/InsightPanel";
import InsightsSheet from "@/components/ui/InsightsSheet";
import ItemPanel from "@/components/ui/ItemPanel";
import StockPanel from "@/components/ui/StockPanel";
import StockDashboard from "@/components/stock/StockDashboard";
import Sheet from "@/components/ui/Sheet";
import ViewSwitch, { type ViewMode } from "@/components/ui/ViewSwitch";
import { useConstellation } from "@/hooks/useConstellation";
import { findLinks, looksLikeLinkList } from "@/lib/files";
import { deepCount, descendantsOf, ideasOf, isStock, pathLabel, pitchesOf, readsFor, stockOf, trailOf, type Graph, type Item } from "@/lib/graph";
import { signOut } from "@/lib/storage";
import { supabaseEnabled } from "@/lib/supabase/config";

type Nav = { dir: 1 | -1; ox: number; oy: number };

// Levels zoom like a camera: going in, the old level rushes past toward the
// bubble you clicked while the new one grows out of the distance.
const levelVariants: Variants = {
  enter: (n: Nav) => ({ opacity: 0, scale: n.dir > 0 ? 0.55 : 1.6 }),
  center: { opacity: 1, scale: 1, transition: { type: "spring", stiffness: 110, damping: 20, mass: 1 } },
  exit: (n: Nav) => ({
    opacity: 0,
    scale: n.dir > 0 ? 2.4 : 0.55,
    originX: n.ox,
    originY: n.oy,
    transition: { duration: 0.5, ease: [0.4, 0, 0.2, 1] },
  }),
};

type Dialog =
  | { kind: "none" }
  | { kind: "create"; parentId: string | null }
  | { kind: "rename"; id: string }
  | { kind: "delete"; id: string }
  | { kind: "move"; itemId: string }
  | { kind: "deleteItem"; itemId: string }
  | { kind: "loose" }
  | { kind: "reorganize" }
  | { kind: "unsave"; id: string }
  | { kind: "cover"; ticker?: string; name?: string; itemId?: string; stance?: "long" | "short" };

export default function Constellation() {
  const router = useRouter();
  const c = useConstellation();
  // the focused bubble lives in the URL (?b=…) so it can be linked to and Back zooms out
  const [focusId, setFocusId] = useState<string | null>(() =>
    typeof window === "undefined" ? null : new URLSearchParams(window.location.search).get("b"));
  const [nav, setNav] = useState<Nav>({ dir: 1, ox: 0.5, oy: 0.5 });
  const [warp, setWarp] = useState(0);
  const [adding, setAdding] = useState(false);
  const [searching, setSearching] = useState(false);
  const [openItemId, setOpenItemId] = useState<string | null>(null);
  const [openInsightId, setOpenInsightId] = useState<string | null>(null);
  const [stockSymbol, setStockSymbol] = useState<string | null>(null);
  const [insightsOpen, setInsightsOpen] = useState(false);
  const [askOpen, setAskOpen] = useState(false);
  const [askScope, setAskScope] = useState<string | null>(null);
  const [askPending, setAskPending] = useState<string | null>(null);
  // a citation opens its note; closing the note goes back to the answer
  const [backToAsk, setBackToAsk] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [notice, setNotice] = useState("");
  const [mode, setMode] = useState<ViewMode>("orbits");
  const [dialog, setDialog] = useState<Dialog>({ kind: "none" });
  // the space as it was before a reorganize, offered back for a while as Undo
  const [undoPlan, setUndoPlan] = useState<Graph | null>(null);
  const stageRef = useRef<HTMLDivElement>(null);

  const bubbles = useMemo(() => c.graph?.bubbles ?? [], [c.graph]);
  const items = useMemo(() => c.graph?.items ?? [], [c.graph]);
  // A deleted or merged-away bubble can't stay focused: fall back to the top.
  const focus = bubbles.find(b => b.id === focusId) ?? null;
  const fid = focus ? focus.id : null;
  const trail = useMemo(() => trailOf(fid, bubbles), [fid, bubbles]);
  const children = useMemo(() => bubbles.filter(b => b.parentId === fid), [bubbles, fid]);
  const here = useMemo(() => items.filter(i => i.bubbleId === fid), [items, fid]);
  const openItem = items.find(i => i.id === openItemId) ?? null;
  const links = useMemo(() => c.graph?.links ?? [], [c.graph]);
  const insights = useMemo(() => c.graph?.insights ?? [], [c.graph]);
  const openInsight = insights.find(s => s.id === openInsightId) ?? null;
  // Everything under the focused bubble, for the web view.
  const scopeItems = useMemo(() => {
    if (!fid) return items;
    const scope = new Set([fid, ...descendantsOf(fid, bubbles)]);
    return items.filter(i => scope.has(i.bubbleId));
  }, [items, bubbles, fid]);
  // In the web, notes cluster by the bubble one level below the focus.
  const groupOf = useCallback((it: Item) => {
    const t = trailOf(it.bubbleId, bubbles);
    const depth = fid ? trailOf(fid, bubbles).length : 0;
    const g = t[depth] ?? t[t.length - 1];
    return { key: g?.id ?? "", hue: g?.hue ?? 232, name: g?.name ?? "" };
  }, [bubbles, fid]);
  const unlinked = scopeItems.filter(i => !i.linkedAt).length;

  const zoomTo = useCallback((id: string | null, origin?: { x: number; y: number }) => {
    const depth = (x: string | null) => trailOf(x, bubbles).length;
    const dir = depth(id) >= depth(fid) && id !== null ? 1 : -1;
    const rect = stageRef.current?.getBoundingClientRect();
    const ox = origin && rect ? (origin.x - rect.left) / rect.width : 0.5;
    const oy = origin && rect ? (origin.y - rect.top) / rect.height : 0.5;
    setNav({ dir, ox, oy });
    setWarp(w => w + dir);
    setFocusId(id);
  }, [bubbles, fid]);
  const go = useCallback((id: string | null, origin?: { x: number; y: number }) => {
    if (id === fid) return;
    zoomTo(id, origin);
    window.history.pushState(null, "", id ? `?b=${encodeURIComponent(id)}` : window.location.pathname);
  }, [fid, zoomTo]);

  useEffect(() => {
    const onPop = () => zoomTo(new URLSearchParams(window.location.search).get("b"));
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, [zoomTo]);

  useEffect(() => {
    document.title = focus ? `${focus.name} – Constellation` : "Constellation";
  }, [focus]);

  // Keyboard: ⌘K or / to search, Esc to go up a level.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const typing = e.target instanceof HTMLElement && /input|textarea/i.test(e.target.tagName);
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") { e.preventDefault(); setSearching(s => !s); return; }
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "j") { e.preventDefault(); setAskScope(fid); setAskOpen(o => !o); return; }
      if (typing || adding || searching || askOpen || openItemId || openInsightId || stockSymbol || insightsOpen || dialog.kind !== "none") return;
      if (e.key === "/") { e.preventDefault(); setSearching(true); }
      else if (e.key === "Escape" && focus) go(focus.parentId);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [adding, searching, askOpen, openItemId, openInsightId, stockSymbol, insightsOpen, dialog, focus, fid, go]);

  const { addFiles, addContent, reorganizeSpace } = c;
  const runReorganize = useCallback(async () => {
    go(null);
    const r = await reorganizeSpace();
    if (r.error) setNotice(r.error);
    if (r.before) {
      const before = r.before;
      setUndoPlan(before);
      setTimeout(() => setUndoPlan(u => (u === before ? null : u)), 30000);
    }
  }, [reorganizeSpace, go]);
  const showNotice = useCallback((err: string) => {
    if (err) { setNotice(err); setTimeout(() => setNotice(n => (n === err ? "" : n)), 10000); }
  }, []);
  const takeFiles = useCallback(async (files: File[]) => showNotice(await addFiles(files)), [addFiles, showNotice]);
  // A pasted list of links imports in the background, so the sheet closes right away.
  const submitText = useCallback(async (text: string) => {
    if (!looksLikeLinkList(text, findLinks(text))) return addContent(text);
    setAdding(false);
    addContent(text).then(showNotice);
    return "";
  }, [addContent, showNotice]);

  // Drag files anywhere over the app to save them.
  useEffect(() => {
    let depth = 0;
    const hasFiles = (e: DragEvent) => !!e.dataTransfer && [...e.dataTransfer.types].includes("Files");
    const enter = (e: DragEvent) => { if (!hasFiles(e)) return; e.preventDefault(); depth++; setDragging(true); };
    const over = (e: DragEvent) => { if (hasFiles(e)) e.preventDefault(); };
    const leave = (e: DragEvent) => { if (!hasFiles(e)) return; depth = Math.max(0, depth - 1); if (!depth) setDragging(false); };
    const drop = (e: DragEvent) => {
      if (!hasFiles(e)) return;
      e.preventDefault(); depth = 0; setDragging(false);
      const files = [...(e.dataTransfer?.files ?? [])];
      if (files.length) { setAdding(false); takeFiles(files); }
    };
    window.addEventListener("dragenter", enter);
    window.addEventListener("dragover", over);
    window.addEventListener("dragleave", leave);
    window.addEventListener("drop", drop);
    return () => {
      window.removeEventListener("dragenter", enter);
      window.removeEventListener("dragover", over);
      window.removeEventListener("dragleave", leave);
      window.removeEventListener("drop", drop);
    };
  }, [takeFiles]);

  if (!c.graph) {
    return (
      <div className="c-root c-boot">
        <Starfield warp={0} hue={null} />
        {c.loadError ? <p className="c-boot-error">{c.loadError}</p> : <span className="c-boot-mark">✦</span>}
      </div>
    );
  }

  const total = items.length;
  const pitches = pitchesOf(bubbles);
  const themes = bubbles.filter(b => b.parentId === null && b.id !== pitches?.id).length;
  const covered = bubbles.filter(isStock).length;
  const isPitches = !!focus && focus.id === pitches?.id;
  const ideaCount = items.filter(i => i.bubbleId === ideasOf(bubbles)?.id).length;
  const showOrbs = children.length > 0;
  const isTheme = focus?.parentId === null;
  const hue = focus?.hue ?? null;
  const pulseId = c.activity.kind === "filed" ? c.activity.bubbleId : null;
  const panelHue = openItem ? bubbles.find(b => b.id === openItem.bubbleId)?.hue ?? 232 : 232;
  const dialogBubble = dialog.kind === "rename" || dialog.kind === "delete" ? bubbles.find(b => b.id === dialog.id) : null;
  const unsaving = dialog.kind === "unsave" ? bubbles.filter(isStock).find(b => b.id === dialog.id) : undefined;
  const dialogItem = dialog.kind === "move" || dialog.kind === "deleteItem" ? items.find(i => i.id === dialog.itemId) : null;
  const closeDialog = () => setDialog({ kind: "none" });

  const jumpToItem = (it: Item) => { go(it.bubbleId); setTimeout(() => setOpenItemId(it.id), 350); };
  // A ticker you cover opens its planet; any other opens a quick look.
  const openTicker = (t: string) => {
    const covered = stockOf(t, bubbles);
    setOpenItemId(null);
    if (covered) { setStockSymbol(null); go(covered.id); } else setStockSymbol(t);
  };
  const stockFocus = isStock(focus) ? focus : null;
  const readCount = stockFocus ? readsFor(stockFocus.ticker, items, stockFocus.id).length : 0;

  return (
    <MotionConfig reducedMotion="user">
    <div className="c-root" style={{ "--h": hue ?? 232, "--tint": hue === null ? 0 : 1 } as CSSProperties}>
      <Starfield warp={warp} hue={hue} />
      <div className="c-nebula" aria-hidden />

      <header className="c-bar glass">
        <button className="c-brand" onClick={() => go(null)} aria-label="Home">
          <span className="c-brand-mark">✦</span>
          <span className="c-brand-word">Constellation</span>
        </button>
        <button className="c-search-btn" onClick={() => setSearching(true)}>
          <Search size={15} />
          <span>Search</span>
          <kbd>⌘K</kbd>
        </button>
        <div className="c-bar-end">
          <motion.button className="c-ask-btn" whileTap={{ scale: 0.95 }} onClick={() => { setAskScope(fid); setAskOpen(true); }} title="Ask (⌘J)">
            <Sparkles size={15} /> <span>Ask</span>
          </motion.button>
          <button className="c-icon-btn c-gem-btn" title="Ideas" aria-label={`Ideas, ${insights.length}`} onClick={() => setInsightsOpen(true)}>
            <Gem size={16} />
            {insights.length > 0 && <span className="c-badge">{insights.length}</span>}
          </button>
          <motion.button className="c-btn c-btn-primary c-save-btn" whileTap={{ scale: 0.95 }} onClick={() => setAdding(true)}>
            <Plus size={16} strokeWidth={2.4} /> <span>Save</span>
          </motion.button>
          {supabaseEnabled && (
            <button className="c-icon-btn" title="Sign out" aria-label="Sign out"
              onClick={async () => { await signOut(); router.replace("/login"); router.refresh(); }}>
              <LogOut size={16} />
            </button>
          )}
        </div>
      </header>

      <Island activity={c.activity} onJump={id => go(id)} onOpenInsight={setOpenInsightId} onOpenItem={setOpenItemId} />

      <AnimatePresence mode="wait" initial={false}>
        <motion.section
          key={fid ?? "root"}
          className="c-hero"
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0, transition: { type: "spring", stiffness: 260, damping: 26, delay: 0.12 } }}
          exit={{ opacity: 0, y: -8, transition: { duration: 0.15 } }}
        >
          <div className="c-crumbs">
            {focus ? (
              <>
                <button className="c-back" onClick={() => go(focus.parentId)} aria-label="Back"><ArrowLeft size={16} /></button>
                <button className="c-crumb" onClick={() => go(null)}>Space</button>
                {trail.slice(0, -1).map(b => (
                  <span key={b.id} className="c-crumb-row">
                    <span className="c-crumb-sep">/</span>
                    <button className="c-crumb" onClick={() => go(b.id)}>{b.name}</button>
                  </span>
                ))}
              </>
            ) : null}
          </div>
          <h1 className="c-title">{focus ? focus.name : "Everything you're tracking"}</h1>
          <div className="c-hero-row">
            <span className="c-meta">
              {stockFocus
                ? [`$${stockFocus.ticker}`, stockFocus.stance && STANCE[stockFocus.stance], plural(deepCount(stockFocus.id, bubbles, items), "note"), readCount ? plural(readCount, "read-through") : ""].filter(Boolean).join(" · ")
                : isPitches
                ? [`${covered} saved ${covered === 1 ? "pitch" : "pitches"}`, ideaCount ? plural(ideaCount, "idea") : ""].filter(Boolean).join(" · ")
                : focus
                ? `${plural(deepCount(focus.id, bubbles, items), "note")}${children.length ? ` in ${children.length} ${children.length === 1 ? "moon" : "moons"}` : ""}`
                : `${plural(total, "note")} across ${plural(themes, "planet")}${covered ? ` and ${covered} ${covered === 1 ? "pitch" : "pitches"}` : ""}`}
            </span>
            <div className="c-actions">
              <ViewSwitch mode={mode} onChange={setMode} dashboard={!!stockFocus} />
              {stockFocus && (
                <div className="c-stock-ranges c-stance" role="group" aria-label="Stance">
                  {(["long", "short", "watch"] as const).map(s => (
                    <button key={s} className={"c-stock-range" + (stockFocus.stance === s ? " is-on" : "")} aria-pressed={stockFocus.stance === s}
                      onClick={() => c.updateStock(stockFocus.id, { stance: s })}>{STANCE[s]}</button>
                  ))}
                </div>
              )}
              {stockFocus && (
                <button className="c-pill" onClick={() => setDialog({ kind: "unsave", id: stockFocus.id })} title="Move its notes back to Pitch ideas">
                  <BookmarkMinus size={13} /> Unsave pitch
                </button>
              )}
              {isTheme && focus && !stockFocus && !isPitches && (
                <button className={"c-pill" + (focus.pinned ? "" : " c-pill-on")} onClick={() => c.togglePin(focus.id)}
                  title={focus.pinned ? "You organize this planet by hand" : "AI keeps this planet organized"}>
                  {focus.pinned ? <><Lock size={13} /> Manual</> : <><Sparkles size={13} /> Auto-organizing</>}
                </button>
              )}
              {(!focus || isPitches) && (
                <button className="c-pill" onClick={() => setDialog({ kind: "cover" })} title="Give a stock pitch its own moon with a dashboard">
                  <Bookmark size={13} /> Save a pitch
                </button>
              )}
              {!focus && total > 1 && (
                <button className="c-pill" onClick={() => setDialog({ kind: "reorganize" })} disabled={c.activity.kind === "reshaping"}
                  title="Regroup everything into a few broad planets with moons">
                  <Wand2 size={13} /> Reorganize
                </button>
              )}
              {!stockFocus && !isPitches && (
                <button className="c-icon-btn" title={focus ? "New moon" : "New planet"} aria-label={focus ? "New moon" : "New planet"}
                  onClick={() => setDialog({ kind: "create", parentId: fid })}><Plus size={16} /></button>
              )}
              {focus && (
                <>
                  <button className="c-icon-btn" title="Rename" aria-label="Rename" onClick={() => setDialog({ kind: "rename", id: focus.id })}><PencilLine size={15} /></button>
                  <button className="c-icon-btn c-icon-danger" title="Delete" aria-label="Delete" onClick={() => setDialog({ kind: "delete", id: focus.id })}><Trash2 size={15} /></button>
                </>
              )}
            </div>
          </div>
        </motion.section>
      </AnimatePresence>

      <main ref={stageRef} className="c-stage">
        <AnimatePresence initial={false} custom={nav}>
          <motion.div key={`${fid ?? "root"}:${mode}`} className="c-level" custom={nav} variants={levelVariants}
            initial="enter" animate="center" exit="exit">
            {mode === "list" && scopeItems.length ? (
              <div className="c-scroll">
                <ListView items={scopeItems} bubbles={bubbles} focusId={fid} onOpen={setOpenItemId} onOpenTicker={openTicker} />
              </div>
            ) : mode === "web" && scopeItems.length ? (
              <WebView items={scopeItems} links={links} insights={insights} groupOf={groupOf}
                onOpenItem={setOpenItemId} onOpenInsight={setOpenInsightId} />
            ) : stockFocus ? (
              <div className="c-scroll">
                <StockDashboard stock={stockFocus} items={items} bubbles={bubbles} connectionsReady={c.connectionsReady}
                  onOpenItem={setOpenItemId} onScan={() => c.scanReads(stockFocus.id)}
                  onSaveModel={model => c.updateStock(stockFocus.id, { model })} />
              </div>
            ) : showOrbs ? (
              <OrbField bubbles={children} allBubbles={bubbles} items={items} pulseId={pulseId} onOpen={(id, o) => go(id, o)} />
            ) : here.length ? (
              <div className="c-scroll">
                <ItemGrid items={here} hue={focus?.hue ?? 232} onOpen={setOpenItemId} />
              </div>
            ) : (
              <Empty name={focus?.name} onAdd={() => setAdding(true)} />
            )}
          </motion.div>
        </AnimatePresence>
        <AnimatePresence>
          {mode === "web" && unlinked > 0 && c.connectionsReady && (
            <motion.button key="connect" className="c-loose glass c-connect" onClick={() => c.linkAll(fid ? scopeItems.map(i => i.id) : null)}
              initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: 16 }}
              title={focus ? `Connects these notes to each other, within ${focus.name} only` : "Connects these notes to everything in your space"}>
              <Link2 size={14} /> Find connections for {unlinked} {unlinked === 1 ? "note" : "notes"}{focus ? ` in ${focus.name}` : ""}
            </motion.button>
          )}
          {mode === "orbits" && showOrbs && here.length > 0 && (
            <motion.button key="loose" className="c-loose glass" onClick={() => setDialog({ kind: "loose" })}
              initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: 16 }}>
              <StickyNote size={14} /> {here.length} {here.length === 1 ? "note" : "notes"} not in a moon
            </motion.button>
          )}
        </AnimatePresence>
      </main>

      {!c.connectionsReady && (
        <div className="c-banner glass">Connections are off until the database update runs. See step 6 of the setup guide.</div>
      )}
      {c.connectionsReady && !c.detailsReady && (
        <div className="c-banner glass">Publish dates, tickers and idea follow-ups won&apos;t be saved until the database update runs. See step 8 of the setup guide.</div>
      )}

      <div role="status" aria-live="polite">
      <AnimatePresence>
        {c.saveError && (
          <motion.div className="c-toast glass" initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: 20 }}>
            {c.saveError}
          </motion.div>
        )}
        {undoPlan && !c.saveError && (
          <motion.div key="undo" className="c-toast glass c-toast-action" initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: 20 }}>
            <span>Your space has been reorganized.</span>
            <button className="c-btn c-btn-ghost" onClick={() => { c.restore(undoPlan); setUndoPlan(null); }}>Undo</button>
          </motion.div>
        )}
        {notice && !c.saveError && !undoPlan && (
          <motion.div key="notice" className="c-toast glass" initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: 20 }}
            onClick={() => setNotice("")}>
            {notice}
          </motion.div>
        )}
      </AnimatePresence>
      </div>

      <AnimatePresence>
        {dragging && (
          <motion.div className="c-dropzone" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.2 }}>
            <motion.div className="c-dropzone-card" initial={{ scale: 0.9, y: 10 }} animate={{ scale: 1, y: 0 }} exit={{ scale: 0.96 }}
              transition={{ type: "spring", stiffness: 380, damping: 28 }}>
              <div className="c-dropzone-orb"><FileUp size={30} strokeWidth={1.6} /></div>
              <div className="c-dropzone-title">Drop to save</div>
              <div className="c-dropzone-sub">PDFs, images, Word, Excel, PowerPoint and text. Each one is read and filed into the right planet.</div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      <AddSheet open={adding} onClose={() => setAdding(false)} onSubmit={submitText} onFiles={takeFiles} />
      <CommandPalette open={searching} onClose={() => setSearching(false)} bubbles={bubbles} items={items}
        onPickBubble={id => go(id)} onPickItem={jumpToItem} />
      <ItemPanel item={openItem} hue={panelHue} path={openItem ? pathLabel(openItem.bubbleId, bubbles) : ""}
        items={items} links={links} insights={insights} bubbles={bubbles}
        onOpenItem={id => { setOpenInsightId(null); setOpenItemId(id); }}
        onOpenInsight={id => { setOpenItemId(null); setOpenInsightId(id); }}
        onOpenTicker={openTicker}
        onClose={() => { setOpenItemId(null); if (backToAsk) { setBackToAsk(false); setAskOpen(true); } }}
        onMove={() => openItem && setDialog({ kind: "move", itemId: openItem.id })}
        onSavePitch={t => openItem && setDialog({ kind: "cover", ticker: t, itemId: openItem.id })}
        onDelete={() => openItem && setDialog({ kind: "deleteItem", itemId: openItem.id })} />

      <StockPanel symbol={stockSymbol} items={items} onClose={() => setStockSymbol(null)}
        onOpenItem={id => { setStockSymbol(null); setOpenItemId(id); }}
        onCover={(t, name) => { setStockSymbol(null); setDialog({ kind: "cover", ticker: t, name }); }} />

      <InsightPanel insight={openInsight} items={items} pathOf={it => pathLabel(it.bubbleId, bubbles)}
        onClose={() => setOpenInsightId(null)}
        onOpenItem={id => { setOpenInsightId(null); setOpenItemId(id); }}
        onDismiss={() => { if (openInsight) { c.dismissInsight(openInsight.id); setOpenInsightId(null); } }}
        onRun={q => { setOpenInsightId(null); setAskScope(null); setAskPending(q); setAskOpen(true); }} />
      <AskSheet open={askOpen} onClose={() => setAskOpen(false)} scopeId={askScope} onScope={setAskScope} focusId={fid}
        bubbles={bubbles} items={items} insights={insights} pending={askPending} onPendingUsed={() => setAskPending(null)}
        onOpenItem={id => { setAskOpen(false); setBackToAsk(true); setOpenItemId(id); }} />

      <InsightsSheet open={insightsOpen} insights={insights} onClose={() => setInsightsOpen(false)} onOpen={setOpenInsightId}
        onFind={() => c.findIdeas(fid ? scopeItems.map(i => i.id) : null)} count={scopeItems.length} scopeName={focus?.name} />

      <Sheet open={dialog.kind === "loose"} onClose={closeDialog} width={760} label="Notes not in a moon">
        <div className="c-sheet-title">Not in a moon</div>
        <div className="c-sheet-sub">Notes saved directly on {focus?.name}.</div>
        <div className="c-sheet-scroll">
          <ItemGrid items={here} hue={focus?.hue ?? 232} onOpen={id => { closeDialog(); setOpenItemId(id); }} />
        </div>
      </Sheet>
      <NameDialog
        open={dialog.kind === "create"}
        title={dialog.kind === "create" && dialog.parentId ? `New moon in ${focus?.name}` : "New planet"}
        sub={dialog.kind === "create" && dialog.parentId
          ? (isTheme ? "Adding a moon by hand switches this planet to manual, so the AI won't reshuffle it." : "A narrower topic inside this one.")
          : "A broad area you invest in, such as AI, Space, Energy or Healthcare & Biotech."}
        initial="" cta="Create"
        onClose={closeDialog}
        onSave={name => dialog.kind === "create" && c.createBubble(name, dialog.parentId)} />
      <NameDialog open={dialog.kind === "rename"} title="Rename" sub="Pick a clearer name."
        initial={dialogBubble?.name ?? ""} cta="Save" onClose={closeDialog}
        onSave={name => dialogBubble && c.renameBubble(dialogBubble.id, name)} />
      <ConfirmDialog open={dialog.kind === "delete"} title={`Delete “${dialogBubble?.name ?? ""}”?`}
        sub={`This removes it and the ${dialogBubble ? deepCount(dialogBubble.id, bubbles, items) : 0} notes inside it. This can't be undone.`}
        cta="Delete" onClose={closeDialog}
        onConfirm={() => { if (dialogBubble) { go(dialogBubble.parentId); c.deleteBubble(dialogBubble.id); } }} />
      <ConfirmDialog open={dialog.kind === "reorganize"} title="Reorganize your space?" tone="primary"
        sub={`The AI regroups your ${total} notes into a few broad planets, each with its own moons, such as AI › Infrastructure & Power. Planets you organize by hand, and your stock pitches, stay as they are. You can undo it right after.`}
        cta="Reorganize" onClose={closeDialog} onConfirm={runReorganize} />
      <ConfirmDialog open={dialog.kind === "deleteItem"} title="Delete this note?" sub={dialogItem?.title ?? ""}
        cta="Delete" onClose={closeDialog}
        onConfirm={() => { if (dialogItem) { setOpenItemId(null); c.deleteItem(dialogItem.id); } }} />
      <CoverDialog open={dialog.kind === "cover"} onClose={closeDialog}
        initial={dialog.kind === "cover" && dialog.ticker ? { ticker: dialog.ticker, name: dialog.name ?? "" } : undefined}
        onSave={(t, name, stance) => {
          const from = dialog.kind === "cover" ? dialog.itemId : undefined;
          const id = c.coverStock(t, name, stance, from);
          setOpenItemId(null);
          setTimeout(() => go(id), 50);
        }} />
      <ConfirmDialog open={dialog.kind === "unsave"} title={`Unsave ${unsaving ? `$${unsaving.ticker}` : "this pitch"}?`} tone="primary"
        sub={`Its ${unsaving ? deepCount(unsaving.id, bubbles, items) : 0} notes move back to Pitch ideas, and its dashboard and model numbers go. You can save it again from any of its notes.`}
        cta="Unsave" onClose={closeDialog}
        onConfirm={() => { if (unsaving) { go(unsaving.parentId); c.unsaveStock(unsaving.id); } }} />
      <MoveDialog open={dialog.kind === "move"} title={dialogItem?.title ?? ""} currentId={dialogItem?.bubbleId ?? ""}
        bubbles={bubbles} onClose={closeDialog}
        onPick={id => dialogItem && c.moveItem(dialogItem.id, id)} />
    </div>
    </MotionConfig>
  );
}

const STANCE = { long: "Long", short: "Short", watch: "Watching" } as const;
const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;

function Empty({ name, onAdd }: { name?: string; onAdd: () => void }) {
  return (
    <motion.div className="c-empty" initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.2 }}>
      <div className="c-empty-orb" />
      <div className="c-empty-title">{name ? `Nothing in ${name} yet` : "Your space is empty"}</div>
      <div className="c-empty-text">Save a link or a thought. It finds its place, and the space organizes itself around it.</div>
      <button className="c-btn c-btn-primary" onClick={onAdd}><Plus size={16} /> Save something</button>
    </motion.div>
  );
}
