import { cleanNote as clean, connect, type NoteForLinking } from "@/lib/ai";
import { requireUser } from "@/lib/auth";

export const maxDuration = 120;

export async function POST(request: Request) {
  const auth = await requireUser();
  if (!auth.ok) return auth.response;

  const { note, others } = (await request.json()) as { note?: NoteForLinking; others?: NoteForLinking[] };
  if (!note?.id) return Response.json({ error: "note required" }, { status: 400 });

  try {
    const result = await connect(clean(note), (Array.isArray(others) ? others : []).slice(0, 3000).map(clean));
    return Response.json(result);
  } catch (err) {
    console.error("connect failed", err);
    return Response.json({ error: "model error" }, { status: 502 });
  }
}
