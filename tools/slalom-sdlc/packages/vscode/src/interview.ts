import * as vscode from "vscode";
import {
  QUESTIONS,
  STORY_GATE_LABELS,
  EPIC_GATE_LABELS,
  SUBTASK_GATE_LABELS,
  type InterviewAnswers,
  type SdlcConfig,
  type StoryStatusMap,
  type EpicStatusMap,
  type SubTaskStatusMap,
  fetchJiraStatuses,
  type JiraStatus,
  buildSdlcConfig,
  resolveExistingAnswer,
  DEFAULT_JIRA_STATUS_MAP,
  ADO_DEFAULT_STATUS_MAP,
  type StatusMapTriple,
} from "@sdlc/core";

/** Local alias kept for readability in this file's many status-picking helpers. */
type JiraStatusMap = StatusMapTriple;

export async function runVSCodeInterview(
  existing?: Partial<SdlcConfig>
): Promise<SdlcConfig | undefined> {
  const answers = await collectAnswers(existing);
  if (!answers) return undefined;

  if (answers.pmTool === "LOCAL") {
    return buildSdlcConfig(answers);
  }

  const statusMap = await collectStatusMap(answers, existing);
  if (!statusMap) return undefined;

  return buildSdlcConfig(answers, statusMap);
}

// ── Answer collection ─────────────────────────────────────────────────────────

async function collectAnswers(
  existing?: Partial<SdlcConfig>
): Promise<InterviewAnswers | undefined> {
  const answers: Partial<InterviewAnswers> = {};

  for (const q of QUESTIONS) {
    if (q.when && !q.when(answers)) continue;

    const existingValue = resolveExistingAnswer(q.id, existing);
    const def = existingValue ?? q.default;

    switch (q.type) {
      case "text": {
        const result = await vscode.window.showInputBox({
          title: `Slalom SDLC Setup — ${q.section}`,
          prompt: q.label,
          value: (def as string | undefined) ?? "",
          ignoreFocusOut: true,
          validateInput: q.validate
            ? (v) => {
                const r = (q.validate as (v: unknown, a: Partial<InterviewAnswers>) => string | true)(v, answers);
                return r === true ? null : r;
              }
            : undefined,
        });
        if (result === undefined) return undefined; // user pressed Escape
        (answers as Record<string, unknown>)[q.id] = result;
        break;
      }

      case "number": {
        const result = await vscode.window.showInputBox({
          title: `Slalom SDLC Setup — ${q.section}`,
          prompt: q.label,
          value: String(def ?? ""),
          ignoreFocusOut: true,
          validateInput: (v) => {
            if (v === "" || isNaN(Number(v))) return "Must be a number";
            if (q.validate) {
              const r = (q.validate as (v: unknown, a: Partial<InterviewAnswers>) => string | true)(Number(v), answers);
              return r === true ? null : r;
            }
            return null;
          },
        });
        if (result === undefined) return undefined;
        (answers as Record<string, unknown>)[q.id] = Number(result);
        break;
      }

      case "select": {
        const items = (q.options ?? []).map((o) => ({
          label: o.label,
          value: o.value,
          picked: o.value === def,
        }));
        const result = await vscode.window.showQuickPick(items, {
          title: `Slalom SDLC Setup — ${q.section}`,
          placeHolder: q.label,
          ignoreFocusOut: true,
        });
        if (!result) return undefined;
        (answers as Record<string, unknown>)[q.id] = result.value;
        break;
      }

      case "multiselect": {
        const items = (q.options ?? []).map((o) => ({
          label: o.label,
          value: o.value,
          picked: Array.isArray(def) && (def as unknown[]).includes(o.value),
        }));
        const result = await vscode.window.showQuickPick(items, {
          title: `Slalom SDLC Setup — ${q.section}`,
          placeHolder: q.label,
          canPickMany: true,
          ignoreFocusOut: true,
        });
        if (!result || result.length === 0) return undefined;
        (answers as Record<string, unknown>)[q.id] = result.map((r) => r.value);
        break;
      }
    }
  }

  return answers as InterviewAnswers;
}

// ── JIRA status mapping ───────────────────────────────────────────────────────

