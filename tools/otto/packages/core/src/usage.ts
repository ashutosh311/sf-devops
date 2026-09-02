import * as fs from "node:fs";
import * as path from "node:path";
import * as http from "node:http";
import * as https from "node:https";
import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import { OTTO_HOME_DIR } from "./cache.js";

// ─────────────────────────────────────────────────────────────────────────────
// Shared usage-tracking primitives — the queue, the POST, and the git-identity
// fallback are identical regardless of which front end (VS Code, MCP) is doing
// the tracking, so they live here once. Each front end still owns its own
// enable-gate and its own richer identity resolution (e.g. VS Code layers its
// Microsoft/GitHub session lookups on top of resolveGitIdentity below) — those
// differ enough per-surface that folding them in here would just be indirection.
//
// See packages/vscode/src/usage.ts for the full privacy/gating writeup this
// module implements the mechanics for.
// ─────────────────────────────────────────────────────────────────────────────

/** The exact JSON body posted to the endpoint — mirrors the SharePoint columns. */
export interface UsageEntry {
  Command: string;
  Date: string; // ISO 8601
  User: string;
  Project: string;
  Story: string;
  Model: string;
  Tokens: number;
  Comment: string;
}

interface QueuedItem {
  id: string;
  entry: UsageEntry;
}

export const USAGE_QUEUE_DIR = path.join(OTTO_HOME_DIR, "usage-queue");

/** Hard caps so a long offline stretch (or multiple processes) can never grow
 *  the queue directory unbounded. */
const MAX_QUEUE_ITEMS = 500;
const MAX_ITEM_AGE_MS = 14 * 24 * 60 * 60 * 1000; // 14 days

interface PostResult {
  ok: boolean;
  status?: number;
  error?: string;
}

/** Raw POST of one usage entry. Never rejects — resolves with `ok: false` on
 *  any failure so callers can treat it uniformly.
 *
 *  The real endpoint is always `https://` — a Power Automate URL. But the
 *  `OTTO_USAGE_URL` local-testing override (see each front end's usage.ts) is
 *  a deliberate escape hatch for pointing at a throwaway local test server,
 *  which is commonly `http://localhost:...`. Picking the request module from
 *  the URL's actual protocol means that case gets a real connection instead
 *  of `https.request` silently attempting (and failing) a TLS handshake
 *  against a plain HTTP port. Anything other than http/https is rejected
 *  up front with a clear error rather than an opaque request failure. */
export function postUsageEntry(endpoint: string, entry: UsageEntry, userAgent: string): Promise<PostResult> {
  return new Promise((resolve) => {
    let url: URL;
    try {
      url = new URL(endpoint);
    } catch (e) {
      resolve({ ok: false, error: e instanceof Error ? e.message : String(e) });
      return;
    }

    const transport = url.protocol === "http:" ? http : url.protocol === "https:" ? https : null;
    if (!transport) {
      resolve({ ok: false, error: `unsupported protocol "${url.protocol}" (expected http: or https:)` });
      return;
    }
    const defaultPort = transport === https ? 443 : 80;

    const payload = Buffer.from(JSON.stringify(entry), "utf-8");
    const req = transport.request(
      {
        method: "POST",
        hostname: url.hostname,
        port: url.port || defaultPort,
        path: url.pathname + url.search,
        headers: {
          "Content-Type": "application/json",
          "Content-Length": payload.length,
          "User-Agent": userAgent,
        },
      },
      (res) => {
        const status = res.statusCode ?? 0;
        res.resume(); // drain
        resolve({ ok: status >= 200 && status < 300, status });
      }
    );

    req.on("error", (e: NodeJS.ErrnoException) => {
      resolve({ ok: false, error: e.code ?? e.message });
    });
    req.write(payload);
    req.end();
  });
}

function randomId(): string {
  try {
    return randomUUID();
  } catch {
    return Date.now().toString(36) + Math.random().toString(36).slice(2, 10);
  }
}

/**
 * Best-effort, append-only, per-file usage queue shared by every Otto front
 * end that tracks usage. One file per event under `~/.otto/usage-queue/`,
 * named with a unique id — this avoids the classic "read whole array,
 * rewrite whole array" race: two processes (two VS Code windows, or a VS Code
 * window and an MCP server, sharing the same machine-local queue dir)
 * enqueuing/flushing concurrently can silently clobber each other's writes
 * with a single JSON file. A per-item file makes enqueue a single atomic
 * file create, and flush a per-file POST + per-file delete — at worst two
 * processes racing to flush the SAME file both POST it once (an acceptable
 * duplicate row), but nothing is ever silently dropped.
 */
export class UsageQueue {
  private flushing = false;

