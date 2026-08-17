/**
 * Tests for src/routing/selector-functions.ts
 *
 * Replaces tests/routing/route-logic.test.ts (plan 022 Q4).
 *
 * Changes from the old test file:
 *   - COMMAND_OWNERSHIP_MAP / COMMAND_SELECTOR_POLICY_MAP: static-map equality
 *     tests removed — maps are now derived from ALL_COMMAND_SPECS so testing
 *     against a hardcoded copy has no value.  Structural coverage retained via
 *     getOwnershipMap() / getSelectorPolicyMap().
 *   - Symptom routing tests moved to tests/primitives/symptom-routing.test.ts.
 *   - Missing-price root-cause tests in tests/primitives/missing-price-root-cause.test.ts.
 */

import { describe, expect, it } from 'vitest';

import { ALL_COMMAND_NAMES, normalizeSelectors } from '../../src';
import {
  ROUTE_LOGIC_COMMANDS,
  formatCommandReadinessIssues,
  getCommandOwnership,
  getCommandReadinessIssuesForCommand,
  getCommandSelectorPolicy,
  getDoctorNextSuggestedCommand,
  getDoctorRecommendedNextCommands,
  getMissingRequiredSelectorsForCommand,
  getOwnershipMap,
  getSelectorPolicyMap,
  type CommandOwnership,
  type CommandSelectorPolicy
} from '../../src/routing/selector-functions';

