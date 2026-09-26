import {
  CONFIG_VERSION,
  DEFAULT_PATHS,
  coerceTargetForTool,
  type OttoConfig,
  type StoryStatusMap,
  type EpicStatusMap,
  type SubTaskStatusMap,
  type Phase,
  type DeliverableTarget,
  type StatusTransitionMode,
} from "./schema.js";
import { TOOL_VERSION } from "./version.js";
import type { InterviewAnswers } from "./questions.js";

/**
 * Turning interview answers into an OttoConfig, shared by every front end.
 *
 * This used to live only in the VS Code interview, which is how the MCP server's
 * `sdlc_scaffold` ended up able to write JIRA projects and nothing else — it grew
 * its own config assembly and never gained the ADO/LOCAL branches. One builder,
 * one shape, no second place to forget.
 */

export interface StatusMapTriple {
  story: StoryStatusMap;
  epic: EpicStatusMap;
  subTask: SubTaskStatusMap;
}

/** Sensible JIRA stage names, used when the workflow can't be read from the site. */
export const DEFAULT_JIRA_STATUS_MAP: StatusMapTriple = {
  story: {
    backlog:          "Backlog",
    refineInProgress: "In Refinement",
    readyForDesign:   "Ready for Design",
    designInProgress: "In Design",
    readyForBuild:    "Ready for Build",
    inDevelopment:    "In Development",
    readyForTest:     "Ready for Test",
    done:             "Done",
  },
  epic:    { notStarted: "To Do", inProgress: "In Progress", done: "Done" },
  subTask: { todo: "To Do", inDevelopment: "In Progress", readyForTest: "In Review", done: "Done" },
};

/** Azure DevOps' out-of-the-box Agile process states. */
export const ADO_DEFAULT_STATUS_MAP: StatusMapTriple = {
  story: {
    backlog:          "New",
    refineInProgress: "Active",
    readyForDesign:   "Active",
    designInProgress: "Active",
    readyForBuild:    "Active",
    inDevelopment:    "Active",
    readyForTest:     "In Review",
    done:             "Closed",
  },
  epic:    { notStarted: "New", inProgress: "In Progress", done: "Closed" },
  subTask: { todo: "New", inDevelopment: "Active", readyForTest: "In Review", done: "Closed" },
};

export function defaultStatusMapFor(pmTool: InterviewAnswers["pmTool"]): StatusMapTriple {
  return pmTool === "ADO" ? ADO_DEFAULT_STATUS_MAP : DEFAULT_JIRA_STATUS_MAP;
}

/**
 * Emit a `design.deliverable` block only when the user set an explicit publishing
 * target, space key, or wiki identifier. Absent → the engine resolves per-tool
 * defaults, so existing configs and default runs are entirely unchanged.
 *
 * The target is coerced onto the connected PM tool before persisting — e.g. a
 * JIRA project that picked "Azure DevOps wiki page" from the (tool-agnostic)
 * target list gets `target: "confluence"` written, not `"wiki"`. Without this,
 * the persisted config would contradict what actually renders: `resolveDeliverable`
 * coerces again at render time regardless, so an uncoerced `"wiki"` in a JIRA
 * config would silently become `"confluence"` there too, leaving the config file
 * as a permanent, misleading record of a choice the user never got.
 */
function buildDesignBlock(answers: InterviewAnswers): { design?: { deliverable: Record<string, unknown> } } {
  const rawTarget = (answers.designDeliverableTarget || "").trim();
  // "default" is the sentinel for "resolve per PM tool" — never persist it.
  const target = rawTarget && rawTarget !== "default"
    ? coerceTargetForTool(rawTarget as DeliverableTarget, answers.pmTool)
    : "";
  const spaceKey = (answers.designDeliverableSpaceKey || "").trim();
  const wikiIdentifier = (answers.designDeliverableWikiIdentifier || "").trim();
  const deliverable: Record<string, unknown> = {};
  if (target) deliverable.target = target;
  if (spaceKey) deliverable.spaceKey = spaceKey;
  if (wikiIdentifier) deliverable.wikiIdentifier = wikiIdentifier;
  if (Object.keys(deliverable).length === 0) return {};
  return { design: { deliverable } };
}

/**
 * `workflow.statusTransitions` is only persisted when it differs from the `auto`
 * default, and never for LOCAL projects (they don't transition anything).
 */
function buildWorkflowBlock(answers: InterviewAnswers): { workflow?: { statusTransitions: StatusTransitionMode } } {
  if (answers.pmTool === "LOCAL") return {};
  const mode = answers.statusTransitions;
  if (!mode || mode === "auto") return {};
  return { workflow: { statusTransitions: mode } };
}

