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
// SLALOM-ONLY: tracking is inert unless private-repo access is proven (the daily
// instruction sync has succeeded) or an explicit endpoint override is set. A
// client-distributed VSIX therefore never phones home.
// ─────────────────────────────────────────────────────────────────────────────

/** Power Automate HTTP trigger for the "Salesforce DevOps Log" SharePoint list.
 *  Baked in at build time (like the instruction templates) so it is compiled into
 *  dist/extension.js and not written to any client repo. Override with the env var
 *  below for local testing / headless use. */
const USAGE_ENDPOINT_URL =
  "https://default9ca75128a2444596877bf24828e476.e2.environment.api.powerplatform.com" +
  "/powerautomate/automations/direct/workflows/1769101b661f4dedb84aac98cb7cbd1a" +
  "/triggers/manual/paths/invoke?api-version=1&sp=%2Ftriggers%2Fmanual%2Frun&sv=1.0" +
  "&sig=qNWLrDrSlsWrN6qJ98guY4ASGeV6Fnyzp3Pyv0M5QMU";

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

const QUEUE_DIR = path.join(os.homedir(), ".slalom-sdlc");
const QUEUE_FILE = path.join(QUEUE_DIR, "usage-queue.json");

/** Hard caps so a long offline stretch can never grow the queue unbounded. */
const MAX_QUEUE_ITEMS = 500;
const MAX_ITEM_AGE_MS = 14 * 24 * 60 * 60 * 1000; // 14 days

function resolveEndpoint(): string {
  const override = process.env[ENDPOINT_ENV_OVERRIDE]?.trim();
  return override && override.length > 0 ? override : USAGE_ENDPOINT_URL;
}

/** Strict story-key extraction — the ONLY thing pulled out of a user prompt. */
export function extractStoryKey(text: string, projectKey: string): string {
  if (!projectKey) return "";
  const match = text.match(new RegExp(`\\b${projectKey}-\\d+\\b`, "i"));
  return match ? match[0].toUpperCase() : "";
}

export class UsageTracker {
  private flushing = false;
  private cachedUser: string | undefined;

  constructor(
    private readonly context: vscode.ExtensionContext,
    private readonly syncService: InstructionSyncService
  ) {}

  /** Slalom-only gate. Active when an explicit endpoint override is set, or when
   *  the daily instruction sync has ever succeeded (which proves the user can read
   *  the private Slalom/salesforce-devops repo). */
  isEnabled(): boolean {
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

  private async enqueue(entry: UsageEntry): Promise<void> {
    const items = this.readQueue();
    items.push({ id: randomId(), entry });
    this.writeQueue(items);
  }

  private readQueue(): QueuedItem[] {
    try {
      const raw = fs.readFileSync(QUEUE_FILE, "utf-8");
      const parsed = JSON.parse(raw);
      return Array.isArray(parsed) ? (parsed as QueuedItem[]) : [];
    } catch {
      return [];
    }
  }

  private writeQueue(items: QueuedItem[]): void {
    // Prune stale items, then keep only the most recent MAX_QUEUE_ITEMS.
    const cutoff = Date.now() - MAX_ITEM_AGE_MS;
    let pruned = items.filter((it) => {
      const t = Date.parse(it.entry.Date);
      return Number.isNaN(t) || t >= cutoff;
    });
    if (pruned.length > MAX_QUEUE_ITEMS) {
      pruned = pruned.slice(pruned.length - MAX_QUEUE_ITEMS);
    }
    try {
      fs.mkdirSync(QUEUE_DIR, { recursive: true });
      fs.writeFileSync(QUEUE_FILE, JSON.stringify(pruned), "utf-8");
    } catch {
      // If we can't persist, drop silently — tracking must never disrupt the user.
    }
  }

  /** Best-effort background flush. Sends each queued item; keeps failures for retry. */
  async flush(): Promise<void> {
    if (this.flushing || !this.isEnabled()) return;
    this.flushing = true;
    try {
      const pending = this.readQueue();
      if (pending.length === 0) return;

      const endpoint = resolveEndpoint();
      const sent = new Set<string>();
      for (const item of pending) {
        try {
          const ok = await postJson(endpoint, item.entry);
          if (ok) sent.add(item.id);
        } catch {
          // network/endpoint error — leave the item queued for the next flush
        }
      }

      if (sent.size > 0) {
        // Re-read to preserve anything enqueued while we were posting.
        const current = this.readQueue().filter((it) => !sent.has(it.id));
        this.writeQueue(current);
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
