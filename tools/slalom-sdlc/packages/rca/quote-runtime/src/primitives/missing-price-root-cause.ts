/**
 * missing-price-root-cause.ts — Root-cause classification for missing-price scenarios.
 *
 * Moved from routing/route-logic.ts (plan 022 Q4).
 * Sole caller: src/commands/explain-missing-price.ts.
 *
 * No imports from all-commands.ts or any command file — zero cycle risk.
 */

import type { CommandName } from '../contracts/command-names';

export type MissingPriceRootCause = {
  likely_root_cause_class:
    | 'bundle_included_component'
    | 'lifecycle_provenance_gap'
    | 'calculation_not_complete'
    | 'unexplained_missing_price';
  recommended_branch: 'structure_overlay' | 'lifecycle_overlay' | 'persisted_recheck' | 'context_bridge';
  recommended_next_commands: readonly CommandName[];
};

export function classifyMissingPriceRootCause(input: {
  calculationStatus?: string | null;
  bundleInclusionFound: boolean;
  lifecycleProvenanceFound: boolean;
}): MissingPriceRootCause {
  if (input.bundleInclusionFound) {
    return {
      likely_root_cause_class: 'bundle_included_component',
      recommended_branch: 'structure_overlay',
      recommended_next_commands: ['overlay-relationships', 'inspect-rlm-context']
    };
  }

  if (input.lifecycleProvenanceFound) {
    return {
      likely_root_cause_class: 'lifecycle_provenance_gap',
      recommended_branch: 'lifecycle_overlay',
      recommended_next_commands: ['overlay-actions', 'inspect-rlm-context']
    };
  }

  if (typeof input.calculationStatus === 'string' && input.calculationStatus.trim().toLowerCase() === 'pending') {
    return {
      likely_root_cause_class: 'calculation_not_complete',
      recommended_branch: 'persisted_recheck',
      recommended_next_commands: ['snapshot-quote', 'snapshot-lines', 'inspect-rlm-context']
    };
  }

  return {
    likely_root_cause_class: 'unexplained_missing_price',
    recommended_branch: 'context_bridge',
    recommended_next_commands: ['inspect-rlm-context', 'overlay-relationships', 'overlay-actions']
  };
}
