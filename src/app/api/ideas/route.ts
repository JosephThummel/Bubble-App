import { cleanNote, findIdeas, type NoteForLinking } from "@/lib/ai";
import { requireUser } from "@/lib/auth";

export const maxDuration = 300;

// Reads every note at once and returns the best ideas that come from combining them.
export async function POST(request: Request) {
  const auth = await requireUser();
  if (!auth.ok) return auth.response;
  const { notes, already } = (await request.json()) as { notes?: Partial<NoteForLinking>[]; already?: unknown[] };
  const list = (Array.isArray(notes) ? notes : []).slice(0, 3000).map(cleanNote).filter(n => n.id)
    .map(n => ({ ...n, facts: n.facts.slice(0, 4) })); // the whole space has to fit in one read
  if (list.length < 2) return Response.json({ ideas: [] });
  try {
    const titles = (Array.isArray(already) ? already : []).filter((t): t is string => typeof t === "string").slice(0, 200).map(t => t.slice(0, 160));
    return Response.json({ ideas: await findIdeas(list, titles) });
  } catch (err) {
    console.error("ideas failed", err);
    return Response.json({ error: "model error" }, { status: 502 });
  }
}
