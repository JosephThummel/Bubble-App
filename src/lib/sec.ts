import "server-only";
import { focusFiling } from "@/lib/filings";

// SEC EDGAR serves filings only to requests that say who is asking (sec.gov/os/accessing-edgar-data),
// so filings are fetched here rather than left to the model's web fetch.
export const isSecUrl = (url: string) => /^https?:\/\/(www\.)?sec\.gov\//i.test(url);

const AGENT = process.env.SEC_USER_AGENT || "Constellation research app (set SEC_USER_AGENT to name and email)";

export async function readFiling(url: string): Promise<string | null> {
  try {
    const res = await fetch(url, { headers: { "User-Agent": AGENT, Accept: "text/html,text/plain" }, signal: AbortSignal.timeout(20000) });
    if (!res.ok) return null;
    const type = res.headers.get("content-type") || "";
    if (!/html|text|xml/.test(type)) return null;
    const raw = await res.text();
    const text = raw
      .replace(/<(script|style|head)[\s\S]*?<\/\1>/gi, " ")
      .replace(/<ix:header[\s\S]*?<\/ix:header>/gi, " ") // inline XBRL facts repeated as hidden data
      .replace(/<\/(p|div|tr|li|h\d|br)>|<br\s*\/?>/gi, "\n")
      .replace(/<[^>]+>/g, " ")
      .replace(/&nbsp;|&#160;|&#xa0;/gi, " ").replace(/&amp;/g, "&").replace(/&#8217;|&rsquo;/g, "’").replace(/&#8220;|&#8221;|&quot;/g, '"').replace(/&#\d+;/g, " ")
      .replace(/[ \t]+/g, " ").replace(/\n\s*\n+/g, "\n").trim();
    return text.length > 500 ? focusFiling(text, 45000) : null;
  } catch {
    return null;
  }
}
