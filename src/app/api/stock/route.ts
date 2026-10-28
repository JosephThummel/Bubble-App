import { requireUser } from "@/lib/auth";
import { fetchStock, stocksEnabled } from "@/lib/stocks";

export const maxDuration = 60;

// Price and valuation history for one ticker, for the stock panel.
export async function GET(request: Request) {
  const auth = await requireUser();
  if (!auth.ok) return auth.response;
  if (!stocksEnabled()) return Response.json({ enabled: false });
  const symbol = (new URL(request.url).searchParams.get("symbol") || "").toUpperCase();
  if (!/^[A-Z0-9.\-^]{1,12}$/.test(symbol)) return Response.json({ error: "bad symbol" }, { status: 400 });
  try {
    const stock = await fetchStock(symbol);
    if (!stock) return Response.json({ enabled: true, error: `No price history for ${symbol}. It may be outside your data plan.` }, { status: 404 });
    return Response.json({ enabled: true, stock });
  } catch (err) {
    console.error("stock failed", err);
    return Response.json({ enabled: true, error: "Couldn't reach the market data service. Try again in a moment." }, { status: 502 });
  }
}
