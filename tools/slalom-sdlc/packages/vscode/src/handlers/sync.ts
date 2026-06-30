import * as vscode from "vscode";
import type { InstructionSyncService } from "../sync";

export async function handleForceSync(
  service: InstructionSyncService,
  context: vscode.ExtensionContext
): Promise<void> {
  await vscode.window.withProgress(
    {
      location: vscode.ProgressLocation.Notification,
      title: "Slalom SDLC: Syncing instructions…",
      cancellable: false,
    },
    async () => {
      await service.forceSync(context);
    }
  );

  const status = service.getStatus();
  if (status.lastError) {
    vscode.window.showWarningMessage(`Slalom SDLC: Sync failed — ${status.lastError}`);
  } else {
    vscode.window.showInformationMessage(
      `Slalom SDLC: Instructions synced (version ${status.activeVersion ?? "unknown"}).`
    );
  }
}

export function handleSyncStatus(service: InstructionSyncService): void {
  const status = service.getStatus();

  const lines: string[] = [];

  if (status.usingCache && status.activeVersion) {
    lines.push(`Active version: ${status.activeVersion} (remote cache)`);
  } else {
    lines.push("Active version: bundled (no remote cache)");
  }

  lines.push(
    status.lastSuccessfulSync
      ? `Last successful sync: ${new Date(status.lastSuccessfulSync).toLocaleString()}`
      : "Last successful sync: never"
  );

  lines.push(
    status.lastCheck
      ? `Last check: ${new Date(status.lastCheck).toLocaleString()}`
      : "Last check: never"
  );

  if (status.lastError) {
    lines.push(`Last error: ${status.lastError}`);
  }

  vscode.window.showInformationMessage(`Slalom SDLC: ${lines.join(" · ")}`);
}
