import * as vscode from "vscode";
import * as https from "node:https";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import type { InstructionSyncService } from "./sync";

// ─────────────────────────────────────────────────────────────────────────────
// Command & feedback usage tracking.
//
// Every agent command (and captured feedback) is recorded as a small event and
// pushed to a Power Automate HTTP trigger that writes to the "Salesforce DevOps
// Log" SharePoint list. Pushing is asynchronous, non-blocking, and best-effort:
// events are appended to a local queue and flushed in the background; failures
// are retained and retried on the next flush / next activation.
//
// PRIVACY: only the fields below are ever sent. Request prompts and model
// responses (which may contain client data) are NEVER transmitted. `Story` is
// extracted from the prompt with a strict `KEY-<number>` regex only; `Comment`
// is populated exclusively for user-entered feedback.
//
// SLALOM-ONLY: tracking is inert unless BOTH (a) the build-time endpoint secret was
// injected (client/local builds compile in "") and (b) private-repo access is
// proven — the daily instruction sync has actually succeeded at least once. Token
// *presence* (GITHUB_TOKEN/GH_TOKEN/etc.) is never treated as proof of access. A
// client-distributed VSIX therefore never phones home. See isEnabled() below.
// ─────────────────────────────────────────────────────────────────────────────

/** Power Automate HTTP trigger endpoint for the "Salesforce DevOps Log" SharePoint
 *  list. The SAS `sig=` in this URL IS the credential — it must never be committed
 *  to source or appear as a literal here. It is injected at build time via esbuild's
 *  `define` (see esbuild.mjs), sourced from the `SLALOM_SDLC_USAGE_ENDPOINT` env var
 *  that only exists inside the release workflow (backed by a GitHub Actions secret).
 *  Local/dev builds compile this in as `""`, which keeps tracking disabled
 *  regardless of sync status (see isEnabled()).
 *
 *  Residual risk: because the value is still compiled into dist/extension.js, it
 *  remains extractable from a distributed .vsix by anyone who unzips it — this is
 *  an accepted trade-off of a SAS-URL-as-bearer-token design (see README).
 *
 *  The `__USAGE_ENDPOINT_URL__` global is declared ambiently in src/global.d.ts. */
const USAGE_ENDPOINT_URL: string =
  typeof __USAGE_ENDPOINT_URL__ === "string" ? __USAGE_ENDPOINT_URL__ : "";

/** Local-developer-only override for manual testing of the queue/flush pipeline —
 *  a deliberate, explicit action by whoever runs the extension, never something a
 *  client build would have set. Distinct from the build-time var above. */
const ENDPOINT_ENV_OVERRIDE = "SLALOM_SDLC_USAGE_URL";

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

const QUEUE_DIR = path.join(os.homedir(), ".slalom-sdlc", "usage-queue");

/** Hard caps so a long offline stretch (or multiple windows) can never grow the
 *  queue directory unbounded. */
const MAX_QUEUE_ITEMS = 500;
const MAX_ITEM_AGE_MS = 14 * 24 * 60 * 60 * 1000; // 14 days

function resolveEndpoint(): string {
  const override = process.env[ENDPOINT_ENV_OVERRIDE]?.trim();
  return override && override.length > 0 ? override : USAGE_ENDPOINT_URL;
}

/** Strict story-key extraction lives in @sdlc/core (see extractStoryKey) — import
 *  it directly from there, not from this module. */

export class UsageTracker {
  private flushing = false;
  private cachedUser: string | undefined;

  constructor(
    private readonly context: vscode.ExtensionContext,
    private readonly syncService: InstructionSyncService
  ) {}

