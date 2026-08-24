import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod/v3";
import { renderCommand } from "./render.js";

const STORY_KEY_SCHEMA = z.object({
  storyKey: z.string().optional().describe("JIRA story key (e.g. PROJ-42) or, for refine, an epic key or sprint to refine every unrefined story in it"),
});
type StoryKeyArgs = z.infer<typeof STORY_KEY_SCHEMA>;

const PHASE_DESCRIPTIONS: Record<string, string> = {
  discover: "Discovery agent — maps requirements, identifies unknowns, drafts epics and stories",
  refine:   "Refinement agent — acceptance criteria, open questions, effort estimate for a JIRA story, epic, or sprint (epic/sprint ⇒ refines all unrefined child stories)",
  design:   "Technical design agent — solution approach, data model, component breakdown, sub-tasks",
  build:    "Build agent — scaffolds Apex, LWC, config metadata; reviews with you; deploys to sandbox",
  test:     "Test agent — generates Apex test classes and JEST tests, validates coverage",
  release:  "Release agent — deployment notes, checklist, JIRA transitions",
};

// Phases that take an optional storyKey argument
const PHASES_WITH_KEY = ["refine", "design", "build", "test"] as const;

// Phases with no arguments
const PHASES_STORYLESS = ["discover", "release"] as const;

export function registerPrompts(server: McpServer, mcpVersion: string): void {
  registerStatic(server, "about", "What is this tool, how to use it, and all available commands", mcpVersion);
  registerStatic(server, "init", "Set up and scaffold the SDLC for this Salesforce project", mcpVersion);

  for (const phase of PHASES_STORYLESS) {
    registerStoryless(server, phase, mcpVersion);
  }
  for (const phase of PHASES_WITH_KEY) {
    registerWithStoryKey(server, phase, mcpVersion);
  }
}

function registerStatic(server: McpServer, command: string, description: string, mcpVersion: string): void {
  server.prompt(command, description, async () => {
    const { text } = await renderCommand(command, mcpVersion);
    return { messages: [{ role: "user" as const, content: { type: "text" as const, text } }] };
  });
}

function registerStoryless(server: McpServer, phase: string, mcpVersion: string): void {
  server.prompt(phase, PHASE_DESCRIPTIONS[phase], async () => {
    const { text } = await renderCommand(phase, mcpVersion);
    return { messages: [{ role: "user" as const, content: { type: "text" as const, text } }] };
  });
}

function registerWithStoryKey(server: McpServer, phase: string, mcpVersion: string): void {
  server.prompt(
    phase,
    PHASE_DESCRIPTIONS[phase],
    STORY_KEY_SCHEMA.shape,
    async ({ storyKey }: StoryKeyArgs) => {
      const { text } = await renderCommand(phase, mcpVersion, storyKey);
      return { messages: [{ role: "user" as const, content: { type: "text" as const, text } }] };
    }
  );
}
