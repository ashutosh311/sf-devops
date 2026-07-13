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
  DEFAULT_PATHS,
  CONFIG_VERSION,
  TOOL_VERSION,
  type Phase,
} from "@sdlc/core";

/** Local type alias for JIRA status map structure used in the interview flow. */
type JiraStatusMap = { story: StoryStatusMap; epic: EpicStatusMap; subTask: SubTaskStatusMap };

export async function runVSCodeInterview(
  existing?: Partial<SdlcConfig>
): Promise<SdlcConfig | undefined> {
  const answers = await collectAnswers(existing);
  if (!answers) return undefined;

  const statusMap = await collectStatusMap(answers, existing);
  if (!statusMap) return undefined;

  return buildConfig(answers, statusMap);
}

// ── Answer collection ─────────────────────────────────────────────────────────

async function collectAnswers(
  existing?: Partial<SdlcConfig>
): Promise<InterviewAnswers | undefined> {
  const answers: Partial<InterviewAnswers> = {};

  for (const q of QUESTIONS) {
    if (q.when && !q.when(answers)) continue;

    const existingValue = resolveExisting(q.id, existing);
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

const ADO_DEFAULT_STATUS_MAP: JiraStatusMap = {
  story: {
    backlog: "New",
    refineInProgress: "Active",
    readyForDesign: "Active",
    designInProgress: "Active",
    readyForBuild: "Active",
    inDevelopment: "Active",
    readyForTest: "In Review",
    done: "Closed",
  },
  epic: { notStarted: "New", inProgress: "In Progress", done: "Closed" },
  subTask: { todo: "New", inDevelopment: "Active", readyForTest: "In Review", done: "Closed" },
};

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

  if (!useManual || useManual === "Use defaults") return placeholderStatusMap();
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

function placeholderStatusMap(): JiraStatusMap {
  return {
    story:   { backlog: "Backlog", refineInProgress: "In Refinement", readyForDesign: "Ready for Design", designInProgress: "In Design", readyForBuild: "Ready for Build", inDevelopment: "In Development", readyForTest: "Ready for Test", done: "Done" },
    epic:    { notStarted: "To Do", inProgress: "In Progress", done: "Done" },
    subTask: { todo: "To Do", inDevelopment: "In Progress", readyForTest: "In Review", done: "Done" },
  };
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

// ── Config assembly ───────────────────────────────────────────────────────────

function buildConfig(
  answers: InterviewAnswers,
  statusMap: JiraStatusMap
): SdlcConfig {
  const isAdo = answers.pmTool === "ADO";
  return {
    version: CONFIG_VERSION,
    generatedAt: new Date().toISOString(),
    toolVersion: TOOL_VERSION,
    project: {
      name: answers.projectName,
      // Keep legacy JIRA fields for backward compat with older tooling
      ...(isAdo ? {} : {
        jiraKey:   answers.jiraKey.toUpperCase(),
        jiraSite:  answers.jiraSite,
        jiraEmail: answers.jiraEmail,
      }),
    },
    alm: isAdo
      ? { tool: "ADO", organization: answers.adoOrganization, project: answers.adoProject }
      : { tool: "JIRA", site: answers.jiraSite, projectKey: answers.jiraKey.toUpperCase(), email: answers.jiraEmail },
    phases: answers.phases as Phase[],
    team: {
      sprintLengthWeeks:  answers.sprintLengthWeeks,
      estimationApproach: answers.estimationApproach,
    },
    salesforce: {
      orgs: { sandbox: answers.orgSandbox },
    },
    standards: {
      apexCoverageThreshold: answers.apexCoverageThreshold,
    },
    ...(isAdo ? { ado: { statusMap } } : { jira: { statusMap } }),
    branching: "gitflow",
    paths: DEFAULT_PATHS,
  };
}

function resolveExisting(questionId: string, existing?: Partial<SdlcConfig>): unknown {
  if (!existing) return undefined;
  const almTool = existing.alm?.tool ?? (existing.project?.jiraKey ? "JIRA" : undefined);
  const map: Record<string, unknown> = {
    projectName:           existing.project?.name,
    pmTool:                almTool,
    jiraKey:               existing.project?.jiraKey ?? (existing.alm?.tool === "JIRA" ? existing.alm.projectKey : undefined),
    jiraSite:              existing.project?.jiraSite ?? (existing.alm?.tool === "JIRA" ? existing.alm.site : undefined),
    jiraEmail:             existing.project?.jiraEmail ?? (existing.alm?.tool === "JIRA" ? existing.alm.email : undefined),
    adoOrganization:       existing.alm?.tool === "ADO" ? existing.alm.organization : undefined,
    adoProject:            existing.alm?.tool === "ADO" ? existing.alm.project : undefined,
    phases:                existing.phases,
    sprintLengthWeeks:     existing.team?.sprintLengthWeeks,
    estimationApproach:    existing.team?.estimationApproach,
    orgSandbox:            existing.salesforce?.orgs.sandbox,
    apexCoverageThreshold: existing.standards?.apexCoverageThreshold,
  };
  return map[questionId];
}