  /** Slalom-only gate. Requires BOTH a resolvable endpoint (build-time secret present,
   *  or an explicit local-testing override) AND proof of private-repo read access —
   *  i.e. the daily instruction sync has actually downloaded a release asset from
   *  the private Slalom/salesforce-devops repo at least once. This intentionally
   *  does NOT consult GITHUB_TOKEN/GH_TOKEN/SLALOM_SDLC_GITHUB_TOKEN or any other
   *  ambient token — a client build may well have one of those set (e.g. their own
   *  CI) with zero access to Slalom's private repo, so token *presence* must never
   *  be treated as proof of being a Slalom consultant. */
  isEnabled(): boolean {
    if (!resolveEndpoint()) return false;
    if (process.env[ENDPOINT_ENV_OVERRIDE]?.trim()) return true;
    try {
      return this.syncService.getStatus().lastSuccessfulSync != null;
    } catch {
      return false;
    }
  }

  async recordCommand(fields: {
    command: string;
    project: string;
    story: string;
    model: string;
    tokens: number;
    comment?: string;
  }): Promise<void> {
    if (!this.isEnabled()) return;
    await this.enqueue({
      Command: fields.command,
      Date: new Date().toISOString(),
      User: await this.resolveUser(),
      Project: fields.project,
      Story: fields.story,
      Model: fields.model,
      Tokens: fields.tokens,
      Comment: fields.comment ?? "",
    });
    void this.flush();
  }

  async recordFeedback(fields: {
    comment: string;
    project?: string;
    story?: string;
    model?: string;
  }): Promise<void> {
    if (!this.isEnabled()) return;
    await this.enqueue({
      Command: "Feedback",
      Date: new Date().toISOString(),
      User: await this.resolveUser(),
      Project: fields.project ?? "",
      Story: fields.story ?? "",
      Model: fields.model ?? "",
      Tokens: 0,
      Comment: fields.comment,
    });
    void this.flush();
  }

  // ── Identity ───────────────────────────────────────────────────────────────

  private async resolveUser(): Promise<string> {
    if (this.cachedUser) return this.cachedUser;

    // 1. Reuse the existing silent GitHub session (same one the sync uses).
    try {
      const session = await vscode.authentication.getSession("github", ["repo"], {
        silent: true,
      });
      const label = session?.account?.label?.trim();
      if (label) {
        this.cachedUser = label;
        return label;
      }
    } catch {
      // fall through
    }

    // 2. Fall back to the local git identity.
    const gitName = await this.gitUserName();
    this.cachedUser = gitName || "unknown";
    return this.cachedUser;
  }

  private gitUserName(): Promise<string> {
    const cwd = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath ?? os.homedir();
    return new Promise((resolve) => {
      execFile("git", ["config", "user.name"], { cwd }, (err, stdout) => {
        resolve(err ? "" : stdout.trim());
      });
    });
  }

  // ── Queue ────────────────────────────────────────────────────────────────
  //
  // One file per event under ~/.slalom-sdlc/usage-queue/, named with a unique
  // id (timestamp + random suffix). This avoids the classic "read whole array,
  // rewrite whole array" race: with a single JSON file, two VS Code windows
  // enqueuing/flushing concurrently can silently clobber each other's writes
  // (last-write-wins data loss). A per-item file makes enqueue a single atomic
  // file create, and flush a per-file POST + per-file delete — at worst two
  // windows racing to flush the SAME file both POST it once (an acceptable
  // duplicate row), but nothing is ever silently dropped.

  private async enqueue(entry: UsageEntry): Promise<void> {
    try {
      fs.mkdirSync(QUEUE_DIR, { recursive: true });
      const id = randomId();
      const file = path.join(QUEUE_DIR, `${id}.json`);
      const item: QueuedItem = { id, entry };
      fs.writeFileSync(file, JSON.stringify(item), { encoding: "utf-8", flag: "wx" });
    } catch {
      // If we can't persist, drop silently — tracking must never disrupt the user.
    }
    this.pruneQueue();
  }

  private listQueueFiles(): string[] {
    try {
      return fs
        .readdirSync(QUEUE_DIR)
        .filter((f) => f.endsWith(".json"))
        .map((f) => path.join(QUEUE_DIR, f));
    } catch {
      return [];
    }
  }

  private readQueueItem(file: string): QueuedItem | undefined {
    try {
      return JSON.parse(fs.readFileSync(file, "utf-8")) as QueuedItem;
    } catch {
      return undefined;
    }
  }

