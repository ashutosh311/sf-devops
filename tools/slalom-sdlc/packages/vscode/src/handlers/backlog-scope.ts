import * as vscode from "vscode";
import * as fs from "node:fs";
import * as path from "node:path";
import type { SdlcConfig } from "@sdlc/core";
import { readBacklogWorkbook, type BacklogStory, type BacklogEpic } from "../backlog";

/**
 * Shared "local mode" eligibility scanning + scope picker used by Refine, Design,
 * Build, and Test so each agent's menu can offer explicit, pre-computed choices
 * (all eligible / by epic / a specific story) instead of asking the model to pick
 * a story in-flow.
 */

export type EligibleStory = BacklogStory & { epicLabel: string; storyKey: string };

export interface EligibilityOptions {
  /** Story-folder-relative files that must all exist for the story to be eligible. */
  requireFiles: string[];
  /** Story-folder-relative files that must NOT exist yet (work not already done). */
  excludeFiles: string[];
}

export interface ScanResult {
  eligible: EligibleStory[];
  backlogPath: string;
  backlogExists: boolean;
}

/** Absolute path to a story's local artifact folder. */
export function storyFolderPath(root: string, config: SdlcConfig, story: EligibleStory | BacklogStory & { storyKey?: string }): string {
  const epicId = (story.epic_id ?? "ungrouped").trim() || "ungrouped";
  const key = (story as EligibleStory).storyKey ?? story.pm_key ?? story.id ?? "";
  return path.join(root, config.paths.artifacts, "04 - Backlog", "stories", epicId, key);
}

/** Scan the local backlog workbook + story folders for stories matching the given eligibility rules. */
export async function scanEligibleStories(
  root: string,
  config: SdlcConfig,
  opts: EligibilityOptions
): Promise<ScanResult> {
  const backlogPath = path.join(root, config.paths.artifacts, "04 - Backlog", "Backlog Tracker.xlsx");
  if (!fs.existsSync(backlogPath)) {
    return { eligible: [], backlogPath, backlogExists: false };
  }

  const data = await readBacklogWorkbook(backlogPath);
  const epicMap = new Map<string, BacklogEpic>(
    (data.epics ?? []).filter((e): e is BacklogEpic & { id: string } => !!e.id).map((e) => [e.id, e])
  );

  const eligible: EligibleStory[] = [];
  for (const story of data.stories ?? []) {
    const key = story.pm_key || story.id;
    if (!key) continue;
    const epicId = (story.epic_id || "ungrouped").trim() || "ungrouped";
    const base = path.join(root, config.paths.artifacts, "04 - Backlog", "stories", epicId, key);
    const hasAllRequired = opts.requireFiles.every((f) => fs.existsSync(path.join(base, f)));
    const hasAnyExcluded = opts.excludeFiles.some((f) => fs.existsSync(path.join(base, f)));
    if (hasAllRequired && !hasAnyExcluded) {
      const epic = epicMap.get(story.epic_id ?? "");
      eligible.push({ ...story, epicLabel: epic?.name ?? epicId, storyKey: key });
    }
  }
  return { eligible, backlogPath, backlogExists: true };
}

/** Present an "all / by epic / specific story" picker over an eligible-story list. */
export async function pickStoryScope(
  eligible: EligibleStory[],
  title: string
): Promise<EligibleStory[] | undefined> {
  const uniqueEpicIds = [...new Set(eligible.map((s) => s.epic_id ?? "ungrouped"))];

  const scopeItems: (vscode.QuickPickItem & { value: string })[] = [
    {
      label: "$(checklist) All eligible stories",
      description: `${eligible.length} story/stories across ${uniqueEpicIds.length} epic(s)`,
      value: "all",
    },
    ...uniqueEpicIds.map((epicId) => {
      const epicStories = eligible.filter((s) => (s.epic_id ?? "ungrouped") === epicId);
      const epicLabel = epicStories[0]?.epicLabel ?? epicId;
      return {
        label: `$(symbol-class) Epic: ${epicLabel}`,
        description: `${epicStories.length} story/stories`,
        value: `epic:${epicId}`,
      };
    }),
    {
      label: "$(list-ordered) Specific story",
      description: "pick a single story",
      value: "story",
    },
  ];

  const scopePick = await vscode.window.showQuickPick(scopeItems, {
    title,
    placeHolder: "Choose scope",
    ignoreFocusOut: true,
  });
  if (!scopePick) return undefined;

  if (scopePick.value === "all") return eligible;

  if (scopePick.value.startsWith("epic:")) {
    const epicId = scopePick.value.slice(5);
    return eligible.filter((s) => (s.epic_id ?? "ungrouped") === epicId);
  }

  const storyItems = eligible.map((s) => ({
    label: `$(symbol-method) ${s.storyKey}`,
    description: s.user_story?.slice(0, 80) ?? "",
    detail: `Epic: ${s.epicLabel}`,
    storyKey: s.storyKey,
  }));
  const storyPick = await vscode.window.showQuickPick(storyItems, {
    title: `${title} — Select Story`,
    placeHolder: "Choose a story",
    matchOnDescription: true,
    ignoreFocusOut: true,
  });
  if (!storyPick) return undefined;
  return eligible.filter((s) => s.storyKey === storyPick.storyKey);
}
