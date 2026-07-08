import * as vscode from "vscode";
import type { InstructionSyncService } from "./sync";
import { handleForceSync } from "./handlers/sync";

const NUDGE_SHOWN_KEY = "slalom-sdlc.syncNudge.shownSinceLastSuccess";
const NUDGE_DISABLED_KEY = "slalom-sdlc.syncNudge.disabled";

// Background sync (sync.ts `syncIfDue`) never prompts for GitHub auth and fails completely
// silently when no token is available — a user who never manually runs "Sync Instructions"
// can be stuck on stale instructions indefinitely with no indication anything is wrong.
// This surfaces that stuck state once per failure streak and offers a way to fix it.
export async function maybeShowSyncNudge(
  service: InstructionSyncService,
  context: vscode.ExtensionContext
): Promise<void> {
  if (context.globalState.get<boolean>(NUDGE_DISABLED_KEY, false)) return;

  const status = service.getStatus();

  if (!status.lastError) {
    // Healthy (or never attempted yet) — re-arm so a future regression can nudge again.
    if (context.globalState.get<boolean>(NUDGE_SHOWN_KEY, false)) {
      await context.globalState.update(NUDGE_SHOWN_KEY, false);
    }
    return;
  }

  if (context.globalState.get<boolean>(NUDGE_SHOWN_KEY, false)) return; // already nudged this streak
  await context.globalState.update(NUDGE_SHOWN_KEY, true);

  const message = status.activeVersion
    ? `Slalom SDLC: instructions haven't updated since version ${status.activeVersion} — the last sync attempt failed. Some agents may be using outdated guidance.`
    : `Slalom SDLC: instructions have never synced successfully. Some agent capabilities may be limited until you sign in to GitHub.`;

  const choice = await vscode.window.showWarningMessage(message, "Sync Now", "Don't Show Again");

  if (choice === "Sync Now") {
    await handleForceSync(service, context);
  } else if (choice === "Don't Show Again") {
    await context.globalState.update(NUDGE_DISABLED_KEY, true);
  }
}
