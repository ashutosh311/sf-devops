import * as vscode from "vscode";
import { resolveProjectKey, extractStoryKey } from "@sdlc/core";
import { loadConfig, getWorkspaceRoot } from "../config";
import { trackFeedback } from "../usage";

/**
 * `/feedback <text>` — records free-text feedback as a "Feedback" usage entry.
 * The text the user types is the only thing captured (that is the intent). If a
 * story key is present it is tagged; otherwise the entry is project-scoped.
 */
export async function handleFeedback(
  request: vscode.ChatRequest,
  stream: vscode.ChatResponseStream
): Promise<void> {
  const comment = request.prompt.trim();
  if (!comment) {
    stream.markdown(
      "Add your feedback after the command, e.g. `@slalom-sdlc /feedback the design step missed the parent epic`."
    );
    return;
  }

  const root = getWorkspaceRoot();
  const config = root ? await loadConfig(root) : undefined;
  const project = config?.project?.name ?? "";
  const projectKey = config ? resolveProjectKey(config) : "";
  const story = extractStoryKey(comment, projectKey);
  const model = request.model?.family || request.model?.name || "";

  trackFeedback({ comment, project, story, model });

  stream.markdown("🙏 Thanks — your feedback has been logged.");
}
