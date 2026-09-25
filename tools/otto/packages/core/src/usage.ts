import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
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

// ── Identity ─────────────────────────────────────────────────────────────────
//
// The Power Automate flow writes `User` into a SharePoint Person column, which
// only accepts an account in Slalom's tenant. Consultants on client projects
// usually have a repo-local (or even global) git identity set to their *client*
// address, so sending that as-is fails the flow's Create_item action and the row
// is lost. Identity resolution therefore looks for a real `@slalom.com` address —
// it never guesses one:
//   1. An explicit override — `OTTO_USER_EMAIL` env var, else
//      `git config otto.email` (set globally by the front ends when they ask).
//   2. Any candidate email already on the Slalom domain.
//   3. Whatever raw identity we have, then "unknown".
// When the result isn't a Slalom address, each front end asks the user for it
// (see `isSlalomEmail` / `saveUserEmailOverride`) the next time an agent runs.

export const SLALOM_EMAIL_DOMAIN = "slalom.com";
export const USER_EMAIL_ENV_OVERRIDE = "OTTO_USER_EMAIL";
const USER_EMAIL_GIT_KEY = "otto.email";

export interface IdentityCandidates {
  emails: string[];
  names: string[];
}

export function isSlalomEmail(email: string): boolean {
  return /^[^\s@]+@slalom\.com$/i.test(email.trim());
}

/** Validation message for a user-entered address, or `undefined` if it's usable. */
export function validateSlalomEmail(input: string): string | undefined {
  return isSlalomEmail(input) ? undefined : `Enter your Slalom email address, e.g. firstname.lastname@${SLALOM_EMAIL_DOMAIN}`;
}

/**
 * A pre-fill for the "enter your Slalom email" prompt — never used without the
 * user confirming it. On Slalom-provisioned machines the OS login name is the
 * Slalom username (e.g. `mark.wraith`), so `<login>@slalom.com` is usually
 * right. Only offered when the login is `first.last`-shaped: a bare `john` or
 * `admin` on a personal or client machine could match a *different* real
 * Slalom account, which is worse than an empty box.
 */
export function suggestSlalomEmail(): string | undefined {
  let login = "";
  try {
    login = os.userInfo().username;
  } catch {
    login = process.env.USER ?? process.env.LOGNAME ?? process.env.USERNAME ?? "";
  }
  return slalomEmailForLogin(login);
}

/** Pure step behind `suggestSlalomEmail` — exported for unit tests. */
export function slalomEmailForLogin(login: string): string | undefined {
  const name = login.trim().toLowerCase();
  return /^[a-z][a-z-]*\.[a-z][a-z-]*$/.test(name) ? `${name}@${SLALOM_EMAIL_DOMAIN}` : undefined;
}

/** Pure selection step — exported so it can be unit-tested without git. */
export function pickUsageIdentity(candidates: IdentityCandidates, override?: string): string {
  const explicit = override?.trim();
  if (explicit && explicit.includes("@")) return explicit.toLowerCase();

  const emails = candidates.emails.map((e) => e.trim()).filter((e) => e.includes("@"));
  const names = candidates.names.map((n) => n.trim()).filter(Boolean);

  const slalom = emails.find(isSlalomEmail);
  if (slalom) return slalom.toLowerCase();

  return emails[0] ?? names[0] ?? "unknown";
}

/** The explicit override, if one is set: env var first, then `git config otto.email`. */
export async function resolveUserEmailOverride(cwd: string): Promise<string | undefined> {
  const fromEnv = process.env[USER_EMAIL_ENV_OVERRIDE]?.trim();
  if (fromEnv) return fromEnv;
  return (await gitConfig(cwd, USER_EMAIL_GIT_KEY)) || undefined;
}

/** Persist the user's Slalom address as `git config --global otto.email`, so
 *  every project and every Otto front end on this machine picks it up. Returns
 *  the saved (normalised) address; throws if the address is invalid or git fails. */
export async function saveUserEmailOverride(email: string): Promise<string> {
  const value = email.trim().toLowerCase();
  const invalid = validateSlalomEmail(value);
  if (invalid) throw new Error(invalid);
  await new Promise<void>((resolve, reject) => {
    execFile("git", ["config", "--global", USER_EMAIL_GIT_KEY, value], { cwd: os.homedir() }, (err) =>
      err ? reject(err) : resolve()
    );
  });
  return value;
}

/** Effective (repo-local wins) and global git identity. The global identity is
 *  collected separately because it's the one most likely to still be Slalom's
 *  when a client repo overrides user.email locally. */
export async function gitIdentityCandidates(cwd: string): Promise<IdentityCandidates> {
  const [email, globalEmail, name, globalName] = await Promise.all([
    gitConfig(cwd, "user.email"),
    gitConfig(cwd, "user.email", true),
    gitConfig(cwd, "user.name"),
    gitConfig(cwd, "user.name", true),
  ]);
  return {
    emails: [...new Set([email, globalEmail].filter(Boolean))],
    names: [...new Set([name, globalName].filter(Boolean))],
  };
}

/**
 * Resolve the `User` value for a usage entry. Silent and best-effort — never
 * prompts, never throws. Front ends with richer identity sources (e.g. VS
 * Code's Microsoft/GitHub sessions) pass them as `extra`; git candidates are
 * always considered first.
 */
export async function resolveUsageIdentity(
  cwd: string,
  extra?: () => Promise<Partial<IdentityCandidates>>,
): Promise<string> {
  const override = await resolveUserEmailOverride(cwd);
  const git = await gitIdentityCandidates(cwd);
  if (override || git.emails.some(isSlalomEmail) || !extra) return pickUsageIdentity(git, override);

  let more: Partial<IdentityCandidates> = {};
  try {
    more = await extra();
  } catch {
    // richer sources are optional — git candidates alone still resolve
  }
  return pickUsageIdentity({
    emails: [...git.emails, ...(more.emails ?? [])],
    names: [...git.names, ...(more.names ?? [])],
  });
}

function gitConfig(cwd: string, key: string, global = false): Promise<string> {
  return new Promise((resolve) => {
    execFile("git", ["config", ...(global ? ["--global"] : []), key], { cwd }, (err, stdout) => {
      resolve(err ? "" : stdout.trim());
    });
  });
}
