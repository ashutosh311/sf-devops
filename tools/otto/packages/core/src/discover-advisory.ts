/**
 * Discover's "advisory" sub-skills — read-only, read-files-then-summarize work
 * (synthesize, analyze, conflict-check, ...). Single source of truth for both
 * front ends: the VS Code handler (packages/vscode/src/handlers/discover.ts)
 * imports this directly instead of keeping its own copy, and the MCP server
 * (packages/mcp/src/render.ts) uses it to validate/route the `skill` argument
 * and render the shared prompt (see templates/discover-advisory.ts).
 */

export interface DiscoverAdvisorySpec {
  /** What this skill should do with the evidence it reads — the per-skill task. */
  instruction: string;
  /** Artifact sub-folders (relative to `paths.artifacts`) this skill reads. */
  folders: string[];
}

export const DISCOVER_ADVISORY_SKILLS = [
  "synthesize",
  "analyze",
  "conflict-check",
  "compose-deliverable",
  "prep-workshop",
  "hub-audit",
  "whats-next",
  "registers-to-stories",
] as const;

export type DiscoverAdvisorySkill = (typeof DISCOVER_ADVISORY_SKILLS)[number];

export const DISCOVER_ADVISORY: Record<DiscoverAdvisorySkill, DiscoverAdvisorySpec> = {
  synthesize: {
    instruction:
      "Synthesize the discovery evidence into key themes, patterns, and current-state insights. Produce a clear markdown summary a consultant can share.",
    folders: ["00 - Registers", "01 - Sessions"],
  },
  analyze: {
    instruction:
      "Analyze and prioritize the discovery evidence: rank pain points by impact/frequency, flag coverage gaps, and highlight the highest-value focus areas. Output markdown.",
    folders: ["00 - Registers", "02 - Current State"],
  },
  "conflict-check": {
    instruction:
      "Surface contradictions and misalignments across the sessions and registers before they become delivery blockers. List each conflict with the sources involved.",
    folders: ["00 - Registers", "01 - Sessions"],
  },
  "compose-deliverable": {
    instruction:
      "Compose a clear, client-facing discovery deliverable (executive summary, current state, key findings, recommended direction) from the artifacts provided.",
    folders: ["00 - Registers", "02 - Current State", "03 - Future State"],
  },
  "prep-workshop": {
    instruction:
      "Prepare for an upcoming discovery workshop: propose an agenda, facilitation guide, key questions to close open gaps, and a short pre-read. Base it on what is already known.",
    folders: ["00 - Registers", "01 - Sessions"],
  },
  "hub-audit": {
    instruction:
      "Audit the discovery knowledge hub for completeness. Report what content is present vs missing per area, register health, and a phase-gate readiness verdict.",
    folders: ["00 - Project", "00 - Registers", "01 - Sessions", "02 - Current State", "03 - Future State", "04 - Backlog"],
  },
  "whats-next": {
    instruction:
      "Give the user a concise orientation: what has been done so far in discovery, what is missing, and the single recommended next step (naming the exact /discover sub-command).",
    folders: ["00 - Project", "00 - Registers", "01 - Sessions", "02 - Current State", "04 - Backlog"],
  },
  "registers-to-stories": {
    instruction:
      "Convert the register entries directly into well-formed user stories (As a…, I want…, so that…). Group them under likely epics. This is discovery-level only — no technical design.",
    folders: ["00 - Registers"],
  },
};
