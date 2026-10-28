// Annual and quarterly reports run to hundreds of pages; what an analyst reads first is the
// cover, management's discussion of results, the risk factors and the income statement.
// This keeps those parts so they fit in what the model reads, and leaves other text alone.

const FILING = /\bFORM\s+(10-K|10-Q|20-F|40-F)\b|ANNUAL REPORT PURSUANT TO SECTION 13|QUARTERLY REPORT PURSUANT TO SECTION 13/i;
const ITEM = /\bITEM\s+\d+[A-Z]?\s*[.:—–-]/gi;

export const looksLikeFiling = (text: string) => FILING.test(text.slice(0, 20000));

// The real section, not its table-of-contents entry: the heading followed by the most text
// before the next "Item" heading.
function section(text: string, heading: RegExp, take: number): string {
  let best = -1, bestLen = 0;
  for (const m of text.matchAll(heading)) {
    ITEM.lastIndex = m.index! + m[0].length + 40;
    const next = ITEM.exec(text);
    const len = (next ? next.index : text.length) - m.index!;
    if (len > bestLen) { best = m.index!; bestLen = len; }
  }
  return best < 0 ? "" : text.slice(best, best + Math.min(take, bestLen));
}

export function focusFiling(text: string, max = 55000): string {
  if (text.length <= max || !looksLikeFiling(text)) return text;
  const parts = [
    ["Cover and business overview", text.slice(0, 7000)],
    ["Management's discussion and analysis", section(text, /\bITEM\s+[27]\s*[.:—–-]?\s*MANAGEMENT[’'`]?S\s+DISCUSSION/gi, Math.round(max * 0.55))],
    ["Risk factors", section(text, /\bITEM\s+1A\s*[.:—–-]?\s*RISK\s+FACTORS/gi, Math.round(max * 0.18))],
    ["Income statement", section(text, /CONSOLIDATED\s+STATEMENTS?\s+OF\s+(?:OPERATIONS|INCOME|EARNINGS)/gi, Math.round(max * 0.1))],
  ].filter(([, body]) => body.trim());
  // fell back to nothing useful: keep the start
  if (parts.length < 2) return text.slice(0, max);
  return parts.map(([label, body]) => `[${label}]\n${body.trim()}`).join("\n\n").slice(0, max);
}
