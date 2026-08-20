/**
 * selector-functions.ts — Command ownership, selector policy, and doctor-preflight helpers.
 *
 * Consolidated from routing/route-logic.ts (plan 022 Q4).  The two maps
 * (COMMAND_OWNERSHIP_MAP, COMMAND_SELECTOR_POLICY_MAP) that were static in
 * route-logic.ts are now derived from ALL_COMMAND_SPECS via a push-registration
 * pattern that resolves the CJS require-time cycle without using a deferred
 * require() call (which breaks Vitest's module interceptor for .ts files).
 *
 * ── CJS cycle explanation ──────────────────────────────────────────────────
 * all-commands.ts → doctor.ts (and 7 other command files) → this file
 * → all-commands.ts  ← this would be a cycle at require-time
 *
 * Resolution: this file does NOT import all-commands.ts at module-load time.
 * Instead, all-commands.ts calls `_registerSpecMaps(ALL_COMMAND_SPECS)` at the
 * END of its own module evaluation (after the const is fully defined).  By that
 * point, this file is already in the CJS cache, so `_registerSpecMaps` just
 * sets the two module-level variables.
 *
 * Command files that only ever check their own readiness (inspect-pricing-
 * waterfall, capture-post-pst-evidence, classify-pricing-outcome) use the pure
 * `getReadinessIssuesForPolicy(policy, selectors)` function instead and never
 * need the maps at all.
 * ────────────────────────────────────────────────────────────────────────────
 */

import { ALL_COMMAND_NAMES, type CommandName } from '../contracts/command-names';
import type { RuntimeSelectorBundle } from '../selectors/runtime-selectors';

// ---------------------------------------------------------------------------
// Re-export: backward-compat alias (route-logic.ts surfaced this via index.ts)
// ---------------------------------------------------------------------------

export const ROUTE_LOGIC_COMMANDS = ALL_COMMAND_NAMES;

// ---------------------------------------------------------------------------
// Ownership types
// ---------------------------------------------------------------------------

export const COMMAND_OWNER_NAMES = [
  'quote-runtime-mutations',
  'pricing-runtime-debug',
  'runtime-context-inspection',
  'config-runtime-bridge'
] as const;

export type CommandOwnerName = (typeof COMMAND_OWNER_NAMES)[number];

export type SharedLibraryDependency =
  | 'selectors'
  | 'doctor'
  | 'evidence'
  | 'pst_plan'
  | 'snapshot_quote'
  | 'snapshot_lines'
  | 'result_envelope'
  | 'overlay_actions'
  | 'overlay_relationships'
  | 'inspect_rlm_context'
  | 'compare_quotes'
  | 'route_logic'
  | 'quote_mutations'
  | 'product_discovery'
  | 'usage_rate_model'
  | 'pricing_product_sync'
  | 'product_catalog_config'
  | 'rest';

export type CommandOwnership = {
  primary_owner: CommandOwnerName;
  secondary_escalation: readonly CommandOwnerName[];
  shared_library_dependencies: readonly SharedLibraryDependency[];
};

// ---------------------------------------------------------------------------
// Selector types
// ---------------------------------------------------------------------------

export const SELECTOR_KEYS = [
  'quote_id',
  'before_quote_id',
  'after_quote_id',
  'line_ids',
  'asset_ids',
  'symptom',
  'expected_change',
  'changed_artifact',
  'operation_family'
] as const;

export type SelectorKey = (typeof SELECTOR_KEYS)[number];

export type CommandSelectorPolicy = {
  required_selectors: readonly SelectorKey[];
  recommended_selectors: readonly SelectorKey[];
  selector_constraints?: readonly CommandSelectorConstraint[];
  status_reason: string;
};

export type CommandSelectorConstraint = {
  key: 'line_ids_exactly_one';
  selector: 'line_ids';
  kind: 'exactly_one';
  message: string;
};

export type CommandReadinessIssue = {
  key: SelectorKey | CommandSelectorConstraint['key'];
  message: string;
};

// ---------------------------------------------------------------------------
// Registration-based maps derived from ALL_COMMAND_SPECS
// ---------------------------------------------------------------------------

/**
 * Minimal typing for the spec shape needed here — avoids importing spec.ts
 * at module level (which would then pull in all-commands.ts and recreate the
 * cycle we're solving).
 */
type SpecLite = {
  name: CommandName;
  ownership: CommandOwnership;
  selectorPolicy: CommandSelectorPolicy;
};

let _ownershipMap: Readonly<Record<CommandName, CommandOwnership>> | undefined;
let _selectorPolicyMap: Readonly<Record<CommandName, CommandSelectorPolicy>> | undefined;

/**
 * Called once by all-commands.ts at the end of its module evaluation, after
 * ALL_COMMAND_SPECS is fully defined.  Populates the derived ownership and
 * selector-policy maps.
 *
 * Maps are keyed in ALL_COMMAND_NAMES canonical order (not ALL_COMMAND_SPECS
 * iteration order) so that Object.keys() always matches ALL_COMMAND_NAMES.
 *
 * Prefixed with _ to signal that this is internal infrastructure.  Callers
 * outside all-commands.ts should not call this function directly.
 */
export function _registerSpecMaps(specs: readonly SpecLite[]): void {
  const specByName = new Map(specs.map((s) => [s.name, s]));

  _ownershipMap = Object.freeze(
    Object.fromEntries(ALL_COMMAND_NAMES.map((name) => [name, specByName.get(name)!.ownership]))
  ) as Record<CommandName, CommandOwnership>;

  _selectorPolicyMap = Object.freeze(
    Object.fromEntries(ALL_COMMAND_NAMES.map((name) => [name, specByName.get(name)!.selectorPolicy]))
  ) as Record<CommandName, CommandSelectorPolicy>;
}

