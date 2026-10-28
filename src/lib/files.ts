// Turns any dropped file into something the AI can read: extracted text, plus the
// original for PDFs and images small enough to send, so charts and scans are seen too.

import { focusFiling } from "@/lib/filings";

export type Attachment = { type: "pdf" | "image"; mediaType: string; data: string };
// links: every web address in the file, so a list of links can be imported one by one.
export type PreparedFile = { name: string; kind: string; text: string; attachment?: Attachment; links: string[] };

export const ACCEPT = ".pdf,.docx,.xlsx,.pptx,.csv,.tsv,.txt,.md,.markdown,.json,.html,.htm,.xml,.rtf,.log,image/*";
const MAX_TEXT = 60000; // what gets stored with the note
const MAX_PDF_BYTES = 2.5 * 1024 * 1024; // keeps the request under the host's upload limit

export async function prepareFile(file: File): Promise<PreparedFile> {
  const name = file.name;
  const ext = (name.split(".").pop() || "").toLowerCase();
  const done = (kind: string, text: string, attachment?: Attachment, extraLinks: string[] = []): PreparedFile =>
    ({ name, kind, text: focusFiling(tidy(text), MAX_TEXT).slice(0, MAX_TEXT), attachment, links: findLinks(text, extraLinks) });

  if (file.type.startsWith("image/") || ["png", "jpg", "jpeg", "gif", "webp", "heic", "bmp"].includes(ext)) {
    return done("Image", "", await shrinkImage(file));
  }
  if (ext === "pdf" || file.type === "application/pdf") {
    const { text, links } = await pdfText(file).catch(() => ({ text: "", links: [] as string[] }));
    if (looksLikeLinkList(text, findLinks(text, links))) return done("PDF", text, undefined, links); // the links are what matter, not the PDF itself
    const attachment = file.size <= MAX_PDF_BYTES ? { type: "pdf" as const, mediaType: "application/pdf", data: await base64(file) } : undefined;
    if (!text.trim() && !attachment) throw new Error("This PDF is a scan and too large to read. Try a smaller copy.");
    return done("PDF", text, attachment, links);
  }
  if (ext === "docx") return done("Word document", await docxText(file), undefined, await officeLinks(file));
  if (ext === "xlsx") return done("Spreadsheet", await xlsxText(file), undefined, await officeLinks(file));
  if (ext === "pptx") return done("Slides", await pptxText(file), undefined, await officeLinks(file));
  if (["doc", "xls", "ppt"].includes(ext)) throw new Error(`Old .${ext} files can't be read. Save it as .${ext}x or PDF and drop it again.`);

  const raw = await file.text();
  if (!looksLikeText(raw)) throw new Error(`Couldn't read ${name}. PDFs, images, Office files and text files work.`);
  if (["html", "htm", "xml"].includes(ext)) return done("Web page", stripTags(raw));
  return done(ext === "csv" || ext === "tsv" ? "Spreadsheet" : "Text", raw);
}

// A file that is mostly a list of web addresses, rather than a document that cites a few.
export const MAX_IMPORT_LINKS = 500;
export function looksLikeLinkList(text: string, links: string[]) {
  if (links.length < 3) return false;
  const prose = text.replace(/https?:\/\/\S+/gi, "").replace(/\[page \d+\]/g, "").replace(/\s+/g, " ").trim();
  return prose.length / links.length < 400;
}