  enqueue(entry: UsageEntry, onDebug?: (line: string) => void): void {
    let id = "unknown";
    try {
      fs.mkdirSync(USAGE_QUEUE_DIR, { recursive: true });
      id = randomId();
      const file = path.join(USAGE_QUEUE_DIR, `${id}.json`);
      const item: QueuedItem = { id, entry };
      fs.writeFileSync(file, JSON.stringify(item), { encoding: "utf-8", flag: "wx" });
      onDebug?.(`enqueue ok id=${id} command=${entry.Command}`);
    } catch (e) {
      onDebug?.(
        `enqueue error id=${id} command=${entry.Command} error=${e instanceof Error ? e.message : String(e)}`
      );
      // If we can't persist, drop silently — tracking must never disrupt the user.
    }
    this.prune();
  }

  private listFiles(): string[] {
    try {
      return fs
        .readdirSync(USAGE_QUEUE_DIR)
        .filter((f) => f.endsWith(".json"))
        .map((f) => path.join(USAGE_QUEUE_DIR, f));
    } catch {
      return [];
    }
  }

  private readItem(file: string): QueuedItem | undefined {
    try {
      return JSON.parse(fs.readFileSync(file, "utf-8")) as QueuedItem;
    } catch {
      return undefined;
    }
  }

  private safeMtime(file: string): number {
    try {
      return fs.statSync(file).mtimeMs;
    } catch {
      return 0;
    }
  }

  private tryUnlink(file: string): void {
    try {
      fs.unlinkSync(file);
    } catch {
      // already gone (e.g. another process flushed/pruned it first) — fine
    }
  }

  /** Age- and count-cap housekeeping. Stale/overflow files are deleted
   *  outright — best-effort, never throws. */
  private prune(): void {
    const cutoff = Date.now() - MAX_ITEM_AGE_MS;
    const files = this.listFiles();
    const withStats = files
      .map((file) => ({ file, mtimeMs: this.safeMtime(file) }))
      .sort((a, b) => a.mtimeMs - b.mtimeMs); // oldest first

    for (const { file, mtimeMs } of withStats) {
      if (mtimeMs < cutoff) this.tryUnlink(file);
    }

    const remaining = this.listFiles()
      .map((file) => ({ file, mtimeMs: this.safeMtime(file) }))
      .sort((a, b) => a.mtimeMs - b.mtimeMs);
    const excess = remaining.length - MAX_QUEUE_ITEMS;
    for (let i = 0; i < excess; i++) this.tryUnlink(remaining[i].file);
  }

  /** Best-effort flush. POSTs each queued file's contents; deletes on success,
   *  leaves it in place for retry on failure. Never throws. */
  async flush(endpoint: string, userAgent: string, onDebug?: (line: string) => void): Promise<void> {
    if (this.flushing) {
      onDebug?.("flush-skip reason=already-flushing");
      return;
    }
    this.flushing = true;
    try {
      const files = this.listFiles();
      if (files.length === 0) {
        onDebug?.("flush-skip reason=empty-queue");
        return;
      }

      let endpointHost = "unresolved";
      try {
        endpointHost = new URL(endpoint).hostname;
      } catch {
        // logged per-file below via postUsageEntry's own error path
      }
      onDebug?.(`flush-attempt count=${files.length} host=${endpointHost}`);

      for (const file of files) {
        const item = this.readItem(file);
        if (!item) {
          // Corrupt/unreadable — remove rather than retry forever.
          onDebug?.(`flush-error file=${path.basename(file)} error=unreadable-item`);
          this.tryUnlink(file);
          continue;
        }
        try {
          const result = await postUsageEntry(endpoint, item.entry, userAgent);
          if (result.ok) {
            onDebug?.(`flush-success id=${item.id} status=${result.status ?? "?"}`);
            this.tryUnlink(file);
          } else {
            onDebug?.(
              `flush-error id=${item.id} status=${result.status ?? "n/a"} error=${result.error ?? "non-2xx"}`
            );
          }
        } catch (e) {
          // postUsageEntry resolves rather than rejects, but guard defensively so
          // one bad file can never abort the whole flush.
          onDebug?.(`flush-error id=${item.id} error=${e instanceof Error ? e.message : String(e)}`);
          // leave the file queued for the next flush
        }
      }
    } finally {
      this.flushing = false;
    }
  }
}

/**
 * Local git identity fallback shared by every front end: email, then
 * user.name, then "unknown". Silent and best-effort — never prompts, never
 * throws. Front ends with a richer identity source (e.g. VS Code's
 * Microsoft/GitHub session lookups) should try those first and only fall
 * back to this.
 */
export async function resolveGitIdentity(cwd: string): Promise<string> {
  const email = await gitConfig(cwd, "user.email");
  if (email) return email;
  const name = await gitConfig(cwd, "user.name");
  return name || "unknown";
}

function gitConfig(cwd: string, key: string): Promise<string> {
  return new Promise((resolve) => {
    execFile("git", ["config", key], { cwd }, (err, stdout) => {
      resolve(err ? "" : stdout.trim());
    });
  });
}
