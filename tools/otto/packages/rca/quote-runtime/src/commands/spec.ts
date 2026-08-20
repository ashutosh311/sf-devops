/**
 * CommandSpec — the single source of truth for what a command *is*.
 *
 * Design notes
 * ────────────
 * - wave / group_name: encodes command grouping so the registry, wave arrays,
 *   and help text can all be derived from ONE place.
 * - ownership / selectorPolicy: carries the same data that currently lives in
 *   route-logic.ts, enabling a guard test to catch drift until Q4 dissolves
 *   route-logic.ts entirely.
 * - quickStart: one or two representative examples for root-help output.  Two
 *   entries are used only by `doctor` (one generic, one scoped to snapshot-quote).
 * - renderHelp / run: the two surface-visible contract points that the registry
 *   exposes to the CLI dispatcher.
 *
 * Circular-import note (CJS) — resolved in Q4
 * ──────────────────────────────────────────────
 * Eight command files import FUNCTIONS from routing/selector-functions.ts at
 * runtime.  selector-functions.ts derives its maps from ALL_COMMAND_SPECS via
 * a deferred require() call inside ensureMaps(), which is only executed when
 * a function is first CALLED (not at module-load time).  By then, the CJS
 * loader has fully evaluated all modules — no require-time cycle, no undefined
 * captures.  See selector-functions.ts for the full explanation.
 */

import type { CommandName } from '../contracts/command-names';
import type { GlobalFlags } from '../cli/global-flags';
import type { CliIo } from '../cli/output';
import type { CommandOwnership, CommandSelectorPolicy } from '../routing/selector-functions';

// ---------------------------------------------------------------------------
// Wave / group types (avoid importing from command-registry.ts which would
// create a type-level cycle that some TS project settings reject)
// ---------------------------------------------------------------------------

export type WaveNumber = 1 | 2 | 3;

/** Display names for the three registry groups used in root-help output. */
export type WaveGroupName =
  | 'Preflight and command fit'
  | 'Persisted snapshots and overlays'
  | 'Context and planning';

/** Canonical wave-to-group mapping used when deriving group_name from wave. */
export const WAVE_GROUP_NAMES = {
  1: 'Preflight and command fit',
  2: 'Persisted snapshots and overlays',
  3: 'Context and planning'
} as const satisfies Record<WaveNumber, WaveGroupName>;

// ---------------------------------------------------------------------------
// CommandSpec
// ---------------------------------------------------------------------------

export type CommandSpec = {
  /** The command's canonical kebab-case name (must appear in ALL_COMMAND_NAMES). */
  readonly name: CommandName;
  /** Wave this command belongs to (1 = preflight, 2 = snapshots, 3 = planning). */
  readonly wave: WaveNumber;
  /** Registry group name — derived from wave; always consistent with WAVE_GROUP_NAMES. */
  readonly group_name: WaveGroupName;
  /** One-line description used in root-help command lists and registry summaries. */
  readonly summary: string;
  /** Agent-team ownership metadata (mirrors COMMAND_OWNERSHIP_MAP in route-logic.ts). */
  readonly ownership: CommandOwnership;
  /** Selector requirements used for doctor preflight checks (mirrors COMMAND_SELECTOR_POLICY_MAP). */
  readonly selectorPolicy: CommandSelectorPolicy;
  /**
   * Representative quick-start example(s) for the root-help "Quick starts" section.
   * Most commands provide one string; `doctor` provides two (generic + snapshot-quote scoped).
   */
  readonly quickStart: string | readonly string[];
  /** Returns the command's full --help text. */
  readonly renderHelp: () => string;
  /** Executes the command and returns the process exit code. */
  readonly run: (argv: string[], globalFlags: GlobalFlags, io: CliIo) => Promise<{ exitCode: 0 | 1 }>;
};

// ---------------------------------------------------------------------------
// defineCommand — identity function for IDE autocomplete + type narrowing
// ---------------------------------------------------------------------------

/**
 * Wraps a CommandSpec literal, providing full TypeScript narrowing and IDE
 * autocomplete at the call site.  No runtime overhead; returns the argument unchanged.
 *
 * Usage:
 * ```ts
 * export const MY_COMMAND_SPEC = defineCommand({
 *   name: 'my-command',
 *   wave: 3,
 *   group_name: WAVE_GROUP_NAMES[3],
 *   summary: 'Does the thing.',
 *   ownership: { ... },
 *   selectorPolicy: { ... },
 *   quickStart: 'quote-runtime my-command --org-alias <alias>',
 *   renderHelp: renderMyCommandHelp,
 *   run: runMyCommand,
 * });
 * ```
 */
export function defineCommand(spec: CommandSpec): CommandSpec {
  return spec;
}
