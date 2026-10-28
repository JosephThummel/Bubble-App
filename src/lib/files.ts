// Turns any dropped file into something the AI can read: extracted text, plus the
// original for PDFs and images small enough to send, so charts and scans are seen too.

export type Attachment = { type: "pdf" | "image"; mediaType: string; data: string };
export type PreparedFile = { name: string; kind: string; text: string; attachment?: Attachment };

export const ACCEPT = ".pdf,.docx,.xlsx,.pptx,.csv,.tsv,.txt,.md,.markdown,.json,.html,.htm,.xml,.rtf,.log,image/*";
const MAX_TEXT = 60000; // what gets stored with the note
const MAX_PDF_BYTES = 2.5 * 1024 * 1024; // keeps the request under the host's upload limit

export async function prepareFile(file: File): Promise<PreparedFile> {
  const name = file.name;
  const ext = (name.split(".").pop() || "").toLowerCase();
  const done = (kind: string, text: string, attachment?: Attachment): PreparedFile =>
    ({ name, kind, text: tidy(text).slice(0, MAX_TEXT), attachment });

  if (file.type.startsWith("image/") || ["png", "jpg", "jpeg", "gif", "webp", "heic", "bmp"].includes(ext)) {
    return done("Image", "", await shrinkImage(file));
  }
  if (ext === "pdf" || file.type === "application/pdf") {
    const text = await pdfText(file).catch(() => "");
    const attachment = file.size <= MAX_PDF_BYTES ? { type: "pdf" as const, mediaType: "application/pdf", data: await base64(file) } : undefined;
    if (!text.trim() && !attachment) throw new Error("This PDF is a scan and too large to read. Try a smaller copy.");
    return done("PDF", text, attachment);
  }
  if (ext === "docx") return done("Word document", await docxText(file));
  if (ext === "xlsx") return done("Spreadsheet", await xlsxText(file));
  if (ext === "pptx") return done("Slides", await pptxText(file));
  if (["doc", "xls", "ppt"].includes(ext)) throw new Error(`Old .${ext} files can't be read. Save it as .${ext}x or PDF and drop it again.`);

  const raw = await file.text();
  if (!looksLikeText(raw)) throw new Error(`Couldn't read ${name}. PDFs, images, Office files and text files work.`);
  if (["html", "htm", "xml"].includes(ext)) return done("Web page", stripTags(raw));
  return done(ext === "csv" || ext === "tsv" ? "Spreadsheet" : "Text", raw);
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

async function pdfText(file: File): Promise<string> {
  const pdfjs = await import("pdfjs-dist");
  pdfjs.GlobalWorkerOptions.workerSrc = new URL("pdfjs-dist/build/pdf.worker.min.mjs", import.meta.url).toString();
  const task = pdfjs.getDocument({ data: new Uint8Array(await file.arrayBuffer()) });
  const doc = await task.promise;
  const pages: string[] = [];
  let length = 0;
  for (let i = 1; i <= doc.numPages && length < MAX_TEXT; i++) {
    const content = await (await doc.getPage(i)).getTextContent();
    const text = content.items.map(it => ("str" in it ? it.str + (it.hasEOL ? "\n" : " ") : "")).join("");
    pages.push(`[page ${i}]\n${text}`);
    length += text.length;
  }
  await task.destroy();
  return pages.join("\n\n");
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

// Each sheet becomes CSV-ish rows; formulas are read as their last computed values.
async function xlsxText(file: File): Promise<string> {
  const { default: JSZip } = await import("jszip");
  const zip = await JSZip.loadAsync(await file.arrayBuffer());
  const shared = zip.file("xl/sharedStrings.xml")
    ? (await zip.file("xl/sharedStrings.xml")!.async("string")).split(/<\/si>/).map(si => xmlText(si, "t").join(""))
    : [];
  const workbook = await zip.file("xl/workbook.xml")?.async("string") ?? "";
  const names = [...workbook.matchAll(/<sheet [^>]*name="([^"]+)"/g)].map(m => decodeXml(m[1]));
  const sheets = Object.keys(zip.files).filter(p => /^xl\/worksheets\/sheet\d+\.xml$/.test(p)).sort(byNumber);
  const out: string[] = [];
  let length = 0;
  for (const [i, p] of sheets.entries()) {
    const xml = await zip.file(p)!.async("string");
    const rows: string[] = [];
    for (const row of xml.matchAll(/<row[^>]*>([\s\S]*?)<\/row>/g)) {
      const cells = [...row[1].matchAll(/<c ([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)].map(c => {
        const type = c[1].match(/t="(\w+)"/)?.[1];
        const v = c[2]?.match(/<v>([^<]*)<\/v>/)?.[1] ?? "";
        if (type === "s") return shared[Number(v)] ?? "";
        if (type === "inlineStr") return xmlText(c[2] ?? "", "t").join("");
        return decodeXml(v);
      });
      if (cells.some(Boolean)) rows.push(cells.join(", "));
      length += rows[rows.length - 1]?.length ?? 0;
      if (length > MAX_TEXT) break;
    }
    out.push(`[sheet: ${names[i] ?? `Sheet ${i + 1}`}]\n${rows.join("\n")}`);
    if (length > MAX_TEXT) break;
  }
  return out.join("\n\n");
}
