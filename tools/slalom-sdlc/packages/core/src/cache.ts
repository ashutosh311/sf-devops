import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import * as crypto from "node:crypto";

export const DEFAULT_CACHE_DIR = path.join(os.homedir(), ".slalom-sdlc", "instructions-cache");
export const CACHE_CURRENT_DIR = path.join(DEFAULT_CACHE_DIR, "current");

export interface CacheManifestFile {
  checksum: string; // "sha256:<hex>"
  size: number;
}

export interface CacheManifest {
  schemaVersion: string;
  version: string;
  publishedAt: string;
  files: Record<string, CacheManifestFile>;
}

export interface SyncMetadata {
  lastCheck: string | null;
  lastSuccessfulSync: string | null;
  activeVersion: string | null;
  lastError: string | null;
}

// ── Template and instruction readers ─────────────────────────────────────────

export function readCachedTemplate(phase: string, cacheDir: string): string | null {
  return readCacheFile(path.join(cacheDir, `${phase}.md`));
}

export function readCachedInstruction(name: string, cacheDir: string): string | null {
  return readCacheFile(path.join(cacheDir, `${name}.md`));
}

function readCacheFile(filePath: string): string | null {
  try {
    return fs.readFileSync(filePath, "utf-8");
  } catch {
    return null;
  }
}

// ── Sync metadata ──────────────────────────────────────────────────────────

export function readSyncMetadata(cacheDir: string): SyncMetadata {
  const metaPath = path.join(cacheDir, "..", "metadata.json");
  try {
    const raw = fs.readFileSync(metaPath, "utf-8");
    return JSON.parse(raw) as SyncMetadata;
  } catch {
    return { lastCheck: null, lastSuccessfulSync: null, activeVersion: null, lastError: null };
  }
}

export function writeSyncMetadata(cacheDir: string, meta: SyncMetadata): void {
  const metaPath = path.join(cacheDir, "..", "metadata.json");
  fs.mkdirSync(path.dirname(metaPath), { recursive: true });
  fs.writeFileSync(metaPath, JSON.stringify(meta, null, 2), "utf-8");
}

// ── Manifest validation ────────────────────────────────────────────────────

export function validateCacheManifest(cacheDir: string): boolean {
  try {
    const manifestPath = path.join(cacheDir, "manifest.json");
    const raw = fs.readFileSync(manifestPath, "utf-8");
    const manifest = JSON.parse(raw) as CacheManifest;

    if (!manifest.schemaVersion || !manifest.version || !manifest.files) return false;

    for (const [filename, entry] of Object.entries(manifest.files)) {
      const filePath = path.join(cacheDir, filename);
      const content = fs.readFileSync(filePath);

      if (content.length !== entry.size) return false;

      const digest = "sha256:" + crypto.createHash("sha256").update(content).digest("hex");
      if (digest !== entry.checksum) return false;
    }

    return true;
  } catch {
    return false;
  }
}
