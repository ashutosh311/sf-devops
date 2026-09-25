import * as vscode from "vscode";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import {
  UsageQueue,
  USAGE_QUEUE_DIR,
  resolveUsageIdentity,
  isSlalomEmail,
  validateSlalomEmail,
  saveUserEmailOverride,
  type UsageEntry,
} from "@otto/core";
import type { InstructionSyncService } from "./sync";
import { githubGet } from "./github";

// ─────────────────────────────────────────────────────────────────────────────
// Command & feedback usage tracking.
//
// Every agent command (and captured feedback) is recorded as a small event and
// pushed to a Power Automate HTTP trigger that writes to the "Salesforce DevOps
// Log" SharePoint list. Pushing is asynchronous, non-blocking, and best-effort:
// events are appended to a local queue (shared with the MCP server — see
// @otto/core's usage.ts) and flushed in the background; failures are retained
// and retried on the next flush / next activation.
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
//
// The MCP server (packages/mcp/src/usage.ts) tracks the same event shape to the
// same endpoint, but with a simpler gate — see that file for why.
// ─────────────────────────────────────────────────────────────────────────────

/** Power Automate HTTP trigger endpoint for the "Salesforce DevOps Log" SharePoint
 *  list. The SAS `sig=` in this URL IS the credential — it must never be committed
 *  to source or appear as a literal here. It is injected at build time via esbuild's
 *  `define` (see esbuild.mjs), sourced from the `OTTO_USAGE_ENDPOINT` env var
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
const ENDPOINT_ENV_OVERRIDE = "OTTO_USAGE_URL";

/** Opt-in verbose debug logging for diagnosing why a queued entry isn't reaching the
 *  endpoint. OFF by default (zero extra I/O for normal use). When set to any truthy
 *  value, enqueue()/flush() append one line per event to DEBUG_LOG_PATH. The log
 *  NEVER contains the full endpoint URL (only its hostname — the `sig=` SAS token
 *  is the credential and must never be written to disk in plain text) nor any entry
 *  payload contents. See README → "Debugging tracking". */
const DEBUG_ENV_VAR = "OTTO_USAGE_DEBUG";

function isDebugEnabled(): boolean {
  const v = process.env[DEBUG_ENV_VAR]?.trim().toLowerCase();
  return !!v && v !== "0" && v !== "false";
}

const DEBUG_LOG_PATH = path.join(USAGE_QUEUE_DIR, ".debug.log");

/** Best-effort append-only debug log write — never throws, never disrupts tracking. */
function writeDebugLog(line: string): void {
  if (!isDebugEnabled()) return;
  try {
    fs.mkdirSync(path.dirname(DEBUG_LOG_PATH), { recursive: true });
    fs.appendFileSync(DEBUG_LOG_PATH, `${new Date().toISOString()} ${line}\n`, "utf-8");
  } catch {
    // debug logging must never disrupt tracking or the user
  }
}

const USER_AGENT = "otto-vscode";

function resolveEndpoint(): string {
  const override = process.env[ENDPOINT_ENV_OVERRIDE]?.trim();
  return override && override.length > 0 ? override : USAGE_ENDPOINT_URL;
}

/** Strict story-key extraction lives in @otto/core (see extractStoryKey) — import
 *  it directly from there, not from this module. */

export class UsageTracker {
  private cachedUser: string | undefined;
  private readonly queue = new UsageQueue();

  constructor(
    private readonly context: vscode.ExtensionContext,
    private readonly syncService: InstructionSyncService
  ) {}

