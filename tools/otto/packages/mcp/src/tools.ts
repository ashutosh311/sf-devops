import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod/v3";
import {
  scaffoldRepo,
  OttoConfigSchema,
  buildOttoConfig,
  defaultStatusMapFor,
  skillTemplateKey,
  type OttoConfig,
  type StatusMapTriple,
  type InterviewAnswers,
  type ScaffoldResult,
} from "@otto/core";
import { requireConfig, resolveProjectRoot, loadConfig } from "./config.js";
import { COMMANDS, PHASES, renderCommand, resolveSkill } from "./render.js";
import { INIT_PROMPT } from "./about.js";
import { cmd } from "./surface.js";
import { registerRcaTools } from "./rca.js";
import { trackCommand } from "./usage.js";
import {
  ABORTED,
  supportsElicitation,
  runElicitedInterview,
  runElicitedStatusMap,
} from "./elicit.js";

const PM_TOOLS = ["JIRA", "ADO", "LOCAL"] as const;

/**
 * Some hosts (notably GitHub Copilot Desktop) do not reliably report the open
 * workspace folder to a local MCP server — neither `roots/list` nor the
 * spawned process's own `cwd` can be trusted to match what the user sees.
 * Every tool that reads or writes project files accepts this as an explicit
 * override so the calling model can supply the absolute path it already knows
 * from its own session context. Once given, it's cached for the rest of the
 * session (see `resolveProjectRoot` in config.ts), so it only needs to be
 * passed once — but it's safe, and recommended, to pass it on every call.
 */
const PROJECT_ROOT_FIELD = z
  .string()
  .min(1)
  .optional()
  .describe(
    "Absolute path to this project's root directory (the folder you are operating in). " +
    "Always supply this if you can determine it from your own session/working-directory " +
    "context — some hosts (notably GitHub Copilot) don't reliably tell MCP servers which " +
    "folder is open, which otherwise causes this tool to silently read/write the wrong " +
    "directory while still reporting success."
  );

const SCAFFOLD_SCHEMA = z.object({
  projectRoot:           PROJECT_ROOT_FIELD,
  projectName:           z.string().min(1).describe("Client / project name"),
  pmTool:                z.enum(PM_TOOLS).default("JIRA").describe("Where work items live"),
  // JIRA — required when pmTool is JIRA
  jiraKey:               z.string().min(2).optional().describe("JIRA project key, e.g. ACME"),
  jiraSite:              z.string().url().optional().describe("JIRA site URL, e.g. https://acme.atlassian.net"),
  jiraEmail:             z.string().email().optional().describe("Atlassian account email"),
  // Azure DevOps — required when pmTool is ADO
  adoOrganization:       z.string().url().optional().describe("Azure DevOps org URL, e.g. https://dev.azure.com/acme"),
  adoProject:            z.string().min(1).optional().describe("Azure DevOps project name"),
  // Local-only — optional when pmTool is LOCAL
  localKeyPrefix:        z.string().min(2).optional().describe("Work-item key prefix for local projects, e.g. LOCAL"),
  phases:                z.array(z.enum(PHASES)).min(1).describe("Enabled SDLC phases"),
  sprintLengthWeeks:     z.number().int().min(1).max(4).describe("Sprint length in weeks (1–4)"),
  estimationApproach:    z.enum(["ta-assigns", "team-vote", "both"]).describe("Estimation approach"),
  orgSandbox:            z.string().min(1).describe("Salesforce CLI sandbox org alias"),
  apexCoverageThreshold: z.number().int().min(0).max(100).describe("Apex test coverage threshold (%)"),
  revenueCloudEnabled:   z.boolean().optional().describe("Enable Revenue Cloud Advanced (RCA) skills & tooling"),
  designDeliverableTarget:   z.enum(["confluence", "wiki", "local", "pm-comment"]).optional().describe("Where the epic-level synthesis design is published (default: per PM tool). The per-story design comment is always posted."),
  designDeliverableSpaceKey: z.string().optional().describe("Confluence space key for design pages (persisted so the agent stops asking each run)"),
  designDeliverableWikiIdentifier: z.string().optional().describe("Azure DevOps wiki identifier for design pages (persisted so the agent stops asking each run)"),
  storyBacklog:          z.string().optional().describe("Story: not started"),
  storyRefineInProgress: z.string().optional().describe("Story: refinement in progress"),
  storyReadyForDesign:   z.string().optional().describe("Story: refinement complete (gate)"),
  storyDesignInProgress: z.string().optional().describe("Story: design in progress"),
  storyReadyForBuild:    z.string().optional().describe("Story: design complete (gate)"),
  storyInDevelopment:    z.string().optional().describe("Story: build in progress"),
  storyReadyForTest:     z.string().optional().describe("Story: build complete (gate)"),
  storyDone:             z.string().optional().describe("Story: done"),
  epicNotStarted:        z.string().optional().describe("Epic: not started"),
  epicInProgress:        z.string().optional().describe("Epic: in progress"),
  epicDone:              z.string().optional().describe("Epic: done"),
  subTaskTodo:           z.string().optional().describe("Sub-task: not started"),
  subTaskInDevelopment:  z.string().optional().describe("Sub-task: in progress"),
  subTaskReadyForTest:   z.string().optional().describe("Sub-task: ready for review"),
  subTaskDone:           z.string().optional().describe("Sub-task: done"),
});

