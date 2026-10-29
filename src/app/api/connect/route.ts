import { cleanNote, connect, type NoteForLinking } from "@/lib/ai";
import { requireUser } from "@/lib/auth";

export const maxDuration = 300;

// Connects a batch of new notes to the notes in scope (the whole space, or the planet or moon in view).
export async function POST(request: Request) {
  const auth = await requireUser();
  if (!auth.ok) return auth.response;

  const { ids, library } = (await request.json()) as { ids?: unknown[]; library?: Partial<NoteForLinking>[] };
  const fresh = (Array.isArray(ids) ? ids : []).filter((x): x is string => typeof x === "string").slice(0, 20);
  if (!fresh.length) return Response.json({ error: "ids required" }, { status: 400 });

  try {
    const notes = (Array.isArray(library) ? library : []).slice(0, 3000).map(cleanNote).filter(n => n.id);
    return Response.json(await connect(fresh, notes));
  } catch (err) {
    console.error("connect failed", err);
    return Response.json({ error: "model error" }, { status: 502 });
  }
}
