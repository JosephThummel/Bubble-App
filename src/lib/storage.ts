import { supabaseEnabled } from "@/lib/supabase/config";
import { createClient } from "@/lib/supabase/client";

export type Bubble = { id: string; name: string; parentId: string | null; hue: number; pinned?: boolean };
export type Item = {
  id: string; bubbleId: string; title: string; summary: string;
  url: string; source: string; raw: string; createdAt: number;
};
export type Graph = { bubbles: Bubble[]; items: Item[] };

export interface GraphStore {
  load(seed: Graph): Promise<Graph>;
  // Persist the change from prev to next. Called after every graph update.
  save(prev: Graph, next: Graph): Promise<void>;
}

const STORE_KEY = "constellation:graph:v3";

class LocalStore implements GraphStore {
  async load(seed: Graph) {
    try {
      const raw = localStorage.getItem(STORE_KEY);
      return raw ? (JSON.parse(raw) as Graph) : seed;
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
};

const toBubbleRow = (b: Bubble): BubbleRow => ({ id: b.id, name: b.name, parent_id: b.parentId, hue: b.hue, pinned: !!b.pinned });
const fromBubbleRow = (r: BubbleRow): Bubble => ({ id: r.id, name: r.name, parentId: r.parent_id, hue: r.hue, pinned: r.pinned });
const toItemRow = (i: Item): ItemRow => ({
  id: i.id, bubble_id: i.bubbleId, title: i.title, summary: i.summary,
  url: i.url || "", source: i.source, raw: i.raw, created_at: i.createdAt,
});
const fromItemRow = (r: ItemRow): Item => ({
  id: r.id, bubbleId: r.bubble_id, title: r.title, summary: r.summary,
  url: r.url, source: r.source, raw: r.raw, createdAt: Number(r.created_at),
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

  async load(seed: Graph) {
    const [b, i] = await Promise.all([
      this.db.from("bubbles").select("id,name,parent_id,hue,pinned").order("created_at"),
      this.db.from("items").select("id,bubble_id,title,summary,url,source,raw,created_at").order("created_at"),
    ]);
    if (b.error) throw b.error;
    if (i.error) throw i.error;
    if (!b.data.length && !i.data.length) {
      // First visit: start from the seed themes, migrating any local-mode graph.
      const local = await new LocalStore().load(seed);
      await this.save({ bubbles: [], items: [] }, local);
      return local;
    }
    return { bubbles: (b.data as BubbleRow[]).map(fromBubbleRow), items: (i.data as ItemRow[]).map(fromItemRow) };
  }

  async save(prev: Graph, next: Graph) {
    const b = diff(prev.bubbles, next.bubbles);
    const i = diff(prev.items, next.items);
    const ops = [];
    if (b.upserts.length) ops.push(this.db.from("bubbles").upsert(b.upserts.map(toBubbleRow)));
    if (i.upserts.length) ops.push(this.db.from("items").upsert(i.upserts.map(toItemRow)));
    if (b.deletes.length) ops.push(this.db.from("bubbles").delete().in("id", b.deletes));
    if (i.deletes.length) ops.push(this.db.from("items").delete().in("id", i.deletes));
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
