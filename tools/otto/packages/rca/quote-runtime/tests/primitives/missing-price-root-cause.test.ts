/**
 * Tests for src/primitives/missing-price-root-cause.ts
 *
 * New in plan 022 Q4 alongside the extraction of classifyMissingPriceRootCause
 * from routing/route-logic.ts.  The function is exercised end-to-end through
 * buildExplainMissingPriceEnvelope in tests/commands/explain-missing-price.test.ts;
 * this file adds direct unit coverage for each branch.
 */

import { describe, expect, it } from 'vitest';

import {
  classifyMissingPriceRootCause,
  type MissingPriceRootCause
} from '../../src/primitives/missing-price-root-cause';

describe('classifyMissingPriceRootCause', () => {
  it('returns bundle_included_component when bundleInclusionFound is true', () => {
    expect(
      classifyMissingPriceRootCause({ bundleInclusionFound: true, lifecycleProvenanceFound: false })
    ).toEqual({
      likely_root_cause_class: 'bundle_included_component',
      recommended_branch: 'structure_overlay',
      recommended_next_commands: ['overlay-relationships', 'inspect-rlm-context']
    } satisfies MissingPriceRootCause);
  });

  it('returns lifecycle_provenance_gap when lifecycleProvenanceFound is true (bundle check takes priority)', () => {
    expect(
      classifyMissingPriceRootCause({ bundleInclusionFound: false, lifecycleProvenanceFound: true })
    ).toEqual({
      likely_root_cause_class: 'lifecycle_provenance_gap',
      recommended_branch: 'lifecycle_overlay',
      recommended_next_commands: ['overlay-actions', 'inspect-rlm-context']
    } satisfies MissingPriceRootCause);
  });

  it('bundle_included_component takes priority over lifecycleProvenanceFound', () => {
    expect(
      classifyMissingPriceRootCause({ bundleInclusionFound: true, lifecycleProvenanceFound: true })
    ).toMatchObject({ likely_root_cause_class: 'bundle_included_component' });
  });

  it('returns calculation_not_complete when calculationStatus is "pending"', () => {
    expect(
      classifyMissingPriceRootCause({
        bundleInclusionFound: false,
        lifecycleProvenanceFound: false,
        calculationStatus: 'pending'
      })
    ).toEqual({
      likely_root_cause_class: 'calculation_not_complete',
      recommended_branch: 'persisted_recheck',
      recommended_next_commands: ['snapshot-quote', 'snapshot-lines', 'inspect-rlm-context']
    } satisfies MissingPriceRootCause);

    // case-insensitive
    expect(
      classifyMissingPriceRootCause({
        bundleInclusionFound: false,
        lifecycleProvenanceFound: false,
        calculationStatus: '  PENDING  '
      })
    ).toMatchObject({ likely_root_cause_class: 'calculation_not_complete' });
  });

  it('returns unexplained_missing_price when no other condition matches', () => {
    expect(
      classifyMissingPriceRootCause({
        bundleInclusionFound: false,
        lifecycleProvenanceFound: false,
        calculationStatus: null
      })
    ).toEqual({
      likely_root_cause_class: 'unexplained_missing_price',
      recommended_branch: 'context_bridge',
      recommended_next_commands: ['inspect-rlm-context', 'overlay-relationships', 'overlay-actions']
    } satisfies MissingPriceRootCause);

    // undefined calculationStatus also falls through
    expect(
      classifyMissingPriceRootCause({ bundleInclusionFound: false, lifecycleProvenanceFound: false })
    ).toMatchObject({ likely_root_cause_class: 'unexplained_missing_price' });
  });
});
