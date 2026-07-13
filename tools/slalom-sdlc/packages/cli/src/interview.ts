import path from "path";
import {
  input,
  number,
  select,
  checkbox,
  confirm,
} from "@inquirer/prompts";
import {
  QUESTIONS,
  STORY_GATE_LABELS,
  EPIC_GATE_LABELS,
  SUBTASK_GATE_LABELS,
  type InterviewAnswers,
} from "@sdlc/core";
import {
  fetchJiraStatuses,
  type JiraStatus,
  type JiraStatusMap,
  DEFAULT_PATHS,
  DEFAULT_STANDARDS,
  TOOL_VERSION,
  CONFIG_VERSION,
  type SdlcConfig,
  type Phase,
} from "@sdlc/core";

export interface InterviewResult {
  config: SdlcConfig;
}

// Standalone prompt — asked before the interview, drives auto-detection
export async function promptOutputDir(override?: string): Promise<string> {
  if (override) return path.resolve(override);

  const answer = await input({
    message: "Path to the project repo to scaffold into",
    default: process.cwd(),
    validate: (v) => (v.trim().length > 0 ? true : "Required"),
  });

  return path.resolve(answer.trim());
}

export async function collectStatusMapOnly(
  existing: SdlcConfig
): Promise<JiraStatusMap> {
  return collectStatusMap(
    existing.project.jiraEmail ?? "",
    existing.project.jiraSite ?? "",
    existing.project.jiraKey ?? "",
    existing
  );
}

export async function runInterview(existing?: Partial<SdlcConfig>): Promise<InterviewResult> {
  const answers = await collectAnswers(existing);
  const statusMap = await collectStatusMap(
    answers.jiraEmail,
    answers.jiraSite,
    answers.jiraKey,
    existing
  );

  return { config: buildConfig(answers, statusMap) };
}

// ── Answer collection ─────────────────────────────────────────────────────────

async function collectAnswers(existing?: Partial<SdlcConfig>): Promise<InterviewAnswers> {
  const answers: Partial<InterviewAnswers> = {};
  let currentSection = "";

  for (const q of QUESTIONS) {
    if (q.when && !q.when(answers)) continue;

    if (q.section !== currentSection) {
      currentSection = q.section;
      console.log(`\n── ${currentSection} ${"─".repeat(Math.max(0, 50 - currentSection.length))}`);
    }

    const existingValue = resolveExisting(q.id, existing);
    const def = existingValue ?? q.default;

    switch (q.type) {
      case "text":
        (answers as Record<string, unknown>)[q.id] = await input({
          message: q.label,
          default: def as string | undefined,
          validate: q.validate
            ? (v) => (q.validate as (v: unknown, a: Partial<InterviewAnswers>) => string | true)(v, answers)
            : undefined,
        });
        break;

      case "number":
        (answers as Record<string, unknown>)[q.id] = await number({
          message: q.label,
          default: def as number | undefined,
          validate: q.validate
            ? (v) => (q.validate as (v: unknown, a: Partial<InterviewAnswers>) => string | true)(v, answers)
            : undefined,
        });
        break;

      case "select":
        (answers as Record<string, unknown>)[q.id] = await select({
          message: q.label,
          choices: (q.options ?? []).map((o) => ({ name: o.label, value: o.value })),
          default: def,
        });
        break;

      case "multiselect":
        (answers as Record<string, unknown>)[q.id] = await checkbox({
          message: q.label,
          choices: (q.options ?? []).map((o) => ({
            name: o.label,
            value: o.value,
            checked: Array.isArray(def) && (def as string[]).includes(o.value as string),
          })),
          validate: q.validate
            ? (v) => (q.validate as (v: unknown, a: Partial<InterviewAnswers>) => string | true)(v, answers)
            : undefined,
        });
        break;

      case "confirm":
        (answers as Record<string, unknown>)[q.id] = await confirm({
          message: q.label,
          default: def as boolean | undefined,
        });
        break;
    }
  }

  return answers as InterviewAnswers;
}

// ── JIRA status mapping ───────────────────────────────────────────────────────