type ScaffoldArgs = z.infer<typeof SCAFFOLD_SCHEMA>;

const PROMPT_SCHEMA = z.object({
  command:     z.enum(COMMANDS).describe("SDLC command to activate"),
  storyKey:    z.string().optional().describe("Ticket key, e.g. PROJ-42 — used by refine/design/build/test. For refine and design, may also be an epic key or sprint to process every eligible child story; for refine's generate-stories skill it is the epic new stories are drafted under."),
  projectRoot: PROJECT_ROOT_FIELD,
  skill:       z.string().optional().describe(
    "Optional sub-skill. For `refine`: story | generate-stories | gap-analysis | data-dictionary (omit to show the menu, or with a storyKey but no skill, run `story`). For `test`: execute | write-cases | apex-unit | apex-perf | pw-setup | pw-write (omit to show the menu, or with a storyKey but no skill, run `execute`). For `discover`: synthesize | analyze | conflict-check | compose-deliverable | prep-workshop | hub-audit | whats-next | registers-to-stories (omit to show the menu)."
  ),
});

type PromptArgs = z.infer<typeof PROMPT_SCHEMA>;

const STATUS_SCHEMA = z.object({
  projectRoot: PROJECT_ROOT_FIELD,
});

type StatusArgs = z.infer<typeof STATUS_SCHEMA>;

const INIT_SCHEMA = z.object({
  projectRoot: PROJECT_ROOT_FIELD,
});

type InitArgs = z.infer<typeof INIT_SCHEMA>;

export function registerTools(server: McpServer, mcpVersion: string): void {
  registerInit(server, mcpVersion);
  registerScaffold(server);
  registerStatus(server);
  registerPromptTool(server, mcpVersion);
  registerRcaTools(server);
}

// ── /init ─────────────────────────────────────────────────────────────────────

/**
 * Run the setup interview and scaffold the project.
 *
 * Where the client supports MCP elicitation — Claude Code does — the server asks the
 * questions itself as native forms, exactly as the VS Code extension does with
 * showInputBox/showQuickPick, and writes the config from the answers. The model is a
 * bystander: it can't paraphrase a question, invent a default, or skip a field.
 *
 * Where the client doesn't, this falls back to handing the model the conversational
 * interview to conduct, which then finishes with a `otto_scaffold` call.
 */