describe('selector-functions (plan 022 Q4)', () => {
  it('ROUTE_LOGIC_COMMANDS equals ALL_COMMAND_NAMES', () => {
    expect(ROUTE_LOGIC_COMMANDS).toEqual(ALL_COMMAND_NAMES);
  });

  it('derived maps cover every command name', () => {
    const ownershipKeys = Object.keys(getOwnershipMap());
    const selectorKeys = Object.keys(getSelectorPolicyMap());
    expect(ownershipKeys).toEqual([...ALL_COMMAND_NAMES]);
    expect(selectorKeys).toEqual([...ALL_COMMAND_NAMES]);
  });

  it('derived maps are consistent with ALL_COMMAND_SPECS data (sampled spot-check)', () => {
    const om = getOwnershipMap();
    const sp = getSelectorPolicyMap();

    // spot-check a few ownership entries
    expect(om['doctor']).toMatchObject({
      primary_owner: 'quote-runtime-mutations'
    } satisfies Partial<CommandOwnership>);

    expect(om['inspect-rlm-context']).toMatchObject({
      primary_owner: 'runtime-context-inspection'
    } satisfies Partial<CommandOwnership>);

    // spot-check selector policies
    expect(sp['doctor']).toEqual({
      required_selectors: [],
      recommended_selectors: [],
      status_reason: 'Doctor can run with only org alias and optional command-specific selectors.'
    } satisfies CommandSelectorPolicy);

    expect(sp['snapshot-lines']).toEqual({
      required_selectors: ['quote_id'],
      recommended_selectors: ['line_ids'],
      status_reason: 'Line snapshots require a quote id; line ids are optional narrowing only.'
    } satisfies CommandSelectorPolicy);
  });

  it('provides shared command selector policy for doctor preflight', () => {
    expect(getCommandSelectorPolicy('doctor')).toEqual({
      required_selectors: [],
      recommended_selectors: [],
      status_reason: 'Doctor can run with only org alias and optional command-specific selectors.'
    } satisfies CommandSelectorPolicy);

    expect(getCommandSelectorPolicy('snapshot-lines')).toEqual({
      required_selectors: ['quote_id'],
      recommended_selectors: ['line_ids'],
      status_reason: 'Line snapshots require a quote id; line ids are optional narrowing only.'
    } satisfies CommandSelectorPolicy);

    expect(getCommandSelectorPolicy('inspect-pricing-waterfall')).toEqual({
      required_selectors: ['quote_id', 'line_ids'],
      recommended_selectors: [],
      selector_constraints: [
        {
          key: 'line_ids_exactly_one',
          selector: 'line_ids',
          kind: 'exactly_one',
          message: 'Provide exactly one unique --line-id <id> in V1.'
        }
      ],
      status_reason: 'Pricing-waterfall inspection requires a quote id and exactly one target line id in V1.'
    } satisfies CommandSelectorPolicy);

    expect(getCommandSelectorPolicy('capture-post-pst-evidence')).toEqual({
      required_selectors: ['quote_id', 'line_ids'],
      recommended_selectors: [],
      status_reason: 'Post-PST evidence capture requires a quote id and at least one target line id.'
    } satisfies CommandSelectorPolicy);

    expect(getCommandSelectorPolicy('classify-pricing-outcome')).toEqual({
      required_selectors: ['quote_id', 'line_ids', 'expected_change'],
      recommended_selectors: [],
      status_reason: 'Outcome classification requires a quote id, at least one target line id, and the requested business effect.'
    } satisfies CommandSelectorPolicy);

    expect(getCommandSelectorPolicy('create-quote')).toEqual({
      required_selectors: [],
      recommended_selectors: [],
      status_reason: 'Quote creation requires metadata-gated quote fields, including Quote.Name and org-specific relationship fields.'
    } satisfies CommandSelectorPolicy);

    expect(getCommandSelectorPolicy('upsert-quote-lines')).toEqual({
      required_selectors: ['quote_id'],
      recommended_selectors: ['line_ids'],
      status_reason: 'Quote line POST/PATCH requires a target quote id; line ids switch the command from POST to PATCH.'
    } satisfies CommandSelectorPolicy);

    expect(getCommandSelectorPolicy('price-quote')).toEqual({
      required_selectors: ['quote_id'],
      recommended_selectors: ['line_ids'],
      status_reason: 'Pricing execution requires a target quote id and optional line ids for scoped PATCH payloads.'
    } satisfies CommandSelectorPolicy);

    expect(getCommandSelectorPolicy('build-test-quote')).toEqual({
      required_selectors: [],
      recommended_selectors: [],
      status_reason: 'Build-test-quote reads selectors from a structured quote_intent input payload.'
    } satisfies CommandSelectorPolicy);
  });

  it('computes missing required selectors from the shared policy table', () => {
    expect(getMissingRequiredSelectorsForCommand('compare-quote-pricing', normalizeSelectors({}))).toEqual([
      'before_quote_id',
      'after_quote_id'
    ]);

    expect(getMissingRequiredSelectorsForCommand('capture-post-pst-evidence', normalizeSelectors({ quote_id: 'Q-001' }))).toEqual([
      'line_ids'
    ]);
    expect(getMissingRequiredSelectorsForCommand('classify-pricing-outcome', normalizeSelectors({ quote_id: 'Q-001', line_id: ['L-1'] }))).toEqual([
      'expected_change'
    ]);

    expect(
      getMissingRequiredSelectorsForCommand(
        'test-pricing-change',
        normalizeSelectors({ quote_id: 'Q-001', changed_artifact: 'Price Rule' })
      )
    ).toEqual([]);
  });

  it('only suggests the target command when doctor preflight requirements are satisfied', () => {
    expect(getDoctorRecommendedNextCommands('snapshot-quote', normalizeSelectors({}))).toEqual([]);
    expect(getDoctorNextSuggestedCommand('snapshot-quote', normalizeSelectors({}))).toBeNull();

    const readySelectors = normalizeSelectors({ quote_id: 'Q-001' });

    expect(getDoctorRecommendedNextCommands('snapshot-quote', readySelectors)).toEqual(['snapshot-quote']);
    expect(getDoctorNextSuggestedCommand('snapshot-quote', readySelectors)).toBe('snapshot-quote');

    const overScopedWaterfallSelectors = normalizeSelectors({ quote_id: 'Q-001', line_id: ['L-1', 'L-2'] });

    expect(getDoctorRecommendedNextCommands('inspect-pricing-waterfall', overScopedWaterfallSelectors)).toEqual([]);
    expect(getDoctorNextSuggestedCommand('inspect-pricing-waterfall', overScopedWaterfallSelectors)).toBeNull();
    expect(getDoctorRecommendedNextCommands('capture-post-pst-evidence', overScopedWaterfallSelectors)).toEqual(['capture-post-pst-evidence']);
    expect(getDoctorRecommendedNextCommands('classify-pricing-outcome', overScopedWaterfallSelectors)).toEqual([]);
  });

  it('reports shared readiness issues for exact-one waterfall line selection', () => {
    const missingSelectors = normalizeSelectors({ quote_id: 'Q-001' });
    const overScopedSelectors = normalizeSelectors({ quote_id: 'Q-001', line_id: ['L-1', 'L-2'] });
    const readySelectors = normalizeSelectors({ quote_id: 'Q-001', line_id: ['L-1', 'L-1'] });

    expect(getCommandReadinessIssuesForCommand('inspect-pricing-waterfall', missingSelectors)).toEqual([
      { key: 'line_ids', message: 'Provide at least one --line-id <id>.' },
      { key: 'line_ids_exactly_one', message: 'Provide exactly one unique --line-id <id> in V1.' }
    ]);
    expect(getCommandReadinessIssuesForCommand('capture-post-pst-evidence', missingSelectors)).toEqual([
      { key: 'line_ids', message: 'Provide at least one --line-id <id>.' }
    ]);
    expect(getCommandReadinessIssuesForCommand('classify-pricing-outcome', missingSelectors)).toEqual([
      { key: 'line_ids', message: 'Provide at least one --line-id <id>.' },
      { key: 'expected_change', message: 'Provide --expected-change <text>.' }
    ]);
    expect(getCommandReadinessIssuesForCommand('inspect-pricing-waterfall', overScopedSelectors)).toEqual([
      { key: 'line_ids_exactly_one', message: 'Provide exactly one unique --line-id <id> in V1.' }
    ]);
    expect(getCommandReadinessIssuesForCommand('inspect-pricing-waterfall', readySelectors)).toEqual([]);
    expect(
      formatCommandReadinessIssues(
        'inspect-pricing-waterfall',
        getCommandReadinessIssuesForCommand('inspect-pricing-waterfall', overScopedSelectors)
      )
    ).toBe('inspect-pricing-waterfall readiness check failed: Provide exactly one unique --line-id <id> in V1.');
  });

  it('returns the shared ownership entry for a target command', () => {
    expect(getCommandOwnership('capture-post-pst-evidence')).toEqual({
      primary_owner: 'pricing-runtime-debug',
      secondary_escalation: ['runtime-context-inspection', 'config-runtime-bridge'],
      shared_library_dependencies: ['snapshot_quote', 'snapshot_lines', 'selectors', 'evidence']
    } satisfies CommandOwnership);
    expect(getCommandOwnership('classify-pricing-outcome')).toEqual({
      primary_owner: 'pricing-runtime-debug',
      secondary_escalation: ['runtime-context-inspection', 'config-runtime-bridge'],
      shared_library_dependencies: ['snapshot_quote', 'snapshot_lines', 'selectors', 'evidence']
    } satisfies CommandOwnership);
  });
});