async function collectStatusMap(
  email: string,
  jiraSite: string,
  jiraKey: string,
  existing?: Partial<SdlcConfig>
): Promise<JiraStatusMap> {
  console.log("\n── JIRA Workflow ──────────────────────────────────────────────");

  const token = process.env.ATLASSIAN_TOKEN;

  if (!token) {
    console.log(
      "\n  ℹ  Set the ATLASSIAN_TOKEN environment variable to automatically fetch\n" +
      "     your JIRA workflow statuses. You can create a token at:\n" +
      "     https://id.atlassian.com/manage-profile/security/api-tokens\n"
    );

    const skip = await confirm({
      message: "Skip for now and enter status names manually?",
      default: false,
    });

    if (skip) return placeholderStatusMap();
    return mapStatusesManually(existing);
  }

  process.stdout.write(`\n  Fetching statuses for ${jiraKey} from ${jiraSite}... `);
  const result = await fetchJiraStatuses(jiraSite, jiraKey, { email, apiToken: token });
  console.log(result.success ? "✓\n" : "✗\n");

  if (!result.success) {
    console.log(`  ⚠  ${result.reason}`);
    const skip = await confirm({
      message: "Skip for now and enter status names manually?",
      default: false,
    });
    if (skip) return placeholderStatusMap();
    return mapStatusesManually(existing);
  }

  return mapStatusesInteractively(result.byType, existing);
}

async function mapStatusesInteractively(
  byType: Record<string, JiraStatus[]>,
  existing?: Partial<SdlcConfig>
): Promise<JiraStatusMap> {
  console.log("  Map your JIRA statuses to SDLC gates:\n");

  const pick = (gateLabel: string, statuses: JiraStatus[], existingValue?: string) =>
    select({
      message: gateLabel,
      choices: statuses.map((s) => ({ name: s.name, value: s.name })),
      default: existingValue,
    });

  const storyStatuses = byType["story"] ?? [];
  const epicStatuses  = byType["epic"]  ?? [];
  const subTaskStatuses = byType["subTask"] ?? [];
  const ex = existing?.jira?.statusMap;
  const fallback = storyStatuses;

  console.log("  Stories:");
  const story: JiraStatusMap["story"] = {
    backlog:          await pick(STORY_GATE_LABELS.backlog,          storyStatuses, ex?.story.backlog),
    refineInProgress: await pick(STORY_GATE_LABELS.refineInProgress, storyStatuses, ex?.story.refineInProgress),
    readyForDesign:   await pick(STORY_GATE_LABELS.readyForDesign,   storyStatuses, ex?.story.readyForDesign),
    designInProgress: await pick(STORY_GATE_LABELS.designInProgress, storyStatuses, ex?.story.designInProgress),
    readyForBuild:    await pick(STORY_GATE_LABELS.readyForBuild,    storyStatuses, ex?.story.readyForBuild),
    inDevelopment:    await pick(STORY_GATE_LABELS.inDevelopment,    storyStatuses, ex?.story.inDevelopment),
    readyForTest:     await pick(STORY_GATE_LABELS.readyForTest,     storyStatuses, ex?.story.readyForTest),
    done:             await pick(STORY_GATE_LABELS.done,             storyStatuses, ex?.story.done),
  };

  console.log("\n  Epics:");
  const epic: JiraStatusMap["epic"] = {
    notStarted: await pick(EPIC_GATE_LABELS.notStarted, epicStatuses.length ? epicStatuses : fallback, ex?.epic.notStarted),
    inProgress:  await pick(EPIC_GATE_LABELS.inProgress,  epicStatuses.length ? epicStatuses : fallback, ex?.epic.inProgress),
    done:        await pick(EPIC_GATE_LABELS.done,        epicStatuses.length ? epicStatuses : fallback, ex?.epic.done),
  };

  console.log("\n  Sub-tasks:");
  const subTask: JiraStatusMap["subTask"] = {
    todo:          await pick(SUBTASK_GATE_LABELS.todo,          subTaskStatuses.length ? subTaskStatuses : fallback, ex?.subTask.todo),
    inDevelopment: await pick(SUBTASK_GATE_LABELS.inDevelopment, subTaskStatuses.length ? subTaskStatuses : fallback, ex?.subTask.inDevelopment),
    readyForTest:  await pick(SUBTASK_GATE_LABELS.readyForTest,  subTaskStatuses.length ? subTaskStatuses : fallback, ex?.subTask.readyForTest),
    done:          await pick(SUBTASK_GATE_LABELS.done,          subTaskStatuses.length ? subTaskStatuses : fallback, ex?.subTask.done),
  };

  return { story, epic, subTask };
}