function registerInit(server: McpServer, mcpVersion: string): void {
  server.tool(
    "otto_init",
    "Set up or reconfigure the SDLC for this project. Run this for /init — it conducts the setup interview and writes the config itself. Pass `projectRoot` (see its description) if you know the project's absolute path.",
    INIT_SCHEMA.shape,
    async (args: InitArgs) => {
      try {
        const inner = server.server;

        // Resolve (and cache) the root up front so it's pinned for this whole
        // session even if the caller only supplies it on this first call.
        const root = await resolveProjectRoot(args.projectRoot);

        // No elicitation support (older client, or the CLI): hand the model the
        // interview to conduct in conversation, finishing with otto_scaffold.
        // Nothing has happened yet at this point — not tracked here; see
        // validateAndScaffold for where a completed init is actually recorded.
        if (!supportsElicitation(inner)) {
          return { content: [{ type: "text" as const, text: INIT_PROMPT }] };
        }

        const existing = (await loadConfig(root)) ?? undefined;

        const answers = await runElicitedInterview(inner, existing);
        if (answers === ABORTED) return cancelled();

        // LOCAL projects never transition a remote work item, so there's no workflow
        // to map — skip straight past the status questions.
        let statusMap: StatusMapTriple = defaultStatusMapFor(answers.pmTool);
        if (answers.pmTool !== "LOCAL") {
          const mapped = await runElicitedStatusMap(inner, answers, existing);
          if (mapped === ABORTED) return cancelled();
          statusMap = mapped;
        }

        return await validateAndScaffold(buildOttoConfig(answers, statusMap), root, Boolean(existing));
      } catch (err) {
        return errorResult(`Setup failed: ${String(err)}`);
      }
    }
  );
}

function cancelled() {
  return {
    content: [{
      type: "text" as const,
      text: `Setup cancelled — nothing was written. Run ${cmd("init")} again when you're ready.`,
    }],
  };
}

// ── Scaffold (conversational fallback / direct call) ──────────────────────────

function registerScaffold(server: McpServer): void {
  server.tool(
    "otto_scaffold",
    "Write the Otto config (.otto/config.json) and scaffold standards, artifact dirs, and MCP config files from answers you have already collected. Prefer otto_init, which runs the interview itself — only call this after conducting the interview conversationally. Pass `projectRoot` (see its description) if you know the project's absolute path.",
    SCAFFOLD_SCHEMA.shape,
    async (args: ScaffoldArgs) => {
      try {
        const root = await resolveProjectRoot(args.projectRoot);
        const existing = await loadConfig(root);

        const missing = missingPmFields(args);
        if (missing.length) {
          return errorResult(`Missing required field(s) for ${args.pmTool}: ${missing.join(", ")}`);
        }

        const config = buildOttoConfig(toAnswers(args), statusMapFrom(args));
        return await validateAndScaffold(config, root, Boolean(existing));
      } catch (err) {
        return errorResult(`Scaffold failed: ${String(err)}`);
      }
    }
  );
}

function missingPmFields(args: ScaffoldArgs): string[] {
  if (args.pmTool === "JIRA") {
    return (["jiraKey", "jiraSite", "jiraEmail"] as const).filter((k) => !args[k]);
  }
  if (args.pmTool === "ADO") {
    return (["adoOrganization", "adoProject"] as const).filter((k) => !args[k]);
  }
  return [];
}

function toAnswers(args: ScaffoldArgs): InterviewAnswers {
  return {
    projectName:           args.projectName,
    pmTool:                args.pmTool,
    jiraKey:               args.jiraKey ?? "",
    jiraSite:              args.jiraSite ?? "",
    jiraEmail:             args.jiraEmail ?? "",
    adoOrganization:       args.adoOrganization ?? "",
    adoProject:            args.adoProject ?? "",
    localKeyPrefix:        args.localKeyPrefix ?? "LOCAL",
    phases:                args.phases,
    sprintLengthWeeks:     args.sprintLengthWeeks,
    estimationApproach:    args.estimationApproach,
    orgSandbox:            args.orgSandbox,
    apexCoverageThreshold: args.apexCoverageThreshold,
    revenueCloudEnabled:   args.revenueCloudEnabled ?? false,
    designDeliverableTarget:   args.designDeliverableTarget ?? "default",
    designDeliverableSpaceKey: args.designDeliverableSpaceKey ?? "",
    designDeliverableWikiIdentifier: args.designDeliverableWikiIdentifier ?? "",
  };
}

