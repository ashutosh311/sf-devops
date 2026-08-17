import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

import { QUOTE_LINE_ITEM_SNAPSHOT_FIELDS, QUOTE_SNAPSHOT_FIELDS } from '../../src/contracts/query-fields';
import { executePstPlan, mapPstPlanFailureStatus } from '../../src/primitives/pst-plan';

const fixturesDir = resolve(import.meta.dirname, '../fixtures/primitives/pst-plan');
const pstPlacePlanFixture = JSON.parse(
  readFileSync(resolve(fixturesDir, 'pst-place-plan.json'), 'utf8')
) as Record<string, unknown>;

describe('pst-plan primitive', () => {
  it('returns the locked plan_only routing and capture guidance without execution semantics', async () => {
    const result = await executePstPlan({
      operationFamily: 'pst_place',
      quoteId: '0Q0xx0000000001AAA',
      lineIds: ['0QLxx0000000001AAA'],
      expectedChange: 'reprice the targeted line'
    });

    expect(result.status).toBe('ok');
    expect(result.warnings).toEqual([]);
    expect(result.errors).toEqual([]);
    expect(result.result).toEqual(pstPlacePlanFixture);
    expect(result.result.mode).toBe('plan_only');
    expect(result.result.payload_summary.execution_requested).toBe(false);
    expect(result.result.before_capture_plan.required_reads[0]?.field_set).toEqual([...QUOTE_SNAPSHOT_FIELDS]);
    expect(result.result.after_capture_plan.required_reads[1]?.field_set).toEqual([...QUOTE_LINE_ITEM_SNAPSHOT_FIELDS]);
    expect(result.result.verification_branch_hints.map((hint) => hint.recommended_command)).toEqual([
      'snapshot-lines',
      'inspect-pricing-waterfall',
      'overlay-actions',
      'overlay-relationships',
      'inspect-rlm-context'
    ]);
    expect(result.evidence[0]).toMatchObject({
      evidence_level: 'repo_proven',
      limitations: expect.stringContaining('plan_only')
    });
  });

  it('returns warn guidance when the plan remains broad but still never executes', async () => {
    const pstPlaceWithoutQuote = await executePstPlan({
      operationFamily: 'pst_place'
    });
    expect(pstPlaceWithoutQuote.status).toBe('warn');
    expect(pstPlaceWithoutQuote.result.mode).toBe('plan_only');
    expect(pstPlaceWithoutQuote.result.payload_summary.execution_requested).toBe(false);
    expect(pstPlaceWithoutQuote.warnings).toEqual([
      'pst_place planning is strongest with a target quote id because same-quote verification is the default anchor.'
    ]);
    expect(pstPlaceWithoutQuote.result.before_capture_plan.required_reads[0]).toMatchObject({
      surface: 'Quote',
      required: false,
      selectors: { quote_id: null }
    });

    const lifecycleWithoutAnchors = await executePstPlan({
      operationFamily: 'initiate_amendment'
    });
    expect(lifecycleWithoutAnchors.status).toBe('warn');
    expect(lifecycleWithoutAnchors.warnings).toEqual([
      'Lifecycle setup planning is broader without a source quote id or asset id anchor.'
    ]);

    const assetAddWithoutAssets = await executePstPlan({
      operationFamily: 'asset_add_to_renewal',
      quoteId: '0Q0xx0000000001AAA'
    });
    expect(assetAddWithoutAssets.status).toBe('warn');
    expect(assetAddWithoutAssets.warnings).toEqual([
      'asset_add_to_renewal planning is broader without asset ids, which are usually the primary durable handles.'
    ]);
  });

  it('locks the primitive-wide sf failure classification mapping rules for future integrations', () => {
    expect(mapPstPlanFailureStatus('auth')).toBe('unsupported');
    expect(mapPstPlanFailureStatus('unavailable')).toBe('unsupported');
    expect(mapPstPlanFailureStatus('internal_cli_error')).toBe('unsupported');
    expect(mapPstPlanFailureStatus('timeout')).toBe('error');
    expect(mapPstPlanFailureStatus('non_json_error')).toBe('error');
    expect(mapPstPlanFailureStatus('cli_error')).toBe('error');
  });
});
