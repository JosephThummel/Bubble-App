import { supabaseEnabled } from "@/lib/supabase/config";
import { createClient } from "@/lib/supabase/client";

export type Bubble = { id: string; name: string; parentId: string | null; hue: number; pinned?: boolean };
export type Item = {
  id: string; bubbleId: string; title: string; summary: string;
  url: string; source: string; raw: string; createdAt: number;
  facts?: string[]; // key claims and numbers pulled out when the item was read
  linkedAt?: number; // when the connections engine last looked at this item
};
// A bond between two saved items that the AI judged genuinely related.
export type Link = { id: string; a: string; b: string; strength: number; label: string };
// A takeaway the AI deduced by combining two or more items.
export type Insight = { id: string; itemIds: string[]; title: string; body: string; createdAt: number };
export type Graph = { bubbles: Bubble[]; items: Item[]; links: Link[]; insights: Insight[] };

export interface GraphStore {
  load(seed: Graph): Promise<Graph>;
  // Persist the change from prev to next. Called after every graph update.
  save(prev: Graph, next: Graph): Promise<void>;
  // False when the database predates the connections tables (migration 0002 not run).
  readonly connectionsReady: boolean;
}

const STORE_KEY = "constellation:graph:v3";

// Older saves have no links or insights yet.
const complete = (g: Partial<Graph>): Graph => ({
  bubbles: g.bubbles ?? [], items: g.items ?? [], links: g.links ?? [], insights: g.insights ?? [],
});

class LocalStore implements GraphStore {
  readonly connectionsReady = true;
  async load(seed: Graph) {
    try {
      const raw = localStorage.getItem(STORE_KEY);
      return raw ? complete(JSON.parse(raw)) : seed;
    } catch {
      return seed;
    }
  }
  async save(_prev: Graph, next: Graph) {
    try { localStorage.setItem(STORE_KEY, JSON.stringify(next)); } catch { /* storage full or blocked */ }
  }
}

type BubbleRow = { id: string; name: string; parent_id: string | null; hue: number; pinned: boolean };
type ItemRow = {
  id: string; bubble_id: string; title: string; summary: string;
  url: string; source: string; raw: string; created_at: number;
  facts?: string[]; linked_at?: number | null;
};
type LinkRow = { id: string; a: string; b: string; strength: number; label: string };
type InsightRow = { id: string; item_ids: string[]; title: string; body: string; created_at: number };

const toBubbleRow = (b: Bubble): BubbleRow => ({ id: b.id, name: b.name, parent_id: b.parentId, hue: b.hue, pinned: !!b.pinned });
const fromBubbleRow = (r: BubbleRow): Bubble => ({ id: r.id, name: r.name, parentId: r.parent_id, hue: r.hue, pinned: r.pinned });
const fromItemRow = (r: ItemRow): Item => ({
  id: r.id, bubbleId: r.bubble_id, title: r.title, summary: r.summary,
  url: r.url, source: r.source, raw: r.raw, createdAt: Number(r.created_at),
  facts: r.facts ?? [], linkedAt: r.linked_at ? Number(r.linked_at) : undefined,
});
const fromInsightRow = (r: InsightRow): Insight => ({
  id: r.id, itemIds: r.item_ids, title: r.title, body: r.body, createdAt: Number(r.created_at),
});

// Rows that are new or changed (by reference) in next, and ids gone from next.
function diff<T extends { id: string }>(prev: T[], next: T[]) {
  const before = new Map(prev.map(x => [x.id, x]));
  const after = new Set(next.map(x => x.id));
  return {
    upserts: next.filter(x => before.get(x.id) !== x),
    deletes: prev.filter(x => !after.has(x.id)).map(x => x.id),
  };
}

class SupabaseStore implements GraphStore {
  private db = createClient();
  connectionsReady = true;

  private toItemRow(i: Item): ItemRow {
    const row: ItemRow = {
      id: i.id, bubble_id: i.bubbleId, title: i.title, summary: i.summary,
      url: i.url || "", source: i.source, raw: i.raw, created_at: i.createdAt,
    };
    if (this.connectionsReady) { row.facts = i.facts ?? []; row.linked_at = i.linkedAt ?? null; }
    return row;
  }

  async load(seed: Graph) {
    const [b, i, l, s] = await Promise.all([
      this.db.from("bubbles").select("id,name,parent_id,hue,pinned").order("created_at"),
      this.db.from("items").select("*").order("created_at"),
      this.db.from("links").select("id,a,b,strength,label"),
      this.db.from("insights").select("id,item_ids,title,body,created_at").order("created_at"),
    ]);
    if (b.error) throw b.error;
    if (i.error) throw i.error;
    // The connections tables arrive with migration 0002; run without them until then.
    this.connectionsReady = !l.error && !s.error && (i.data.length === 0 || "facts" in i.data[0]);
    const links = this.connectionsReady ? (l.data as LinkRow[]) : [];
    const insights = this.connectionsReady ? (s.data as InsightRow[]).map(fromInsightRow) : [];

    if (!b.data.length && !i.data.length) {
      // First visit: start from the seed themes, migrating any local-mode graph.
      const local = await new LocalStore().load(seed);
      await this.save(complete({}), local);
      return local;
    }
    return { bubbles: (b.data as BubbleRow[]).map(fromBubbleRow), items: (i.data as ItemRow[]).map(fromItemRow), links, insights };
  }

  async save(prev: Graph, next: Graph) {
    const b = diff(prev.bubbles, next.bubbles);
    const i = diff(prev.items, next.items);
    const ops = [];
    if (b.upserts.length) ops.push(this.db.from("bubbles").upsert(b.upserts.map(toBubbleRow)));
    if (i.upserts.length) ops.push(this.db.from("items").upsert(i.upserts.map(x => this.toItemRow(x))));
    if (b.deletes.length) ops.push(this.db.from("bubbles").delete().in("id", b.deletes));
    if (i.deletes.length) ops.push(this.db.from("items").delete().in("id", i.deletes));
    if (this.connectionsReady) {
      const l = diff(prev.links, next.links);
      const s = diff(prev.insights, next.insights);
      if (l.upserts.length) ops.push(this.db.from("links").upsert(l.upserts));
      if (l.deletes.length) ops.push(this.db.from("links").delete().in("id", l.deletes));
      if (s.upserts.length) ops.push(this.db.from("insights").upsert(s.upserts.map(x => ({
        id: x.id, item_ids: x.itemIds, title: x.title, body: x.body, created_at: x.createdAt,
      }))));
      if (s.deletes.length) ops.push(this.db.from("insights").delete().in("id", s.deletes));
    }
    const results = await Promise.all(ops);
    const failed = results.find(r => r.error);
    if (failed?.error) throw failed.error;
  }
}

export function createStore(): GraphStore {
  return supabaseEnabled ? new SupabaseStore() : new LocalStore();
}

export async function signOut() {
  if (supabaseEnabled) await createClient().auth.signOut();
}