async function mapStatusesManually(existing?: Partial<SdlcConfig>): Promise<JiraStatusMap> {
  console.log("\n  Enter your JIRA status names:\n");
  const ex = existing?.jira?.statusMap;
  const ask = (label: string, def?: string) => input({ message: label, default: def });

  console.log("  Stories:");
  const story: JiraStatusMap["story"] = {
    backlog:          await ask(STORY_GATE_LABELS.backlog,          ex?.story.backlog          ?? "Backlog"),
    refineInProgress: await ask(STORY_GATE_LABELS.refineInProgress, ex?.story.refineInProgress ?? "In Refinement"),
    readyForDesign:   await ask(STORY_GATE_LABELS.readyForDesign,   ex?.story.readyForDesign   ?? "Ready for Design"),
    designInProgress: await ask(STORY_GATE_LABELS.designInProgress, ex?.story.designInProgress ?? "In Design"),
    readyForBuild:    await ask(STORY_GATE_LABELS.readyForBuild,    ex?.story.readyForBuild    ?? "Ready for Build"),
    inDevelopment:    await ask(STORY_GATE_LABELS.inDevelopment,    ex?.story.inDevelopment    ?? "In Development"),
    readyForTest:     await ask(STORY_GATE_LABELS.readyForTest,     ex?.story.readyForTest     ?? "Ready for Test"),
    done:             await ask(STORY_GATE_LABELS.done,             ex?.story.done             ?? "Done"),
  };

  console.log("\n  Epics:");
  const epic: JiraStatusMap["epic"] = {
    notStarted: await ask(EPIC_GATE_LABELS.notStarted, ex?.epic.notStarted ?? "To Do"),
    inProgress:  await ask(EPIC_GATE_LABELS.inProgress,  ex?.epic.inProgress  ?? "In Progress"),
    done:        await ask(EPIC_GATE_LABELS.done,        ex?.epic.done        ?? "Done"),
  };

  console.log("\n  Sub-tasks:");
  const subTask: JiraStatusMap["subTask"] = {
    todo:          await ask(SUBTASK_GATE_LABELS.todo,          ex?.subTask.todo          ?? "To Do"),
    inDevelopment: await ask(SUBTASK_GATE_LABELS.inDevelopment, ex?.subTask.inDevelopment ?? "In Progress"),
    readyForTest:  await ask(SUBTASK_GATE_LABELS.readyForTest,  ex?.subTask.readyForTest  ?? "In Review"),
    done:          await ask(SUBTASK_GATE_LABELS.done,          ex?.subTask.done          ?? "Done"),
  };

  return { story, epic, subTask };
}

function placeholderStatusMap(): JiraStatusMap {
  return {
    story: {
      backlog: "Backlog", refineInProgress: "In Refinement", readyForDesign: "Ready for Design",
      designInProgress: "In Design", readyForBuild: "Ready for Build", inDevelopment: "In Development",
      readyForTest: "Ready for Test", done: "Done",
    },
    epic:    { notStarted: "To Do", inProgress: "In Progress", done: "Done" },
    subTask: { todo: "To Do", inDevelopment: "In Progress", readyForTest: "In Review", done: "Done" },
  };
}

// ── Config assembly ───────────────────────────────────────────────────────────

function buildConfig(answers: InterviewAnswers, statusMap: JiraStatusMap): SdlcConfig {
  return {
    version: CONFIG_VERSION,
    generatedAt: new Date().toISOString(),
    toolVersion: TOOL_VERSION,
    project: {
      name:       answers.projectName,
      jiraKey:    answers.jiraKey.toUpperCase(),
      jiraSite:   answers.jiraSite,
      jiraEmail:  answers.jiraEmail,
    },
    phases: answers.phases as Phase[],
    team: {
      sprintLengthWeeks:   answers.sprintLengthWeeks,
      estimationApproach:  answers.estimationApproach,
    },
    salesforce: {
      orgs: { sandbox: answers.orgSandbox },
    },
    standards: {
      apexCoverageThreshold: answers.apexCoverageThreshold,
    },
    jira: { statusMap },
    branching: "gitflow",
    paths: DEFAULT_PATHS,
  };
}

function resolveExisting(questionId: string, existing?: Partial<SdlcConfig>): unknown {
  if (!existing) return undefined;
  const map: Record<string, unknown> = {
    projectName:           existing.project?.name,
    jiraKey:               existing.project?.jiraKey,
    jiraSite:              existing.project?.jiraSite,
    jiraEmail:             existing.project?.jiraEmail,
    phases:                existing.phases,
    sprintLengthWeeks:     existing.team?.sprintLengthWeeks,
    estimationApproach:    existing.team?.estimationApproach,
    orgSandbox:            existing.salesforce?.orgs.sandbox,
    apexCoverageThreshold: existing.standards?.apexCoverageThreshold,
  };
  return map[questionId];
}
