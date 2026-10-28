import { assignNotes, planSpace, type PlanetPlan } from "@/lib/ai";
import { requireUser } from "@/lib/auth";

export const maxDuration = 300;

const str = (x: unknown, max: number) => (typeof x === "string" ? x.slice(0, max) : "");

// Reorganizing the whole space runs in two steps from the browser: "plan" designs the
// planets and moons from every note, then "assign" places notes into them in batches.
export async function POST(request: Request) {
  const auth = await requireUser();
  if (!auth.ok) return auth.response;
  const body = (await request.json()) as { step?: string; notes?: unknown[]; keep?: unknown[]; plan?: PlanetPlan[] };
  try {
    if (body.step === "plan") {
      const notes = (Array.isArray(body.notes) ? body.notes : []).slice(0, 3000).map(n => str(n, 240));
      const keep = (Array.isArray(body.keep) ? body.keep : []).map(k => str(k, 60)).filter(Boolean);
      return Response.json({ planets: await planSpace(notes, keep) });
    }
    if (body.step === "assign") {
      const plan = (Array.isArray(body.plan) ? body.plan : []).slice(0, 14);
      const notes = (Array.isArray(body.notes) ? body.notes : []).slice(0, 150)
        .map(x => x as { n?: unknown; text?: unknown })
        .filter(x => typeof x.n === "number").map(x => ({ n: x.n as number, text: str(x.text, 400) }));
      return Response.json({ assignments: await assignNotes(plan, notes) });
    }
    return Response.json({ error: "unknown step" }, { status: 400 });
  } catch (err) {
    console.error("organize failed", err);
    return Response.json({ error: "model error" }, { status: 502 });
  }
}
