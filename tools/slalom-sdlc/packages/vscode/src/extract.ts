import * as fs from "node:fs";
import * as path from "node:path";
import mammoth from "mammoth";
// Import the internal lib entry directly: pdf-parse's index.js runs a debug
// block (reading a bundled sample PDF) when required outside its own package,
// which throws once bundled. The lib entry has no such side effect.
import pdf from "pdf-parse/lib/pdf-parse.js";

/**
 * Rough character budget for a single file's extracted text before it is
 * truncated. Chat models cap total context (commonly ~128k tokens); at ~4
 * chars/token this keeps one file well under the limit while leaving room for
 * the system prompt and the model's response.
 */
export const MAX_CHARS = 240_000;

/** A PDF is treated as image-based when its extracted text is shorter than this. */
const IMAGE_PDF_TEXT_THRESHOLD = 120;

const TEXT_EXTENSIONS = [
  ".md", ".markdown", ".txt", ".text", ".csv", ".tsv", ".json",
  ".log", ".vtt", ".srt", ".rtf", ".html", ".htm", ".xml", ".yaml", ".yml",
];

export interface ExtractResult {
  /** Extracted plain text (possibly truncated). Empty when `error` is set. */
  text: string;
  /** True when the text was cut to fit `MAX_CHARS`. */
  truncated: boolean;
  /** True for PDFs that carry little/no selectable text (e.g. Miro exports). */
  isImagePdf?: boolean;
  /** Human-readable reason the file could not be read, if any. */
  error?: string;
}

/**
 * Extract plain text from a discovery inbox file. Supports UTF-8 text formats,
 * Word (.docx) and PDF (.pdf); other binary formats are reported as errors
 * rather than being read as raw bytes (which would blow the token limit).
 */
export async function extractFileText(filePath: string): Promise<ExtractResult> {
  const ext = path.extname(filePath).toLowerCase();

  try {
    if (ext === ".docx") {
      const { value } = await mammoth.extractRawText({ path: filePath });
      return cap(value ?? "");
    }
    if (ext === ".pdf") {
      const buffer = fs.readFileSync(filePath);
      const data = await pdf(buffer);
      const text = (data.text ?? "").trim();
      const result = cap(text);
      result.isImagePdf = text.length < IMAGE_PDF_TEXT_THRESHOLD;
      return result;
    }
    if (ext === ".doc") {
      return { text: "", truncated: false, error: "legacy .doc is not supported — save as .docx, .pdf or .txt" };
    }
    if (TEXT_EXTENSIONS.includes(ext) || ext === "") {
      const raw = fs.readFileSync(filePath, "utf-8");
      if (looksBinary(raw)) {
        return { text: "", truncated: false, error: "file appears to be binary — export it to .txt, .md, .docx or .pdf" };
      }
      return cap(raw);
    }
    return {
      text: "",
      truncated: false,
      error: `unsupported file type "${ext}" — use .txt, .md, .docx or .pdf`,
    };
  } catch (err) {
    return { text: "", truncated: false, error: `could not read file: ${String((err as Error)?.message ?? err)}` };
  }
}

export interface PdfImage {
  /** 1-based page number. */
  page: number;
  /** PNG-encoded page render. */
  png: Uint8Array;
}

export interface PdfImagesResult {
  images: PdfImage[];
  /** Total pages in the document (may exceed images.length when capped). */
  totalPages: number;
  error?: string;
}

interface MupdfModule {
  Document: {
    openDocument(data: Uint8Array | ArrayBuffer, magic: string): {
      countPages(): number;
      loadPage(n: number): {
        toPixmap(matrix: unknown, colorspace: unknown, alpha: boolean, showExtras?: boolean): { asPNG(): Uint8Array };
      };
    };
  };
  Matrix: { scale(sx: number, sy: number): unknown };
  ColorSpace: { DeviceRGB: unknown };
}

let mupdfPromise: Promise<MupdfModule> | undefined;

/**
 * Load the vendored MuPDF WASM module. esbuild keeps `mupdf` external and the
 * build copies its dist files to `dist/vendor/mupdf`; we import that copy by
 * absolute path so its own `import.meta.url`-based .wasm lookup resolves.
 */
function loadMupdf(): Promise<MupdfModule> {
  if (!mupdfPromise) {
    // __dirname resolves to dist/ in the bundled extension.
    const entry = path.join(__dirname, "vendor", "mupdf", "mupdf.js");
    mupdfPromise = import(pathToImportUrl(entry)) as Promise<MupdfModule>;
  }
  return mupdfPromise;
}

function pathToImportUrl(p: string): string {
  // Dynamic import of an ESM file by absolute path needs a file:// URL on all OSes.
  const resolved = path.resolve(p).replace(/\\/g, "/");
  return `file://${resolved.startsWith("/") ? "" : "/"}${resolved}`;
}

/**
 * Render the pages of a PDF to PNG images so a vision-capable model can
 * interpret diagrams/boards that carry no selectable text.
 */
export async function extractPdfImages(
  filePath: string,
  opts: { maxPages?: number; scale?: number } = {}
): Promise<PdfImagesResult> {
  const maxPages = opts.maxPages ?? 24;
  const scale = opts.scale ?? 1.5;
  try {
    const mupdf = await loadMupdf();
    const buffer = fs.readFileSync(filePath);
    const doc = mupdf.Document.openDocument(new Uint8Array(buffer), "application/pdf");
    const totalPages = doc.countPages();
    const images: PdfImage[] = [];
    const limit = Math.min(totalPages, maxPages);
    for (let i = 0; i < limit; i++) {
      const page = doc.loadPage(i);
      const pixmap = page.toPixmap(mupdf.Matrix.scale(scale, scale), mupdf.ColorSpace.DeviceRGB, false, true);
      images.push({ page: i + 1, png: pixmap.asPNG() });
    }
    return { images, totalPages };
  } catch (err) {
    return { images: [], totalPages: 0, error: String((err as Error)?.message ?? err) };
  }
}

function cap(text: string): ExtractResult {
  const trimmed = text.trim();
  if (trimmed.length <= MAX_CHARS) return { text: trimmed, truncated: false };
  return { text: trimmed.slice(0, MAX_CHARS), truncated: true };
}

/** Heuristic: treat content with many NUL/control bytes as binary. */
function looksBinary(sample: string): boolean {
  const slice = sample.slice(0, 4000);
  if (!slice.length) return false;
  let control = 0;
  for (let i = 0; i < slice.length; i++) {
    const code = slice.charCodeAt(i);
    if (code === 0) return true;
    if (code < 9 || (code > 13 && code < 32)) control++;
  }
  return control / slice.length > 0.1;
}