/** Any status the caller didn't supply falls back to the PM tool's own default. */
function statusMapFrom(args: ScaffoldArgs): StatusMapTriple {
  const d = defaultStatusMapFor(args.pmTool);
  return {
    story: {
      backlog:          args.storyBacklog          ?? d.story.backlog,
      refineInProgress: args.storyRefineInProgress ?? d.story.refineInProgress,
      readyForDesign:   args.storyReadyForDesign   ?? d.story.readyForDesign,
      designInProgress: args.storyDesignInProgress ?? d.story.designInProgress,
      readyForBuild:    args.storyReadyForBuild    ?? d.story.readyForBuild,
      inDevelopment:    args.storyInDevelopment    ?? d.story.inDevelopment,
      readyForTest:     args.storyReadyForTest     ?? d.story.readyForTest,
      done:             args.storyDone             ?? d.story.done,
    },
    epic: {
      notStarted: args.epicNotStarted ?? d.epic.notStarted,
      inProgress: args.epicInProgress ?? d.epic.inProgress,
      done:       args.epicDone       ?? d.epic.done,
    },
    subTask: {
      todo:          args.subTaskTodo          ?? d.subTask.todo,
      inDevelopment: args.subTaskInDevelopment ?? d.subTask.inDevelopment,
      readyForTest:  args.subTaskReadyForTest  ?? d.subTask.readyForTest,
      done:          args.subTaskDone          ?? d.subTask.done,
    },
  };
}

// ── Shared scaffold path ──────────────────────────────────────────────────────

/**
 * Reached from two entry points — otto_init's own elicited-interview success
 * path, and a direct otto_scaffold call after a model-conducted conversational
 * interview — that represent the same logical "completed init" action. Usage
 * tracking lives here, once, rather than in each caller: tracking at the
 * dispatch point too (e.g. when otto_init hands the model INIT_PROMPT to
 * conduct the interview) would double-count a single init as two events once
 * the model's own otto_scaffold call landed here a turn later.
 */
async function validateAndScaffold(config: OttoConfig, root: string, isReconfigure: boolean) {
  const validated = OttoConfigSchema.safeParse(config);
  if (!validated.success) {
    return errorResult(`Config validation failed:\n${validated.error.message}`);
  }

  const result = await scaffoldRepo(validated.data, root);
  void trackCommand({ command: "init", project: validated.data.project.name, cwd: root }).catch(() => undefined);
  return { content: [{ type: "text" as const, text: summarise(validated.data, result, isReconfigure, root) }] };
}

function summarise(config: OttoConfig, result: ScaffoldResult, isReconfigure: boolean, root: string): string {
  const pmTool = config.alm?.tool ?? "JIRA";
  const workItems =
    config.alm?.tool === "ADO"   ? `Azure DevOps — ${config.alm.project}` :
    config.alm?.tool === "LOCAL" ? `local files — ${config.alm.keyPrefix}-nnn` :
                                   `JIRA — ${config.project.jiraKey}`;

  const lines: string[] = [
    `✅ ${config.project.name} — SDLC ${isReconfigure ? "reconfigured" : "initialised"}`,
    ``,
    // Surfaced explicitly so a wrong root (a host misreporting the workspace
    // folder) is visible immediately, instead of a silent "success" against
    // the wrong directory — see the `projectRoot` param on this tool.
    `Project root: ${root}`,
    `Work items: ${workItems}`,
    `Phases:     ${config.phases.join(", ")}`,
    `Sandbox:    ${config.salesforce.orgs.sandbox}`,
    `Sprint:     ${config.team.sprintLengthWeeks}w, ${config.team.estimationApproach}`,
    `Coverage:   ${config.standards.apexCoverageThreshold}%`,
    ``,
  ];

  if (result.created.length) {
    lines.push("Created:");
    result.created.forEach((f) => lines.push(`  + ${f}`));
  }
  if (result.updated.length) {
    lines.push("\nUpdated:");
    result.updated.forEach((f) => lines.push(`  ~ ${f}`));
  }
  if (result.preserved.length) {
    lines.push("\nPreserved (unchanged):");
    result.preserved.forEach((f) => lines.push(`  = ${f}`));
  }

  lines.push(
    `\nRun ${cmd("discover")} to start a discovery session.`,
    pmTool === "LOCAL"
      ? `This project has no remote work-item tool — the agents work from local artifacts only.`
      : `Make sure the ${pmTool === "ADO" ? "Azure DevOps" : "Atlassian"} MCP server is connected before running a phase.`
  );

  return lines.join("\n");
}

