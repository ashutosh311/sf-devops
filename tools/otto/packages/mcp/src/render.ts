import {
  renderPrompt,
  CACHE_CURRENT_DIR,
  TEST_SKILLS,
  skillTemplateKey,
  renderDiscoverAdvisoryPrompt,
  DISCOVER_ADVISORY_SKILLS,
  type DiscoverAdvisorySkill,
} from "@otto/core";
import { requireConfig } from "./config.js";
import { buildAboutText, INIT_DISPATCH } from "./about.js";

export const PHASES = ["discover", "refine", "design", "build", "test", "release"] as const;
export type Phase = (typeof PHASES)[number];

/** Every invocable command — the six phases plus the two static ones. */
export const COMMANDS = ["about", "init", ...PHASES] as const;
export type Command = (typeof COMMANDS)[number];

/** Sub-skills valid per command. Extend here when another phase gains a menu. */
export const COMMAND_SKILLS: Record<string, readonly string[]> = {
  test: TEST_SKILLS,
  discover: DISCOVER_ADVISORY_SKILLS,
};

function isDiscoverAdvisorySkill(skill: string): skill is DiscoverAdvisorySkill {
  return (DISCOVER_ADVISORY_SKILLS as readonly string[]).includes(skill);
}

/**
 * Applies a command's implicit skill default. A `test` call that names a story
 * but no skill runs `execute` — this is the pre-menu behaviour of `/otto:test
 * PROJ-42`, and without it a ticket-only invocation renders the menu instead of
 * the execution procedure (the phase's exit gate). Exported so usage tracking
 * records the same key that actually rendered.
 */
export function resolveSkill(command: string, storyKey?: string, skill?: string): string | undefined {
  if (skill) return skill;
  if (command === "test" && storyKey) return "execute";
  return undefined;
}

export interface RenderResult {
  ok: boolean;
  text: string;
}

/**
 * Resolve a command to the agent text that drives it.
 *
 * Single entry point shared by the MCP prompts (prompts.ts) and the `otto_prompt`
 * tool (tools.ts). The plugin's slash commands go through the tool rather than the
 * prompt — a slash command is static markdown and can't render Handlebars against
 * the project's `.otto/config.json` — so routing both surfaces through here is what stops them
 * from drifting apart.
 */
export async function renderCommand(
  command: string,
  mcpVersion: string,
  storyKey?: string,
  projectRoot?: string,
  skill?: string
): Promise<RenderResult> {
  if (command === "about") return { ok: true, text: buildAboutText(mcpVersion) };
  if (command === "init")  return { ok: true, text: INIT_DISPATCH };

  try {
    const { config } = await requireConfig(projectRoot);

    // Gate on the BASE phase — a sub-skill key (e.g. "test-apex-unit") is
    // never itself in config.phases, so gating on `command` here (rather than
    // on a composed templateKey) is what lets sub-skills render at all.
    if (!config.phases.includes(command as Phase)) {
      return {
        ok: false,
        text: `The "${command}" phase is not enabled for this project. Enabled phases: ${config.phases.join(", ")}.`,
      };
    }

    const effectiveSkill = resolveSkill(command, storyKey, skill);
    if (effectiveSkill) {
      const allowed = COMMAND_SKILLS[command] ?? [];
      if (!allowed.includes(effectiveSkill)) {
        return {
          ok: false,
          text: `Unknown skill "${effectiveSkill}" for ${command}. Valid skills: ${allowed.join(", ") || "none"}.`,
        };
      }
    }

    // Discover's advisory skills (synthesize, analyze, ...) are read-files-then-
    // report work sharing one template — rendered via renderDiscoverAdvisoryPrompt()
    // rather than a per-skill PHASE_TEMPLATES key like the test-* skills use.
    let text = effectiveSkill && command === "discover" && isDiscoverAdvisorySkill(effectiveSkill)
      ? renderDiscoverAdvisoryPrompt(config, effectiveSkill, { cacheDir: CACHE_CURRENT_DIR })
      : renderPrompt(effectiveSkill ? skillTemplateKey(command, effectiveSkill) : command, config, { cacheDir: CACHE_CURRENT_DIR });

    if (storyKey) {
      const key = storyKey.toUpperCase();
      text = text.replace(/\{STORY_KEY\}/g, key).replace(/\{TICKET_KEY\}/g, key);
    }

    return { ok: true, text };
  } catch (err) {
    return { ok: false, text: `⛔ ${String(err)}` };
  }
}