async function collectStatusMap(
  answers: InterviewAnswers,
  existing?: Partial<SdlcConfig>
): Promise<JiraStatusMap | undefined> {
  if (answers.pmTool === "ADO") {
    return collectAdoStatusMap(existing);
  }

  const token = process.env.ATLASSIAN_TOKEN;

  if (token) {
    const fetched = await fetchJiraStatuses(answers.jiraSite, answers.jiraKey, {
      email: answers.jiraEmail,
      apiToken: token,
    });

    if (fetched.success) {
      return mapStatusesWithQuickPick(fetched.byType, existing);
    }

    vscode.window.showWarningMessage(
      `Could not fetch JIRA statuses: ${fetched.reason}. Using manual entry.`
    );
  }

  const useManual = await vscode.window.showQuickPick(["Enter status names manually", "Use defaults"], {
    title: "JIRA Workflow Setup",
    placeHolder: "No ATLASSIAN_TOKEN found — how would you like to configure JIRA statuses?",
    ignoreFocusOut: true,
  });

  if (!useManual || useManual === "Use defaults") return DEFAULT_JIRA_STATUS_MAP;
  return mapStatusesManually(existing);
}

async function mapStatusesWithQuickPick(
  byType: Record<string, JiraStatus[]>,
  existing?: Partial<SdlcConfig>
): Promise<JiraStatusMap | undefined> {
  const pick = async (gateLabel: string, statuses: JiraStatus[], def?: string) => {
    const result = await vscode.window.showQuickPick(
      statuses.map((s) => ({ label: s.name, picked: s.name === def })),
      { title: "JIRA Status Mapping", placeHolder: gateLabel, ignoreFocusOut: true }
    );
    return result?.label;
  };

  const storyStatuses = byType["story"] ?? [];
  const epicStatuses  = byType["epic"]  ?? [];
  const subTaskStatuses = byType["subTask"] ?? [];
  const ex = existing?.jira?.statusMap;
  const fallback = storyStatuses;

  const story = await pickStoryStatuses(pick, storyStatuses, ex?.story);
  if (!story) return undefined;

  const epic = await pickEpicStatuses(pick, epicStatuses.length ? epicStatuses : fallback, ex?.epic);
  if (!epic) return undefined;

  const subTask = await pickSubTaskStatuses(pick, subTaskStatuses.length ? subTaskStatuses : fallback, ex?.subTask);
  if (!subTask) return undefined;

  return { story, epic, subTask };
}

async function mapStatusesManually(
  existing?: Partial<SdlcConfig>,
  defaults?: JiraStatusMap
): Promise<JiraStatusMap | undefined> {
  const ex = (existing?.jira?.statusMap ?? defaults) as JiraStatusMap | undefined;

  const ask = async (label: string, def?: string): Promise<string | undefined> =>
    vscode.window.showInputBox({
      title: "Status Mapping",
      prompt: label,
      value: def ?? "",
      ignoreFocusOut: true,
    });

  const backlog          = await ask(STORY_GATE_LABELS.backlog,          ex?.story.backlog          ?? "Backlog");
  const refineInProgress = await ask(STORY_GATE_LABELS.refineInProgress, ex?.story.refineInProgress ?? "In Refinement");
  const readyForDesign   = await ask(STORY_GATE_LABELS.readyForDesign,   ex?.story.readyForDesign   ?? "Ready for Design");
  const designInProgress = await ask(STORY_GATE_LABELS.designInProgress, ex?.story.designInProgress ?? "In Design");
  const readyForBuild    = await ask(STORY_GATE_LABELS.readyForBuild,    ex?.story.readyForBuild    ?? "Ready for Build");
  const inDevelopment    = await ask(STORY_GATE_LABELS.inDevelopment,    ex?.story.inDevelopment    ?? "In Development");
  const readyForTest     = await ask(STORY_GATE_LABELS.readyForTest,     ex?.story.readyForTest     ?? "Ready for Test");
  const done             = await ask(STORY_GATE_LABELS.done,             ex?.story.done             ?? "Done");

  if (!backlog || !refineInProgress || !readyForDesign || !designInProgress ||
      !readyForBuild || !inDevelopment || !readyForTest || !done) return undefined;

  return {
    story: { backlog, refineInProgress, readyForDesign, designInProgress, readyForBuild, inDevelopment, readyForTest, done },
    epic:    ex?.epic    ?? { notStarted: "To Do", inProgress: "In Progress", done: "Done" },
    subTask: ex?.subTask ?? { todo: "To Do", inDevelopment: "In Progress", readyForTest: "In Review", done: "Done" },
  };
}

