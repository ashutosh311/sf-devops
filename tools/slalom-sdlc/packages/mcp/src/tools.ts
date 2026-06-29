import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod/v3";
import {
  scaffoldRepo,
  SdlcConfigSchema,
  DEFAULT_PATHS,
  TOOL_VERSION,
  CONFIG_VERSION,
  type SdlcConfig,
} from "@sdlc/core";
import { requireConfig, resolveProjectRoot } from "./config.js";

const PHASES = ["discover", "refine", "design", "build", "test", "release"] as const;

const SCAFFOLD_SCHEMA = z.object({
  projectName:           z.string().min(1).describe("Client / project name"),
  jiraKey:               z.string().min(2).describe("JIRA project key, e.g. ACME"),
  jiraSite:              z.string().url().describe("JIRA site URL, e.g. https://acme.atlassian.net"),
  jiraEmail:             z.string().email().describe("Atlassian account email"),
  phases:                z.array(z.enum(PHASES)).min(1).describe("Enabled SDLC phases"),
  sprintLengthWeeks:     z.number().int().min(1).max(4).describe("Sprint length in weeks (1–4)"),
  estimationApproach:    z.enum(["ta-assigns", "team-vote", "both"]).describe("Estimation approach"),
  orgSandbox:            z.string().min(1).describe("Salesforce CLI sandbox org alias"),
  apexCoverageThreshold: z.number().int().min(0).max(100).describe("Apex test coverage threshold (%)"),
  storyBacklog:          z.string().default("Backlog").describe("Story: not started"),
  storyRefineInProgress: z.string().default("In Refinement").describe("Story: refinement in progress"),
  storyReadyForDesign:   z.string().default("Ready for Design").describe("Story: refinement complete (gate)"),
  storyDesignInProgress: z.string().default("In Design").describe("Story: design in progress"),
  storyReadyForBuild:    z.string().default("Ready for Build").describe("Story: design complete (gate)"),
  storyInDevelopment:    z.string().default("In Development").describe("Story: build in progress"),
  storyReadyForTest:     z.string().default("Ready for Test").describe("Story: build complete (gate)"),
  storyDone:             z.string().default("Done").describe("Story: done"),
  epicNotStarted:        z.string().default("To Do").describe("Epic: not started"),
  epicInProgress:        z.string().default("In Progress").describe("Epic: in progress"),
  epicDone:              z.string().default("Done").describe("Epic: done"),
  subTaskTodo:           z.string().default("To Do").describe("Sub-task: not started"),
  subTaskInDevelopment:  z.string().default("In Progress").describe("Sub-task: in progress"),
  subTaskReadyForTest:   z.string().default("In Review").describe("Sub-task: ready for review"),
  subTaskDone:           z.string().default("Done").describe("Sub-task: done"),
});

type ScaffoldArgs = z.infer<typeof SCAFFOLD_SCHEMA>;

export function registerTools(server: McpServer): void {
  registerScaffold(server);
  registerStatus(server);
}

function registerScaffold(server: McpServer): void {
  server.tool(
    "sdlc_scaffold",
    "Set up or reconfigure the SDLC for this project — writes .sdlc/config.json and scaffolds standards, artifact dirs, and MCP config files. Called by the /init agent after the interview.",
    SCAFFOLD_SCHEMA.shape,
    async (args: ScaffoldArgs) => {
      try {
        const root = await resolveProjectRoot();

        const config: SdlcConfig = {
          version:     CONFIG_VERSION,
          generatedAt: new Date().toISOString(),
          toolVersion: TOOL_VERSION,
          project: {
            name:      args.projectName,
            jiraKey:   args.jiraKey.toUpperCase(),
            jiraSite:  args.jiraSite,
            jiraEmail: args.jiraEmail,
          },
          phases: args.phases,
          team: {
            sprintLengthWeeks:  args.sprintLengthWeeks,
            estimationApproach: args.estimationApproach,
          },
          salesforce: { orgs: { sandbox: args.orgSandbox } },
          standards:  { apexCoverageThreshold: args.apexCoverageThreshold },
          jira: {
            statusMap: {
              story: {
                backlog:          args.storyBacklog,
                refineInProgress: args.storyRefineInProgress,
                readyForDesign:   args.storyReadyForDesign,
                designInProgress: args.storyDesignInProgress,
                readyForBuild:    args.storyReadyForBuild,
                inDevelopment:    args.storyInDevelopment,
                readyForTest:     args.storyReadyForTest,
                done:             args.storyDone,
              },
              epic: {
                notStarted: args.epicNotStarted,
                inProgress: args.epicInProgress,
                done:       args.epicDone,
              },
              subTask: {
                todo:          args.subTaskTodo,
                inDevelopment: args.subTaskInDevelopment,
                readyForTest:  args.subTaskReadyForTest,
                done:          args.subTaskDone,
              },
            },
          },
          branching: "gitflow",
          paths:     DEFAULT_PATHS,
        };

        const validated = SdlcConfigSchema.safeParse(config);
        if (!validated.success) {
          return {
            content: [{
              type: "text" as const,
              text: `⛔ Config validation failed:\n${validated.error.message}`,
            }],
            isError: true,
          };
        }

        const result = await scaffoldRepo(validated.data, root);

        const lines: string[] = [
          `✅ ${validated.data.project.name} — SDLC initialised`,
          ``,
          `Project:  ${validated.data.project.name} (${validated.data.project.jiraKey})`,
          `Phases:   ${validated.data.phases.join(", ")}`,
          `Sandbox:  ${validated.data.salesforce.orgs.sandbox}`,
          `Sprint:   ${validated.data.team.sprintLengthWeeks}w, ${validated.data.team.estimationApproach}`,
          `Coverage: ${validated.data.standards.apexCoverageThreshold}%`,
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

        lines.push(`\nRun /mcp__slalom-sdlc__discover to start a discovery session.`);

        return {
          content: [{ type: "text" as const, text: lines.join("\n") }],
        };
      } catch (err) {
        return {
          content: [{ type: "text" as const, text: `⛔ Scaffold failed: ${String(err)}` }],
          isError: true,
        };
      }
    }
  );
}

function registerStatus(server: McpServer): void {
  server.tool(
    "sdlc_status",
    "Check whether this project is configured and report the active SDLC settings",
    async () => {
      try {
        const { config } = await requireConfig();
        const lines = [
          `✅ SDLC configured: ${config.project.name} (${config.project.jiraKey})`,
          `Phases:   ${config.phases.join(", ")}`,
          `JIRA:     ${config.project.jiraSite}`,
          `Sandbox:  ${config.salesforce.orgs.sandbox}`,
          `Sprint:   ${config.team.sprintLengthWeeks}w, ${config.team.estimationApproach}`,
          `Coverage: ${config.standards.apexCoverageThreshold}%`,
          `Tool:     v${config.toolVersion}`,
        ];
        return { content: [{ type: "text" as const, text: lines.join("\n") }] };
      } catch (err) {
        return {
          content: [{
            type: "text" as const,
            text: `⚠ Not configured — ${String(err)}`,
          }],
        };
      }
    }
  );
}