// Web addresses from the text plus any clickable links, cleaned and deduplicated in order.
export function findLinks(text: string, extra: string[] = []): string[] {
  const seen = new Set<string>(), out: string[] = [];
  for (const raw of [...extra, ...(text.match(/https?:\/\/[^\s<>"'`]+/gi) ?? [])]) {
    let u = raw.trim().replace(/[).,;:!?\]}>'"]+$/, "");
    try {
      const parsed = new URL(u);
      if (!/^https?:$/.test(parsed.protocol) || !parsed.hostname.includes(".")) continue;
      parsed.hash = "";
      // X share links carry tracking (?s=42&t=…); the same post should count once
      if (/^(www\.|mobile\.)?(x|twitter)\.com$/i.test(parsed.hostname) && /\/status\/\d+/.test(parsed.pathname)) { parsed.search = ""; parsed.hostname = "x.com"; }
      u = parsed.toString();
    }
    catch { continue; }
    if (!seen.has(u)) { seen.add(u); out.push(u); }
  }
  return out;
}

const tidy = (s: string) => s.replace(/\r/g, "").replace(/[ \t]+\n/g, "\n").replace(/\n{3,}/g, "\n\n").trim();
const stripTags = (s: string) => s.replace(/<(script|style)[\s\S]*?<\/\1>/gi, " ").replace(/<[^>]+>/g, " ").replace(/&nbsp;/g, " ").replace(/&amp;/g, "&");
const looksLikeText = (s: string) => {
  const sample = s.slice(0, 4000);
  return sample.length > 0 && (sample.match(/[\x00-\x08\x0e-\x1f�]/g)?.length ?? 0) < sample.length * 0.02;
};

async function base64(blob: Blob): Promise<string> {
  const url = await new Promise<string>((ok, fail) => {
    const r = new FileReader();
    r.onload = () => ok(String(r.result));
    r.onerror = () => fail(r.error);
    r.readAsDataURL(blob);
  });
  return url.slice(url.indexOf(",") + 1);
}

// Big photos and screenshots are scaled down to what the model actually looks at.
async function shrinkImage(file: File): Promise<Attachment> {
  const bitmap = await createImageBitmap(file).catch(() => { throw new Error(`Couldn't open ${file.name} as an image.`); });
  const scale = Math.min(1, 1600 / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(bitmap.width * scale);
  canvas.height = Math.round(bitmap.height * scale);
  const ctx = canvas.getContext("2d")!;
  ctx.fillStyle = "#fff";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  const blob = await new Promise<Blob>((ok, fail) => canvas.toBlob(b => (b ? ok(b) : fail(new Error("encode failed"))), "image/jpeg", 0.86));
  return { type: "image", mediaType: "image/jpeg", data: await base64(blob) };
}

async function pdfText(file: File): Promise<{ text: string; links: string[] }> {
  const pdfjs = await import("pdfjs-dist");
  pdfjs.GlobalWorkerOptions.workerSrc = new URL("pdfjs-dist/build/pdf.worker.min.mjs", import.meta.url).toString();
  const task = pdfjs.getDocument({ data: new Uint8Array(await file.arrayBuffer()) });
  const doc = await task.promise;
  const pages: string[] = [], links: string[] = [];
  let length = 0;
  // read well past what's stored: an annual report's discussion of results sits deep inside it
  for (let i = 1; i <= doc.numPages && length < MAX_TEXT * 8; i++) {
    const page = await doc.getPage(i);
    // clickable links often hide the full address behind short text
    for (const a of await page.getAnnotations().catch(() => [])) if (a.subtype === "Link" && typeof a.url === "string") links.push(a.url);
    const content = await page.getTextContent();
    const text = content.items.map(it => ("str" in it ? it.str + (it.hasEOL ? "\n" : " ") : "")).join("");
    pages.push(`[page ${i}]\n${text}`);
    length += text.length;
  }
  await task.destroy();
  return { text: pages.join("\n\n"), links };
}

async function docxText(file: File): Promise<string> {
  const mammoth = await import("mammoth");
  const { value } = await mammoth.extractRawText({ arrayBuffer: await file.arrayBuffer() });
  return value;
}

const xmlText = (xml: string, tag: string) =>
  [...xml.matchAll(new RegExp(`<${tag}[^>]*>([^<]*)</${tag}>`, "g"))].map(m => decodeXml(m[1]));
const decodeXml = (s: string) => s.replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, "&");
const byNumber = (a: string, b: string) => Number(a.match(/(\d+)\.xml$/)?.[1] ?? 0) - Number(b.match(/(\d+)\.xml$/)?.[1] ?? 0);

// Office files keep clickable links (text that points somewhere) in their relationship files.
async function officeLinks(file: File): Promise<string[]> {
  const { default: JSZip } = await import("jszip");
  const zip = await JSZip.loadAsync(await file.arrayBuffer());
  const links: string[] = [];
  for (const p of Object.keys(zip.files).filter(p => p.endsWith(".rels"))) {
    const xml = await zip.file(p)!.async("string");
    for (const m of xml.matchAll(/<Relationship\b[^>]*>/g)) {
      if (!/Type="[^"]*\/hyperlink"/.test(m[0])) continue;
      const target = m[0].match(/Target="([^"]+)"/)?.[1];
      if (target) links.push(decodeXml(target));
    }
  }
  return links;
}

async function pptxText(file: File): Promise<string> {
  const { default: JSZip } = await import("jszip");
  const zip = await JSZip.loadAsync(await file.arrayBuffer());
  const slides = Object.keys(zip.files).filter(p => /^ppt\/slides\/slide\d+\.xml$/.test(p)).sort(byNumber);
  const out: string[] = [];
  for (const [i, p] of slides.entries()) {
    const xml = await zip.file(p)!.async("string");
    const paras = xml.split(/<\/a:p>/).map(chunk => xmlText(chunk, "a:t").join("")).filter(Boolean);
    out.push(`[slide ${i + 1}]\n${paras.join("\n")}`);
  }
  return out.join("\n\n");
}

// Each sheet becomes rows of cells separated by " | ", with empty cells kept so a model's
// years line up with their numbers; formulas are read as their last computed values.
const colIndex = (letters?: string) => (letters ? [...letters].reduce((n, ch) => n * 26 + ch.charCodeAt(0) - 64, 0) - 1 : -1);
// 1234.56789012 → 1234.568: the model needs the figure, not float noise
const shortNumber = (v: string) => {
  const x = Number(v);
  return v === "" || !Number.isFinite(x) ? v : String(Math.abs(x) >= 100 ? Math.round(x * 100) / 100 : Number(x.toPrecision(6)));
};

async function xlsxText(file: File): Promise<string> {
  const { default: JSZip } = await import("jszip");
  const zip = await JSZip.loadAsync(await file.arrayBuffer());
  // some exporters write every tag with a namespace prefix (<x:row>); drop it so one parser reads both
  const read = async (p: string) => (await zip.file(p)?.async("string") ?? "").replace(/<(\/?)[A-Za-z][\w.-]*:(?=[A-Za-z])/g, "<$1");
  const shared = (await read("xl/sharedStrings.xml")).split(/<\/si>/).map(si => xmlText(si, "t").join(""));
  const workbook = await read("xl/workbook.xml");
  const names = [...workbook.matchAll(/<sheet [^>]*name="([^"]+)"/g)].map(m => decodeXml(m[1]));
  const sheets = Object.keys(zip.files).filter(p => /^xl\/worksheets\/sheet\d+\.xml$/.test(p)).sort(byNumber);
  const out: string[] = [];
  let length = 0;
  for (const [i, p] of sheets.entries()) {
    const xml = await read(p);
    const rows: string[] = [];
    for (const row of xml.matchAll(/<row[^>]*>([\s\S]*?)<\/row>/g)) {
      const cells: string[] = [];
      for (const c of row[1].matchAll(/<c ([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
        const type = c[1].match(/t="(\w+)"/)?.[1];
        const v = c[2]?.match(/<v>([^<]*)<\/v>/)?.[1] ?? "";
        const col = colIndex(c[1].match(/r="([A-Z]+)\d+"/)?.[1]);
        const value = type === "s" ? shared[Number(v)] ?? "" : type === "inlineStr" ? xmlText(c[2] ?? "", "t").join("") : type === "str" || type === "e" ? decodeXml(v) : shortNumber(v);
        cells[col < 0 ? cells.length : col] = value.trim();
      }
      if (cells.some(Boolean)) rows.push(Array.from(cells, x => x ?? "").join(" | ").replace(/(\s\|\s)+$/, ""));
      length += rows[rows.length - 1]?.length ?? 0;
      if (length > MAX_TEXT * 4) break; // a long sheet of links is read whole; only its start is stored
    }
    out.push(`[sheet: ${names[i] ?? `Sheet ${i + 1}`}]\n${rows.join("\n")}`);
    if (length > MAX_TEXT * 4) break;
  }
  return out.join("\n\n");
}
