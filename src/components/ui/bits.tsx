import { FileText, Globe, Newspaper, StickyNote } from "lucide-react";

export function timeAgo(ts: number) {
  const s = Math.max(1, Math.round((Date.now() - ts) / 1000));
  if (s < 60) return "just now";
  const m = Math.round(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.round(h / 24);
  if (d < 7) return `${d}d ago`;
  return new Date(ts).toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

export function SourceGlyph({ source, size = 13 }: { source: string; size?: number }) {
  if (source === "X") return <span className="c-glyph-x" style={{ fontSize: size }}>𝕏</span>;
  if (source === "Substack") return <Newspaper size={size} />;
  if (source === "Article") return <Globe size={size} />;
  if (source === "File") return <FileText size={size} />;
  return <StickyNote size={size} />;
}
