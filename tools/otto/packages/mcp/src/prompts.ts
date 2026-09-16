import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod/v3";
import { DISCOVER_ADVISORY_SKILLS } from "@otto/core";
import { renderCommand } from "./render.js";

const STORY_KEY_SCHEMA = z.object({
  storyKey: z.string().optional().describe("JIRA story key (e.g. PROJ-42) or, for refine/design, an epic key or sprint to process every eligible child story in it"),
});
type StoryKeyArgs = z.infer<typeof STORY_KEY_SCHEMA>;

const DISCOVER_ARGS_SCHEMA = z.object({
  skill: z.string().optional().describe(
    `Optional sub-skill: ${DISCOVER_ADVISORY_SKILLS.join(" | ")}. Omit to show the menu.`
  ),
});
type DiscoverArgs = z.infer<typeof DISCOVER_ARGS_SCHEMA>;

const TEST_ARGS_SCHEMA = z.object({
  storyKey: z.string().optional().describe("Ticket key, e.g. PROJ-42"),
  skill:    z.string().optional().describe(
    "Sub-skill: execute | write-cases | apex-unit | apex-perf | pw-setup | pw-write. Omit to show the menu (or, with a storyKey but no skill, run execute)."
  ),
});
type TestArgs = z.infer<typeof TEST_ARGS_SCHEMA>;

const REFINE_ARGS_SCHEMA = z.object({
  storyKey: z.string().optional().describe("Story key (e.g. PROJ-42), epic key, or sprint. For the story skill, an epic/sprint refines every eligible child story. For generate-stories, an epic key/ID is the epic new stories are drafted under."),
  skill:    z.string().optional().describe(
    "Sub-skill: story | generate-stories | data-dictionary. Omit to show the menu (or, with a storyKey but no skill, run story). generate-stories drafts new candidate stories under an epic from user-specified transcripts/files."
  ),
});
type RefineArgs = z.infer<typeof REFINE_ARGS_SCHEMA>;

const PHASE_DESCRIPTIONS: Record<string, string> = {
  discover: "Discovery agent — maps requirements, identifies unknowns, drafts epics and stories",
  refine:   "Refinement agent — menu-driven: refine a story (AC, open questions) for a JIRA story/epic/sprint, generate new candidate stories under an epic from transcripts/files, or build the shared data dictionary",
  design:   "Technical design agent — solution approach, data model, component breakdown, sub-tasks for a JIRA story, epic, or sprint (epic/sprint ⇒ designs every eligible child story + publishes an epic synthesis design)",
  build:    "Build agent — scaffolds Apex, LWC, config metadata; reviews with you; deploys to sandbox",
  test:     "Test agent — menu-driven: execute AC in the sandbox, author test cases in Xray/Zephyr/ADO Test Plans, extend Apex unit + performance tests, or set up and write Playwright E2E tests",
  release:  "Release agent — deployment notes, checklist, JIRA transitions",
};

// Phases that take an optional storyKey argument (refine + test move out — they also take a skill)
const PHASES_WITH_KEY = ["design", "build"] as const;

// Phases with no arguments beyond the discover skill menu (discover) or none at all (release)
const PHASES_STORYLESS = ["release"] as const;

export function registerPrompts(server: McpServer, mcpVersion: string): void {
  registerStatic(server, "about", "What is this tool, how to use it, and all available commands", mcpVersion);
  registerStatic(server, "init", "Set up and scaffold the SDLC for this Salesforce project", mcpVersion);

  for (const phase of PHASES_STORYLESS) {
    registerStoryless(server, phase, mcpVersion);
  }
  registerDiscover(server, mcpVersion);
  for (const phase of PHASES_WITH_KEY) {
    registerWithStoryKey(server, phase, mcpVersion);
  }
  registerRefine(server, mcpVersion);
  registerTest(server, mcpVersion);
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

function registerDiscover(server: McpServer, mcpVersion: string): void {
  server.prompt(
    "discover",
    PHASE_DESCRIPTIONS.discover,
    DISCOVER_ARGS_SCHEMA.shape,
    async ({ skill }: DiscoverArgs) => {
      const { text } = await renderCommand("discover", mcpVersion, undefined, undefined, skill);
      return { messages: [{ role: "user" as const, content: { type: "text" as const, text } }] };
    }
  );
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

function registerRefine(server: McpServer, mcpVersion: string): void {
  server.prompt(
    "refine",
    PHASE_DESCRIPTIONS.refine,
    REFINE_ARGS_SCHEMA.shape,
    async ({ storyKey, skill }: RefineArgs) => {
      const { text } = await renderCommand("refine", mcpVersion, storyKey, undefined, skill);
      return { messages: [{ role: "user" as const, content: { type: "text" as const, text } }] };
    }
  );
}

function registerTest(server: McpServer, mcpVersion: string): void {
  server.prompt(
    "test",
    PHASE_DESCRIPTIONS.test,
    TEST_ARGS_SCHEMA.shape,
    async ({ storyKey, skill }: TestArgs) => {
      const { text } = await renderCommand("test", mcpVersion, storyKey, undefined, skill);
      return { messages: [{ role: "user" as const, content: { type: "text" as const, text } }] };
    }
  );
}
