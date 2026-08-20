import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import * as crypto from "node:crypto";

// The machine-local home directory for all Otto state (instruction cache, sync
// metadata, unsent usage queue). Renamed from the pre-Otto `~/.slalom-sdlc`.
const OTTO_HOME_NAME = ".otto";
const LEGACY_HOME_NAME = ".slalom-sdlc";

export const OTTO_HOME_DIR = path.join(os.homedir(), OTTO_HOME_NAME);
const LEGACY_HOME_DIR = path.join(os.homedir(), LEGACY_HOME_NAME);

/**
 * One-time migration of the machine-local home directory from the pre-Otto
 * `~/.slalom-sdlc` name to `~/.otto`. Moves the instruction cache,
 * `metadata.json` AND the unsent usage queue together.
 *
 * Guarded so it only ever acts once — when the new dir does not yet exist and
 * the legacy dir does. A plain rename is attempted first; if that fails because
 * the two paths live on different filesystems (EXDEV) or the rename is only
 * partially permitted, it falls back to a recursive copy + remove so the
 * unsent usage queue is never orphaned under the legacy path (a pure rename
 * would keep failing on every launch, so "retry next time" would not help).
 * Best-effort throughout — never throws, so a failed move can't block startup.
 */
export function migrateLegacyHomeDir(): void {
  try {
    if (fs.existsSync(OTTO_HOME_DIR)) return;
    if (!fs.existsSync(LEGACY_HOME_DIR)) return;
    try {
      fs.renameSync(LEGACY_HOME_DIR, OTTO_HOME_DIR);
    } catch {
      // Cross-device or partially-permitted rename — copy then remove so the
      // cache and usage queue land under ~/.otto rather than being stranded.
      fs.cpSync(LEGACY_HOME_DIR, OTTO_HOME_DIR, { recursive: true });
      fs.rmSync(LEGACY_HOME_DIR, { recursive: true, force: true });
    }
  } catch {
    // best-effort: never disrupt startup
  }
}

export const DEFAULT_CACHE_DIR = path.join(OTTO_HOME_DIR, "instructions-cache");
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

// RCA skills are synced under a `skills/` subdirectory of the cache so their
// filenames never collide with phase templates or instruction fragments.
export function readCachedSkill(fileBaseName: string, cacheDir: string): string | null {
  return readCacheFile(path.join(cacheDir, "skills", `${fileBaseName}.md`));
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