// ── Status pick helpers ───────────────────────────────────────────────────────

type Picker = (label: string, statuses: JiraStatus[], def?: string) => Promise<string | undefined>;

async function pickStoryStatuses(
  pick: Picker,
  statuses: JiraStatus[],
  ex?: JiraStatusMap["story"]
): Promise<JiraStatusMap["story"] | undefined> {
  const backlog          = await pick(STORY_GATE_LABELS.backlog,          statuses, ex?.backlog);
  const refineInProgress = await pick(STORY_GATE_LABELS.refineInProgress, statuses, ex?.refineInProgress);
  const readyForDesign   = await pick(STORY_GATE_LABELS.readyForDesign,   statuses, ex?.readyForDesign);
  const designInProgress = await pick(STORY_GATE_LABELS.designInProgress, statuses, ex?.designInProgress);
  const readyForBuild    = await pick(STORY_GATE_LABELS.readyForBuild,    statuses, ex?.readyForBuild);
  const inDevelopment    = await pick(STORY_GATE_LABELS.inDevelopment,    statuses, ex?.inDevelopment);
  const readyForTest     = await pick(STORY_GATE_LABELS.readyForTest,     statuses, ex?.readyForTest);
  const done             = await pick(STORY_GATE_LABELS.done,             statuses, ex?.done);

  if (!backlog || !refineInProgress || !readyForDesign || !designInProgress ||
      !readyForBuild || !inDevelopment || !readyForTest || !done) return undefined;

  return { backlog, refineInProgress, readyForDesign, designInProgress, readyForBuild, inDevelopment, readyForTest, done };
}

async function pickEpicStatuses(
  pick: Picker,
  statuses: JiraStatus[],
  ex?: JiraStatusMap["epic"]
): Promise<JiraStatusMap["epic"] | undefined> {
  const notStarted = await pick(EPIC_GATE_LABELS.notStarted, statuses, ex?.notStarted);
  const inProgress = await pick(EPIC_GATE_LABELS.inProgress, statuses, ex?.inProgress);
  const done       = await pick(EPIC_GATE_LABELS.done,       statuses, ex?.done);
  if (!notStarted || !inProgress || !done) return undefined;
  return { notStarted, inProgress, done };
}

async function pickSubTaskStatuses(
  pick: Picker,
  statuses: JiraStatus[],
  ex?: JiraStatusMap["subTask"]
): Promise<JiraStatusMap["subTask"] | undefined> {
  const todo          = await pick(SUBTASK_GATE_LABELS.todo,          statuses, ex?.todo);
  const inDevelopment = await pick(SUBTASK_GATE_LABELS.inDevelopment, statuses, ex?.inDevelopment);
  const readyForTest  = await pick(SUBTASK_GATE_LABELS.readyForTest,  statuses, ex?.readyForTest);
  const done          = await pick(SUBTASK_GATE_LABELS.done,          statuses, ex?.done);
  if (!todo || !inDevelopment || !readyForTest || !done) return undefined;
  return { todo, inDevelopment, readyForTest, done };
}

async function collectAdoStatusMap(existing?: Partial<SdlcConfig>): Promise<JiraStatusMap | undefined> {
  const exAdoStatusMap = existing?.ado?.statusMap as JiraStatusMap | undefined;
  const choice = await vscode.window.showQuickPick(["Use ADO defaults", "Customise status names"], {
    title: "Azure DevOps Workflow Setup",
    placeHolder: "How would you like to configure ADO status mapping?",
    ignoreFocusOut: true,
  });

  if (!choice) return undefined;
  if (choice === "Use ADO defaults") return exAdoStatusMap ?? ADO_DEFAULT_STATUS_MAP;
  return mapStatusesManually(existing, exAdoStatusMap ?? ADO_DEFAULT_STATUS_MAP);
}
