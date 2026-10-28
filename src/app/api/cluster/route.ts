import { clusterCall } from "@/lib/ai";
import { requireUser } from "@/lib/auth";

export const maxDuration = 60;

export async function POST(request: Request) {
  const auth = await requireUser();
  if (!auth.ok) return auth.response;

  const { themeName, lines, subNames } = (await request.json()) as { themeName?: string; lines?: string; subNames?: string[] };
  if (!themeName || !lines) return Response.json({ error: "themeName and lines required" }, { status: 400 });

  try {
    const clusters = await clusterCall(themeName, lines.slice(0, 60000), Array.isArray(subNames) ? subNames : []);
    return Response.json({ clusters });
  } catch (err) {
    console.error("cluster failed", err);
    return Response.json({ error: "model error" }, { status: 502 });
  }
}