  /** Age- and count-cap housekeeping. Stale/overflow files are deleted outright —
   *  best-effort, never throws. */
  private pruneQueue(): void {
    const cutoff = Date.now() - MAX_ITEM_AGE_MS;
    const files = this.listQueueFiles();
    const withStats = files
      .map((file) => {
        let mtimeMs = 0;
        try {
          mtimeMs = fs.statSync(file).mtimeMs;
        } catch {
          // file may have just been deleted by another window — ignore
        }
        return { file, mtimeMs };
      })
      .sort((a, b) => a.mtimeMs - b.mtimeMs); // oldest first

    for (const { file, mtimeMs } of withStats) {
      if (mtimeMs < cutoff) {
        this.tryUnlink(file);
      }
    }

    const remaining = this.listQueueFiles();
    if (remaining.length > MAX_QUEUE_ITEMS) {
      const sorted = remaining
        .map((file) => ({ file, mtimeMs: this.safeMtime(file) }))
        .sort((a, b) => a.mtimeMs - b.mtimeMs);
      const excess = sorted.length - MAX_QUEUE_ITEMS;
      for (let i = 0; i < excess; i++) {
        this.tryUnlink(sorted[i].file);
      }
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
      // already gone (e.g. another window flushed/pruned it first) — fine
    }
  }

  /** Best-effort background flush. POSTs each queued file's contents; deletes on
   *  success, leaves it in place for retry on failure. */
  async flush(): Promise<void> {
    if (this.flushing || !this.isEnabled()) return;
    this.flushing = true;
    try {
      const files = this.listQueueFiles();
      if (files.length === 0) return;

      const endpoint = resolveEndpoint();
      for (const file of files) {
        const item = this.readQueueItem(file);
        if (!item) {
          // Corrupt/unreadable — remove rather than retry forever.
          this.tryUnlink(file);
          continue;
        }
        try {
          const ok = await postJson(endpoint, item.entry);
          if (ok) this.tryUnlink(file);
        } catch {
          // network/endpoint error — leave the file queued for the next flush
        }
      }
    } finally {
      this.flushing = false;
    }
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Module singleton — lets any handler record events without threading the tracker
// through every call site. All functions no-op safely until initialised / when
// tracking is disabled.
// ─────────────────────────────────────────────────────────────────────────────

let tracker: UsageTracker | undefined;

export function initUsageTracker(
  context: vscode.ExtensionContext,
  syncService: InstructionSyncService
): UsageTracker {
  tracker = new UsageTracker(context, syncService);
  return tracker;
}

export function trackCommand(fields: {
  command: string;
  project: string;
  story: string;
  model: string;
  tokens: number;
  comment?: string;
}): void {
  void tracker?.recordCommand(fields).catch(() => undefined);
}

export function trackFeedback(fields: {
  comment: string;
  project?: string;
  story?: string;
  model?: string;
}): void {
  void tracker?.recordFeedback(fields).catch(() => undefined);
}

export function flushUsageQueue(): void {
  void tracker?.flush().catch(() => undefined);
}

// ── HTTP ─────────────────────────────────────────────────────────────────────

function postJson(endpoint: string, body: unknown): Promise<boolean> {
  return new Promise((resolve, reject) => {
    let url: URL;
    try {
      url = new URL(endpoint);
    } catch (e) {
      reject(e);
      return;
    }

    const payload = Buffer.from(JSON.stringify(body), "utf-8");
    const req = https.request(
      {
        method: "POST",
        hostname: url.hostname,
        port: url.port || 443,
        path: url.pathname + url.search,
        headers: {
          "Content-Type": "application/json",
          "Content-Length": payload.length,
          "User-Agent": "slalom-sdlc-vscode",
        },
      },
      (res) => {
        const status = res.statusCode ?? 0;
        res.resume(); // drain
        resolve(status >= 200 && status < 300);
      }
    );

    req.on("error", reject);
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
