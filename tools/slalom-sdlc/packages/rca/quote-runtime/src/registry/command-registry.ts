/**
 * command-registry.ts — Executable command catalogue for the quote-runtime CLI.
 *
 * COMMAND_REGISTRY is derived from ALL_COMMAND_SPECS (plan 022 Q3).  The wave
 * membership arrays (WAVE_n_EXECUTABLE_COMMANDS) remain as `as const` literals
 * to preserve their narrow tuple types — every entry also has a matching
 * CommandSpec.wave value, and a guard test in tests/commands/spec-names.test.ts
 * catches any drift.
 */

import { ALL_COMMAND_SPECS } from '../commands/all-commands';

import type { GlobalFlags } from '../cli/global-flags';
import type { CliIo } from '../cli/output';
import type { CommandName } from '../contracts/command-names';

export const WAVE_1_GROUP_NAME = 'Preflight and command fit';
export const WAVE_2_GROUP_NAME = 'Persisted snapshots and overlays';
export const WAVE_3_GROUP_NAME = 'Context and planning';

export const WAVE_1_EXECUTABLE_COMMANDS = ['doctor'] as const satisfies readonly CommandName[];
export const WAVE_2_EXECUTABLE_COMMANDS = ['snapshot-quote', 'snapshot-lines', 'overlay-actions', 'overlay-relationships'] as const satisfies readonly CommandName[];
export const WAVE_3_EXECUTABLE_COMMANDS = [
  'inspect-pricing-waterfall',
  'capture-post-pst-evidence',
  'classify-pricing-outcome',
  'create-quote',
  'upsert-quote-lines',
  'price-quote',
  'build-test-quote',
  'discover-products',
  'inspect-usage-rate-model',
  'inspect-pricing-product-sync',
  'deploy-product-catalog-index',
  'refresh-decision-tables',
  'inspect-quote-ready-product',
  'inspect-product-catalog-config',
  'plan-product-config',
  'apply-configured-quote',
  'pst-apply-quote-intent',
  'inspect-product-config',
  'validate-product-config',
  'repair-product-config',
  'inspect-rlm-context',
  'pst-plan',
  'compare-quote-pricing',
  'triage-symptom',
  'explain-price',
  'explain-missing-price',
  'verify-lifecycle-provenance',
  'test-pricing-change',
  'create-lifecycle-scenario',
  'inspect-asset-lifecycle',
  'plan-order-activation',
  'activate-order',
  'capture-post-activation-evidence'
] as const satisfies readonly CommandName[];
export const EXECUTABLE_COMMANDS = [
  ...WAVE_1_EXECUTABLE_COMMANDS,
  ...WAVE_2_EXECUTABLE_COMMANDS,
  ...WAVE_3_EXECUTABLE_COMMANDS
] as const;

export type Wave1ExecutableCommandName = (typeof WAVE_1_EXECUTABLE_COMMANDS)[number];
export type Wave2ExecutableCommandName = (typeof WAVE_2_EXECUTABLE_COMMANDS)[number];
export type Wave3ExecutableCommandName = (typeof WAVE_3_EXECUTABLE_COMMANDS)[number];
export type ExecutableCommandName = (typeof EXECUTABLE_COMMANDS)[number];

export type CommandGroup = {
  readonly name: typeof WAVE_1_GROUP_NAME | typeof WAVE_2_GROUP_NAME | typeof WAVE_3_GROUP_NAME;
  readonly order: 1 | 2 | 3;
};

export type CommandRegistryEntry = {
  readonly name: ExecutableCommandName;
  readonly group_name: CommandGroup['name'];
  readonly summary: string;
  readonly renderHelp: () => string;
  readonly run: (argv: string[], globalFlags: GlobalFlags, io: CliIo) => Promise<{ exitCode: 0 | 1 }>;
};

export const ROOT_COMMAND_GROUPS = [
  {
    name: WAVE_1_GROUP_NAME,
    order: 1
  },
  {
    name: WAVE_2_GROUP_NAME,
    order: 2
  },
  {
    name: WAVE_3_GROUP_NAME,
    order: 3
  }
] as const satisfies readonly CommandGroup[];

// ---------------------------------------------------------------------------
// COMMAND_REGISTRY — derived from ALL_COMMAND_SPECS (plan 022 Q3)
//
// Each CommandSpec carries the five fields that the registry exposes:
// name, group_name, summary, renderHelp, and run.  Building the registry
// from specs eliminates the 38 individual per-command imports that this file
// previously maintained.
// ---------------------------------------------------------------------------

export const COMMAND_REGISTRY: Readonly<Record<ExecutableCommandName, CommandRegistryEntry>> = Object.freeze(
  Object.fromEntries(
    ALL_COMMAND_SPECS.map((spec) => [
      spec.name,
      {
        name: spec.name as ExecutableCommandName,
        group_name: spec.group_name as CommandGroup['name'],
        summary: spec.summary,
        renderHelp: spec.renderHelp,
        run: spec.run
      } satisfies CommandRegistryEntry
    ])
  ) as Record<ExecutableCommandName, CommandRegistryEntry>
);

export function listExecutableCommands(): CommandRegistryEntry[] {
  return EXECUTABLE_COMMANDS.map((commandName) => COMMAND_REGISTRY[commandName]);
}

export function getRegistryEntry(commandName: string): CommandRegistryEntry | undefined {
  return Object.prototype.hasOwnProperty.call(COMMAND_REGISTRY, commandName)
    ? COMMAND_REGISTRY[commandName as ExecutableCommandName]
    : undefined;
}

export function isExecutableCommandName(commandName: string): commandName is ExecutableCommandName {
  return getRegistryEntry(commandName) !== undefined;
}