/**
 * Guards that the maps have been registered.  Throws a descriptive error if
 * called before all-commands.ts has finished loading (or in a test that does
 * not chain through all-commands.ts).
 */
function ensureMaps(): void {
  if (_ownershipMap !== undefined) return;
  throw new Error(
    '[selector-functions] Ownership/selector-policy maps not yet registered. ' +
    'Ensure all-commands.ts (or the root barrel src/index.ts) is imported ' +
    'before calling any map-dependent function.'
  );
}

// ---------------------------------------------------------------------------
// Public map accessors (kept for test/external consumers)
// ---------------------------------------------------------------------------

/**
 * Returns the ownership map derived from ALL_COMMAND_SPECS.
 * Lazily initialized on first call.
 */
export function getOwnershipMap(): Readonly<Record<CommandName, CommandOwnership>> {
  ensureMaps();
  return _ownershipMap!;
}

/**
 * Returns the selector policy map derived from ALL_COMMAND_SPECS.
 * Lazily initialized on first call.
 */
export function getSelectorPolicyMap(): Readonly<Record<CommandName, CommandSelectorPolicy>> {
  ensureMaps();
  return _selectorPolicyMap!;
}

// ---------------------------------------------------------------------------
// Command lookup functions (named consumers: doctor, readiness-check callers)
// ---------------------------------------------------------------------------

export function getCommandOwnership(commandName: CommandName): CommandOwnership {
  ensureMaps();
  return _ownershipMap![commandName];
}

export function getCommandSelectorPolicy(commandName: CommandName): CommandSelectorPolicy {
  ensureMaps();
  return _selectorPolicyMap![commandName];
}

export function getMissingRequiredSelectorsForCommand(
  commandName: CommandName,
  selectors: RuntimeSelectorBundle
): SelectorKey[] {
  return getCommandSelectorPolicy(commandName).required_selectors.filter(
    (selectorKey) => !selectorHasValue(selectorKey, selectors)
  );
}

/**
 * Pure function: compute readiness issues from a policy directly, without
 * consulting the derived maps.  Suitable for command files that know their own
 * selectorPolicy statically (e.g. inspect-pricing-waterfall, capture-post-pst-
 * evidence, classify-pricing-outcome).
 */
export function getReadinessIssuesForPolicy(
  policy: CommandSelectorPolicy,
  selectors: RuntimeSelectorBundle
): CommandReadinessIssue[] {
  const missingSelectors = policy.required_selectors
    .filter((selectorKey) => !selectorHasValue(selectorKey, selectors))
    .map((selectorKey) => ({ key: selectorKey, message: selectorRequirementMessage(selectorKey) } satisfies CommandReadinessIssue));

  const constraintViolations =
    policy.selector_constraints?.flatMap((constraint) => {
      if (constraint.selector === 'line_ids' && constraint.kind === 'exactly_one' && selectors.line_ids.length !== 1) {
        return [{ key: constraint.key, message: constraint.message } satisfies CommandReadinessIssue];
      }
      return [];
    }) ?? [];

  return [...missingSelectors, ...constraintViolations];
}

export function getCommandReadinessIssuesForCommand(
  commandName: CommandName,
  selectors: RuntimeSelectorBundle
): CommandReadinessIssue[] {
  return getReadinessIssuesForPolicy(getCommandSelectorPolicy(commandName), selectors);
}

export function formatCommandReadinessIssues(
  commandName: CommandName,
  issues: readonly CommandReadinessIssue[]
): string {
  return `${commandName} readiness check failed: ${issues.map((issue) => issue.message).join(' ')}`;
}

export function getDoctorRecommendedNextCommands(
  commandName: CommandName,
  selectors: RuntimeSelectorBundle
): CommandName[] {
  return getCommandReadinessIssuesForCommand(commandName, selectors).length === 0 ? [commandName] : [];
}

export function getDoctorNextSuggestedCommand(
  commandName: CommandName,
  selectors: RuntimeSelectorBundle
): CommandName | null {
  return getDoctorRecommendedNextCommands(commandName, selectors)[0] ?? null;
}

// ---------------------------------------------------------------------------
// Private helpers
// ---------------------------------------------------------------------------

function selectorHasValue(selectorKey: SelectorKey, selectors: RuntimeSelectorBundle): boolean {
  const value = selectors[selectorKey];

  if (Array.isArray(value)) {
    return value.length > 0;
  }

  return value !== null;
}

function selectorRequirementMessage(selectorKey: SelectorKey): string {
  switch (selectorKey) {
    case 'quote_id':
      return 'Provide --quote-id <id>.';
    case 'before_quote_id':
      return 'Provide --before-quote-id <id>.';
    case 'after_quote_id':
      return 'Provide --after-quote-id <id>.';
    case 'line_ids':
      return 'Provide at least one --line-id <id>.';
    case 'asset_ids':
      return 'Provide at least one --asset-id <id>.';
    case 'symptom':
      return 'Provide --symptom <text>.';
    case 'expected_change':
      return 'Provide --expected-change <text>.';
    case 'changed_artifact':
      return 'Provide --changed-artifact <text>.';
    case 'operation_family':
      return 'Provide --operation-family <family>.';
  }
}
