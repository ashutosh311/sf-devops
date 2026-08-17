import { PricingCliError } from '../contracts/errors';
import type { NormalizedProcedureVersion } from '../contracts/types';

export type VersionSelector =
  | { kind: 'active' }
  | { kind: 'rank'; value: string }
  | { kind: 'full_name'; value: string };

export type StepSelectorKind = 'step_name' | 'sequence' | 'action_type' | 'parent_step';

const ALL_STEP_SELECTOR_KINDS: StepSelectorKind[] = ['step_name', 'sequence', 'action_type', 'parent_step'];

export interface StepSelectorInput {
  stepName?: string | null;
  sequence?: string | null;
  actionType?: string | null;
  parentStep?: string | null;
}

export interface StepSelectorOption<K extends StepSelectorKind = StepSelectorKind> {
  kind: K;
  value: string;
}

const STEP_SELECTOR_FLAG_LABELS: Record<StepSelectorKind, string> = {
  step_name: '--step-name',
  sequence: '--sequence',
  action_type: '--action-type',
  parent_step: '--parent-step',
};

export function parseVersionSelector(selector?: string): VersionSelector | null {
  if (selector == null) {
    return null;
  }
  if (selector === 'active') {
    return { kind: 'active' };
  }
  if (selector.startsWith('rank:')) {
    const rank = selector.split(':', 2)[1] ?? '';
    if (!/^\d+$/.test(rank)) {
      throw new PricingCliError(
        'invalid_selector_format',
        'Version selector format is not supported.',
        { requested: selector },
        'Use one of: active, FULL_NAME, or rank:N.',
      );
    }
    return { kind: 'rank', value: rank };
  }
  if (selector.startsWith('rank=') || selector.startsWith('rank/')) {
    throw new PricingCliError(
      'invalid_selector_format',
      'Version selector format is not supported.',
      { requested: selector },
      'Use one of: active, FULL_NAME, or rank:N.',
    );
  }
  return { kind: 'full_name', value: selector };
}

export function selectVersions(
  versions: readonly NormalizedProcedureVersion[],
  selector?: string,
): NormalizedProcedureVersion[] {
  const parsed = parseVersionSelector(selector);
  if (!parsed) {
    return [...versions];
  }
  if (parsed.kind === 'active') {
    return versions.filter((version) => version.status === 'Active');
  }
  if (parsed.kind === 'rank') {
    return versions.filter((version) => String(version.rank) === parsed.value);
  }
  return versions.filter((version) => version.fullName === parsed.value);
}

export function resolveVersionSelectorWithActiveDefault(selector?: string, activeOnly = false): string | undefined {
  return selector ?? (activeOnly ? 'active' : undefined);
}

export function selectVersionsWithActiveDefault(
  versions: readonly NormalizedProcedureVersion[],
  selector?: string,
  activeOnly = false,
): NormalizedProcedureVersion[] {
  return selectVersions(versions, resolveVersionSelectorWithActiveDefault(selector, activeOnly));
}

export function collectProvidedStepSelectorFamilies(
  input: StepSelectorInput,
  allowedKinds: readonly StepSelectorKind[] = ALL_STEP_SELECTOR_KINDS,
): StepSelectorOption[] {
  const candidates: Array<{ kind: StepSelectorKind; value: string | null }> = [
    { kind: 'step_name', value: input.stepName ?? null },
    { kind: 'sequence', value: input.sequence ?? null },
    { kind: 'action_type', value: input.actionType ?? null },
    { kind: 'parent_step', value: input.parentStep ?? null },
  ];
  return candidates.filter((entry): entry is StepSelectorOption => allowedKinds.includes(entry.kind) && entry.value != null);
}

export function requireExactOneStepSelectorFamily(
  input: StepSelectorInput,
  options: {
    allowedKinds?: readonly StepSelectorKind[];
    message?: string;
    suggestion?: string;
  } = {},
): StepSelectorOption {
  const allowedKinds = options.allowedKinds ?? ALL_STEP_SELECTOR_KINDS;
  const activeSelectors = collectProvidedStepSelectorFamilies(input, allowedKinds);
  if (activeSelectors.length !== 1) {
    throw new PricingCliError(
      'invalid_selector_format',
      options.message ?? 'Exactly one step selector family is required.',
      {
        received: Object.fromEntries(activeSelectors.map(({ kind, value }) => [kind, value])),
      },
      options.suggestion
        ?? `Use exactly one of: ${allowedKinds.map((kind) => STEP_SELECTOR_FLAG_LABELS[kind]).join(', ')}.`,
    );
  }
  return activeSelectors[0];
}
