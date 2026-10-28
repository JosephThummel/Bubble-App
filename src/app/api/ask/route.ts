import { ask, type DeductionForAsking, type NoteForAsking, type Turn } from "@/lib/ai";
import { requireUser } from "@/lib/auth";

export const maxDuration = 300;

const str = (v: unknown, max: number) => (typeof v === "string" ? v.slice(0, max) : "");

// The answer streams back as plain text so it can appear word by word.
export async function POST(request: Request) {
  const auth = await requireUser();
  if (!auth.ok) return auth.response;

  const body = (await request.json()) as { question?: string; scope?: string; notes?: NoteForAsking[]; deductions?: DeductionForAsking[]; history?: Turn[] };
  const question = str(body.question, 4000).trim();
  if (!question) return Response.json({ error: "question required" }, { status: 400 });

  // keep the whole library in context, but trim long saved text so it fits
  const notes = (Array.isArray(body.notes) ? body.notes : []).slice(0, 3000).map(n => ({
    theme: str(n.theme, 200), title: str(n.title, 300), summary: str(n.summary, 1200), source: str(n.source, 40),
    url: str(n.url, 500), date: str(n.date, 40), facts: (Array.isArray(n.facts) ? n.facts : []).slice(0, 8).map(f => str(f, 300)),
    text: str(n.text, n.source === "File" ? 24000 : 6000),
    published: str(n.published, 10), kind: str(n.kind, 20),
    tickers: (Array.isArray(n.tickers) ? n.tickers : []).slice(0, 5).map(t => str(t, 12)),
  }));
  const deductions = (Array.isArray(body.deductions) ? body.deductions : []).slice(0, 200).map(d => ({
    title: str(d.title, 200), body: str(d.body, 1500), notes: (Array.isArray(d.notes) ? d.notes : []).filter(Number.isInteger),
  }));
  const history = (Array.isArray(body.history) ? body.history : [])
    .filter(t => (t.role === "user" || t.role === "assistant") && typeof t.content === "string")
    .map(t => ({ role: t.role, content: t.content.slice(0, 20000) }));

  const stream = ask(question, str(body.scope, 200) || "everything they have saved", notes, deductions, history);
  const encoder = new TextEncoder();
  return new Response(new ReadableStream({
    start(controller) {
      stream.on("text", delta => controller.enqueue(encoder.encode(delta)));
      stream.finalMessage()
        .then(m => {
          if (m.stop_reason === "refusal") controller.enqueue(encoder.encode("\n\nI can't help with that one."));
          controller.close();
        })
        .catch(err => {
          console.error("ask failed", err);
          controller.enqueue(encoder.encode("\n\n⚠ The answer was cut off. Try asking again."));
          controller.close();
        });
    },
    cancel() { stream.abort(); },
  }), { headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store" } });
}
