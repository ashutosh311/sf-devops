import * as vscode from "vscode";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import * as crypto from "node:crypto";
import type { InstructionSyncService, LatestExtensionRelease } from "./sync";
import { getGitHubToken, downloadAsset } from "./github";

const DISMISSED_VERSION_KEY = "slalom-sdlc.updateNudge.dismissedVersion";

// The daily instruction sync (sync.ts) only refreshes prompt/template text — it can never
// update the extension's own compiled code, since this extension is side-loaded from a
// .vsix rather than installed from the Marketplace, so there is no auto-update channel at
// all. This is the only signal a user has that a real code update exists. It reuses the
// release info the daily sync already recorded (sync.ts → LatestExtensionRelease), so it
// costs no extra GitHub API calls to check.
//
// Unlike a plain "go download this yourself" nudge, this offers a one-click install via
// VS Code's own `workbench.extensions.installExtension` command (confirmed to accept a
// local file Uri). The downloaded .vsix is verified against the sha256 digest GitHub
// publishes for every release asset before it is ever handed to that command — mirroring
// the same checksum discipline sync.ts already applies to instructions.zip. If anything
// about the automatic path fails (download, checksum mismatch, or the install command
// itself — e.g. blocked by an org policy disabling VSIX installs) we fall back to simply
// opening the release page so the user can install manually, and we never install
// anything without an explicit "Install Update" click.
export async function maybeOfferExtensionUpdate(
  service: InstructionSyncService,
  context: vscode.ExtensionContext
): Promise<void> {
  const latest = service.getLatestKnownRelease(context);
  if (!latest) return; // no successful sync yet — syncNudge.ts owns nudging that problem

  const currentVersion = context.extension.packageJSON.version as string;
  if (!isNewerVersion(latest.tag, currentVersion)) return;

  if (context.globalState.get<string>(DISMISSED_VERSION_KEY) === latest.tag) return;

  const choice = await vscode.window.showInformationMessage(
    `Slalom SDLC ${latest.tag} is available — you're on v${currentVersion}. This extension is side-loaded from a .vsix and never auto-updates on its own; the daily sync only refreshes prompt text, not code.`,
    "Install Update",
    "View Release Notes",
    "Don't Show Again for This Version"
  );

  if (choice === "Install Update") {
    await installUpdate(context, latest);
  } else if (choice === "View Release Notes") {
    await vscode.env.openExternal(vscode.Uri.parse(latest.htmlUrl));
  } else if (choice === "Don't Show Again for This Version") {
    await context.globalState.update(DISMISSED_VERSION_KEY, latest.tag);
  }
}

async function installUpdate(
  context: vscode.ExtensionContext,
  latest: LatestExtensionRelease
): Promise<void> {
  const installed = await vscode.window.withProgress(
    { location: vscode.ProgressLocation.Notification, title: `Downloading Slalom SDLC ${latest.tag}…` },
    async (): Promise<boolean> => {
      let tempPath: string | undefined;
      try {
        // User explicitly asked to install — an interactive GitHub sign-in prompt is fine here.
        const token = await getGitHubToken(context, true);
        if (!token) throw new Error("No GitHub token available.");

        const buffer = await downloadAsset(latest.vsixAsset.url, token);

        if (latest.vsixAsset.digest) {
          const actual = "sha256:" + crypto.createHash("sha256").update(buffer).digest("hex");
          if (actual !== latest.vsixAsset.digest) {
            throw new Error(
              `Downloaded VSIX failed integrity check (expected ${latest.vsixAsset.digest}, got ${actual}).`
            );
          }
        }

        tempPath = path.join(os.tmpdir(), latest.vsixAsset.name);
        fs.writeFileSync(tempPath, buffer);

        // Confirmed supported: workbench.extensions.installExtension accepts a local
        // file Uri, not just a marketplace extension id.
        await vscode.commands.executeCommand(
          "workbench.extensions.installExtension",
          vscode.Uri.file(tempPath)
        );

        return true;
      } catch (err) {
        void vscode.window.showWarningMessage(
          `Automatic install of Slalom SDLC ${latest.tag} failed: ${String((err as Error)?.message ?? err)}. ` +
            `Opening the release page instead — install the .vsix manually via "Extensions: Install from VSIX…".`
        );
        await vscode.env.openExternal(vscode.Uri.parse(latest.htmlUrl));
        return false;
      } finally {
        if (tempPath) {
          try {
            fs.rmSync(tempPath, { force: true });
          } catch {
            // best-effort cleanup only
          }
        }
      }
    }
  );

  if (!installed) return;

  const reload = await vscode.window.showInformationMessage(
    `Slalom SDLC ${latest.tag} installed. Reload the window to activate it.`,
    "Reload Now",
    "Later"
  );
  if (reload === "Reload Now") {
    await vscode.commands.executeCommand("workbench.action.reloadWindow");
  }
}

/** Compares a `vX.Y.Z` release tag against an installed `X.Y.Z` extension version. */
export function isNewerVersion(remoteTag: string, localVersion: string): boolean {
  const parse = (v: string) =>
    v
      .replace(/^v/, "")
      .split(".")
      .map((n) => parseInt(n, 10) || 0);
  const [rMaj, rMin, rPatch] = parse(remoteTag);
  const [lMaj, lMin, lPatch] = parse(localVersion);
  if (rMaj !== lMaj) return rMaj > lMaj;
  if (rMin !== lMin) return rMin > lMin;
  return rPatch > lPatch;
}