/**
 * Assemble a validated-shape OttoConfig from interview answers.
 *
 * `statusMap` is ignored for LOCAL projects — they never transition a remote work
 * item, so they carry no `jira`/`ado` block and render the built-in stage labels.
 */
export function buildOttoConfig(
  answers: InterviewAnswers,
  statusMap: StatusMapTriple = defaultStatusMapFor(answers.pmTool)
): OttoConfig {
  const base = {
    version:     CONFIG_VERSION,
    generatedAt: new Date().toISOString(),
    toolVersion: TOOL_VERSION,
    phases:      answers.phases as Phase[],
    team: {
      sprintLengthWeeks:  answers.sprintLengthWeeks,
      estimationApproach: answers.estimationApproach,
    },
    salesforce: { orgs: { sandbox: answers.orgSandbox } },
    standards:  { apexCoverageThreshold: answers.apexCoverageThreshold },
    branching:  "gitflow" as const,
    paths:      DEFAULT_PATHS,
    ...(answers.revenueCloudEnabled ? { revenueCloud: { enabled: true } } : {}),
    ...buildDesignBlock(answers),
    ...buildWorkflowBlock(answers),
  };

  if (answers.pmTool === "LOCAL") {
    return {
      ...base,
      project: { name: answers.projectName },
      alm: { tool: "LOCAL", keyPrefix: (answers.localKeyPrefix || "LOCAL").trim().toUpperCase() },
    };
  }

  if (answers.pmTool === "ADO") {
    return {
      ...base,
      project: { name: answers.projectName },
      alm: { tool: "ADO", organization: answers.adoOrganization, project: answers.adoProject },
      ado: { statusMap },
    };
  }

  const projectKey = answers.jiraKey.toUpperCase();
  return {
    ...base,
    project: {
      name: answers.projectName,
      // Legacy top-level JIRA fields, kept for tooling that predates `alm`.
      jiraKey:   projectKey,
      jiraSite:  answers.jiraSite,
      jiraEmail: answers.jiraEmail,
    },
    alm: { tool: "JIRA", site: answers.jiraSite, projectKey, email: answers.jiraEmail },
    jira: { statusMap },
  };
}

/**
 * Pull the current value for a question out of an existing config, so a reconfigure
 * pre-fills what's already there instead of asking from scratch.
 */
export function resolveExistingAnswer(questionId: string, existing?: Partial<OttoConfig>): unknown {
  if (!existing) return undefined;

  const pmTool = existing.alm?.tool ?? (existing.project?.jiraKey ? "JIRA" : undefined);

  const map: Record<string, unknown> = {
    projectName:           existing.project?.name,
    pmTool,
    jiraKey:               existing.project?.jiraKey  ?? (existing.alm?.tool === "JIRA" ? existing.alm.projectKey : undefined),
    jiraSite:              existing.project?.jiraSite ?? (existing.alm?.tool === "JIRA" ? existing.alm.site : undefined),
    jiraEmail:             existing.project?.jiraEmail ?? (existing.alm?.tool === "JIRA" ? existing.alm.email : undefined),
    adoOrganization:       existing.alm?.tool === "ADO"   ? existing.alm.organization : undefined,
    adoProject:            existing.alm?.tool === "ADO"   ? existing.alm.project : undefined,
    localKeyPrefix:        existing.alm?.tool === "LOCAL" ? existing.alm.keyPrefix : undefined,
    statusTransitions:     existing.workflow?.statusTransitions ?? "auto",
    phases:                existing.phases,
    sprintLengthWeeks:     existing.team?.sprintLengthWeeks,
    estimationApproach:    existing.team?.estimationApproach,
    orgSandbox:            existing.salesforce?.orgs.sandbox,
    apexCoverageThreshold: existing.standards?.apexCoverageThreshold,
    revenueCloudEnabled:   existing.revenueCloud?.enabled ?? false,
    designDeliverableTarget:   existing.design?.deliverable?.target ?? "default",
    designDeliverableSpaceKey: existing.design?.deliverable?.spaceKey ?? "",
    designDeliverableWikiIdentifier: existing.design?.deliverable?.wikiIdentifier ?? "",
  };

  return map[questionId];
}

/** The status map already on an existing config, whichever PM tool wrote it. */
export function existingStatusMap(existing?: Partial<OttoConfig>): StatusMapTriple | undefined {
  return (existing?.jira?.statusMap ?? existing?.ado?.statusMap) as StatusMapTriple | undefined;
}
