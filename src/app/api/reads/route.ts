import { cleanNote, cleanStockLite, stockReads, type NoteForLinking, type StockLite } from "@/lib/ai";
import { requireUser } from "@/lib/auth";

export const maxDuration = 300;

// For one covered stock, reads every other note for what matters to the position.
export async function POST(request: Request) {
  const auth = await requireUser();
  if (!auth.ok) return auth.response;
  const { stock, own, notes } = (await request.json()) as { stock?: Partial<StockLite>; own?: Partial<NoteForLinking>[]; notes?: Partial<NoteForLinking>[] };
  const s = cleanStockLite(stock ?? {});
  const others = (Array.isArray(notes) ? notes : []).slice(0, 3000).map(cleanNote).filter(n => n.id)
    .map(n => ({ ...n, facts: n.facts.slice(0, 4) })); // the whole space has to fit in one read
  if (!s.ticker || !others.length) return Response.json({ reads: [] });
  try {
    const mine = (Array.isArray(own) ? own : []).slice(0, 40).map(cleanNote);
    return Response.json({ reads: await stockReads(s, mine, others) });
  } catch (err) {
    console.error("reads failed", err);
    return Response.json({ error: "model error" }, { status: 502 });
  }
}