  /** Slalom-only gate. Requires BOTH a resolvable endpoint (build-time secret present,
   *  or an explicit local-testing override) AND proof of private-repo read access —
   *  i.e. the daily instruction sync has actually downloaded a release asset from
   *  the private Slalom/salesforce-devops repo at least once. This intentionally
   *  does NOT consult GITHUB_TOKEN/GH_TOKEN/OTTO_GITHUB_TOKEN or any other
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
    this.enqueueAndFlush({
      Command: fields.command,
      Date: new Date().toISOString(),
      User: await this.resolveUser(),
      Project: fields.project,
      Story: fields.story,
      Model: fields.model,
      Tokens: fields.tokens,
      Comment: fields.comment ?? "",
    });
  }

  async recordFeedback(fields: {
    comment: string;
    project?: string;
    story?: string;
    model?: string;
  }): Promise<void> {
    if (!this.isEnabled()) return;
    this.enqueueAndFlush({
      Command: "Feedback",
      Date: new Date().toISOString(),
      User: await this.resolveUser(),
      Project: fields.project ?? "",
      Story: fields.story ?? "",
      Model: fields.model ?? "",
      Tokens: 0,
      Comment: fields.comment,
    });
  }

  private enqueueAndFlush(entry: UsageEntry): void {
    this.queue.enqueue(entry, writeDebugLog);
    void this.flush();
  }

  // ── Identity ───────────────────────────────────────────────────────────────

  // Resolve a `@slalom.com` address — the SharePoint `User` column is a Person
  // field, so a client email fails the flow. Selection rules (override, Slalom
  // email, raw fallback — never a guess) live in @otto/core's
  // resolveUsageIdentity, shared with the MCP server. Git is checked first; the
  // VS Code-only sources below are only consulted when git has no Slalom email
  // and no override is set. Each is silent (never prompts) and best-effort:
  //   • VS Code's Microsoft/Entra session label — typically the UPN/email.
  //   • All verified GitHub emails via the REST API — requires the `user:email`
  //     scope; requested silently, so a no-op if the user hasn't granted it.
  //   • The GitHub session's username — raw last-resort fallback only.
  // If none is a Slalom address, ensureSlalomIdentity asks the user for one.
  private async resolveUser(): Promise<string> {
    if (this.cachedUser) return this.cachedUser;
    this.cachedUser = await resolveUsageIdentity(this.gitCwd(), () => this.sessionCandidates());
    return this.cachedUser;
  }

  /** Once per window, so dismissing the box doesn't re-ask on every command. */
  private askedForEmail = false;

  /** Before an agent runs: if tracking is on and no Slalom address can be found,
   *  ask for one and save it as `git config --global otto.email`. Never throws. */
  async ensureSlalomIdentity(): Promise<void> {
    try {
      if (!this.isEnabled() || this.askedForEmail) return;
      if (isSlalomEmail(await this.resolveUser())) return;
      this.askedForEmail = true;

      const email = await vscode.window.showInputBox({
        title: "Otto — Slalom email",
        prompt:
          "Otto records command usage against your Slalom account, but your git email isn't a Slalom address. " +
          "It's saved once as `git config --global otto.email`.",
        placeHolder: "firstname.lastname@slalom.com",
        ignoreFocusOut: true,
        validateInput: (value) => validateSlalomEmail(value),
      });
      if (!email) return;

      this.cachedUser = await saveUserEmailOverride(email);
      writeDebugLog("identity saved to git config otto.email");
    } catch (e) {
      writeDebugLog(`identity prompt error=${e instanceof Error ? e.message : String(e)}`);
    }
  }

  private async sessionCandidates(): Promise<{ emails: string[]; names: string[] }> {
    const emails: string[] = [];
    const names: string[] = [];

    try {
      const msSession = await vscode.authentication.getSession("microsoft", ["email"], {
        silent: true,
      });
      const msLabel = msSession?.account?.label?.trim();
      if (msLabel && msLabel.includes("@")) emails.push(msLabel);
    } catch {
      // Microsoft auth provider unavailable or no cached session.
    }

    try {
      emails.push(...(await this.resolveGitHubEmails()));
    } catch {
      // Scope not granted, API error, or offline.
    }

    // GitHub username — never derivable to first.last, only a raw fallback.
    try {
      const session = await vscode.authentication.getSession("github", ["repo"], {
        silent: true,
      });
      const label = session?.account?.label?.trim();
      if (label) names.push(label);
    } catch {
      // No cached GitHub session.
    }

    return { emails, names };
  }

  private gitCwd(): string {
    return vscode.workspace.workspaceFolders?.[0]?.uri.fsPath ?? os.homedir();
  }

  // Requests the `user:email` scope silently (no-op if not already granted) and
  // fetches the account's verified emails via GitHub's REST API, primary first.
  // Distinct from the `repo`-scoped session used elsewhere: VS Code treats
  // different scope sets as potentially different sessions, so this is a
  // separate silent lookup.
  private async resolveGitHubEmails(): Promise<string[]> {
    const session = await vscode.authentication.getSession("github", ["user:email"], {
      silent: true,
    });
    const token = session?.accessToken;
    if (!token) return [];

    const emails = await githubGet<Array<{ email: string; primary: boolean; verified: boolean }>>(
      "/user/emails",
      token
    );
    return emails
      .filter((e) => e.verified)
      .sort((a, b) => Number(b.primary) - Number(a.primary))
      .map((e) => e.email);
  }

  /** Best-effort background flush — delegates to the shared queue. */
  async flush(): Promise<void> {
    if (!this.isEnabled()) {
      writeDebugLog("flush-skip reason=not-enabled");
      return;
    }
    await this.queue.flush(resolveEndpoint(), USER_AGENT, writeDebugLog);
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

export async function ensureSlalomIdentity(): Promise<void> {
  await tracker?.ensureSlalomIdentity();
}