function errorResult(message: string) {
  return { content: [{ type: "text" as const, text: `⛔ ${message}` }], isError: true };
}

// ── Status / prompt ───────────────────────────────────────────────────────────

function registerStatus(server: McpServer): void {
  server.tool(
    "otto_status",
    "Check whether this project is configured and report the active SDLC settings. Pass `projectRoot` (see its description) if you know the project's absolute path.",
    STATUS_SCHEMA.shape,
    async (args: StatusArgs) => {
      try {
        const { config, root } = await requireConfig(args.projectRoot);
        const pmTool = config.alm?.tool ?? "JIRA";
        const workItems =
          config.alm?.tool === "ADO"   ? `Azure DevOps — ${config.alm.organization} / ${config.alm.project}` :
          config.alm?.tool === "LOCAL" ? `local files — ${config.alm.keyPrefix}-nnn` :
                                         `JIRA — ${config.project.jiraKey} (${config.project.jiraSite})`;

        const lines = [
          `✅ SDLC configured: ${config.project.name}`,
          `Project root: ${root}`,
          `Work items: ${workItems}`,
          `Phases:     ${config.phases.join(", ")}`,
          `Sandbox:    ${config.salesforce.orgs.sandbox}`,
          `Sprint:     ${config.team.sprintLengthWeeks}w, ${config.team.estimationApproach}`,
          `Coverage:   ${config.standards.apexCoverageThreshold}%`,
          `Tool:       v${config.toolVersion}`,
        ];
        return { content: [{ type: "text" as const, text: lines.join("\n") }] };
      } catch (err) {
        return { content: [{ type: "text" as const, text: `⚠ Not configured — ${String(err)}` }] };
      }
    }
  );
}

/**
 * Tool-shaped access to the same agent instructions the MCP prompts expose.
 *
 * The prompts are only reachable as `/mcp__otto__<command>`. When the server is
 * delivered as a Claude Code plugin, the plugin's own `commands/*.md` give the far
 * friendlier `/otto:<command>` — but a slash command is static markdown and
 * can't render Handlebars against the project's `.otto/config.json`, so it calls this tool to get
 * the per-project instruction set instead.
 */
function registerPromptTool(server: McpServer, mcpVersion: string): void {
  server.tool(
    "otto_prompt",
    "Return the full, project-specific instruction set for an SDLC command, rendered against the project's Otto config. Follow the returned instructions verbatim. Pass `projectRoot` (see its description) if you know the project's absolute path.",
    PROMPT_SCHEMA.shape,
    async (args: PromptArgs) => {
      const { ok, text } = await renderCommand(args.command, mcpVersion, args.storyKey, args.projectRoot, args.skill);
      void trackPromptUsage(args).catch(() => undefined);
      return {
        content: [{ type: "text" as const, text }],
        ...(ok ? {} : { isError: true }),
      };
    }
  );
}

/** Best-effort usage tracking for otto_prompt — never blocks or affects the
 *  tool response. See ./usage.ts for the gate/privacy envelope. */
async function trackPromptUsage(args: PromptArgs): Promise<void> {
  const root = await resolveProjectRoot(args.projectRoot);
  const config = await loadConfig(root);
  // Record the composed sub-skill key (e.g. "test-apex-unit") when one applies,
  // not the bare phase — otherwise every Test skill collapses to a single "test"
  // row and the dashboard can't tell them apart, the same per-surface
  // granularity gap WP4 already closes for VS Code. Resolved through the same
  // helper renderCommand uses, so an implicit default (ticket-only ⇒ execute) is
  // reported as the skill that actually ran.
  const skill = resolveSkill(args.command, args.storyKey, args.skill);
  await trackCommand({
    command: skill ? skillTemplateKey(args.command, skill) : args.command,
    project: config?.project?.name,
    story: args.storyKey,
    cwd: root,
  });
}
