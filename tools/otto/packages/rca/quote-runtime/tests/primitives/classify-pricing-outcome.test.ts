import { describe, expect, it, vi } from 'vitest';

import {
  executeClassifyPricingOutcome,
  type ClassifyPricingOutcomePrimitiveResult
} from '../../src/primitives/classify-pricing-outcome';
import type { CapturePostPstEvidencePrimitiveResult } from '../../src/primitives/capture-post-pst-evidence';

function makeCaptureResult(
  overrides: Partial<CapturePostPstEvidencePrimitiveResult> = {}
): CapturePostPstEvidencePrimitiveResult {
  const base = {
    status: 'ok',
    result: {
      quote_snapshot: {
        Id: 'Q-001',
        Name: 'Quote 001',
        QuoteNumber: 'QT-001',
        Pricebook2Id: 'PB-1',
        Status: 'Draft',
        CalculationStatus: 'Complete',
        StartDate: '2026-04-21',
        ExpirationDate: null,
        Subtotal: 95,
        TotalPrice: 95,
        TotalTaxAmount: 0,
        TotalPriceWithTax: 95,
        GrandTotal: 95,
        LineItemCount: 1,
        OriginalActionType: null,
        CreatedDate: '2026-04-21T12:00:00.000Z',
        LastModifiedDate: '2026-04-21T12:05:00.000Z'
      },
      line_snapshots: [
        {
          Id: 'L-1',
          QuoteId: 'Q-001',
          LineNumber: 10,
          Product2Id: 'P-1',
          PricebookEntryId: 'PBE-1',
          ParentQuoteLineItemId: null,
          Quantity: 1,
          StartQuantity: 1,
          EndQuantity: 1,
          UnitPrice: 100,
          ListPrice: 100,
          NetUnitPrice: 95,
          NetTotalPrice: 95,
          Subtotal: 95,
          TotalPrice: 95,
          TotalLineAmount: 95,
          TotalAdjustmentAmount: 5,
          SellingModelType: 'OneTime',
          StartDate: '2026-04-21',
          EndDate: null,
          PriceWaterfallIdentifier: 'L-1:40944695130560',
          QuoteActionId: 'QA-1',
          'QuoteAction.Type': 'Amend',
          'QuoteAction.SourceAssetId': 'A-1',
          CreatedDate: '2026-04-21T12:00:00.000Z',
          LastModifiedDate: '2026-04-21T12:05:00.000Z'
        }
      ],
      line_evidence_packets: [
        {
          requested_line_id: 'L-1',
          resolved_line_id: 'L-1',
          capture_status: 'ok',
          line_snapshot: {
            Id: 'L-1',
            QuoteId: 'Q-001',
            LineNumber: 10,
            Product2Id: 'P-1',
            PricebookEntryId: 'PBE-1',
            ParentQuoteLineItemId: null,
            Quantity: 1,
            StartQuantity: 1,
            EndQuantity: 1,
            UnitPrice: 100,
            ListPrice: 100,
            NetUnitPrice: 95,
            NetTotalPrice: 95,
            Subtotal: 95,
            TotalPrice: 95,
            TotalLineAmount: 95,
            TotalAdjustmentAmount: 5,
            SellingModelType: 'OneTime',
            StartDate: '2026-04-21',
            EndDate: null,
            PriceWaterfallIdentifier: 'L-1:40944695130560',
            QuoteActionId: 'QA-1',
            'QuoteAction.Type': 'Amend',
            'QuoteAction.SourceAssetId': 'A-1',
            CreatedDate: '2026-04-21T12:00:00.000Z',
            LastModifiedDate: '2026-04-21T12:05:00.000Z'
          },
          trace_anchor: {
            price_waterfall_identifier: 'L-1:40944695130560',
            waterfall_line_item_id: 'L-1',
            pricing_execution_id: '40944695130560',
            shared_execution_key: 'shared-001'
          },
          execution_correlation: {
            pricing_process_execution: { Id: 'ppe-1' },
            pricing_api_execution: { Id: 'api-1' },
            api_execution_log: {
              fetch_status: 'ok',
              endpoint: '/services/data/v66.0/connect/core-pricing/apiexecutionlogs/api-type-001',
              api_execution_type_key: 'api-type-001',
              raw_payload: [{ procedureName: 'Default Pricing Procedure' }]
            },
            correlation_status: 'ok'
          },
          waterfall: {
            endpoint: '/services/data/v66.0/connect/core-pricing/waterfall/L-1/40944695130560',
            fetch_status: 'ok',
            summary: {
              element_count: 2,
              formula_count: 1,
              output_targets: ['Subtotal'],
              overwrite_candidates: ['Subtotal']
            },
            normalized_elements: [
              {
                sequence: 1,
                name: 'Formula Based Pricing',
                filter_rules: [],
                inputs: [],
                outputs: [{ target: 'Subtotal', value: 17 }],
                calculation_formula: '17',
                writes: ['Subtotal']
              },
              {
                sequence: 2,
                name: 'Finalize Totals',
                filter_rules: [],
                inputs: [],
                outputs: [{ target: 'Subtotal', value: 95 }],
                calculation_formula: null,
                writes: ['Subtotal']
              }
            ],
            raw_payload: { waterfallElements: [] }
          },
          artifact_statuses: {
            line_detail: 'not_requested',
            price_adjustments: 'not_requested',
            rate_card_entries: 'not_requested',
            rate_adjustments: 'not_requested',
            usage_grants: 'not_requested',
            usage_policies: 'not_requested'
          },
          warnings: []
        }
      ],
      optional_artifacts: {
        line_details: [],
        price_adjustments: [],
        rate_card_entries: [],
        rate_adjustments: [],
        usage_grants: [],
        usage_policies: []
      },
      counts: {
        requested_lines: 1,
        resolved_line_snapshots: 1,
        packets_total: 1,
        ok_packets: 1,
        partial_packets: 0,
        no_match_packets: 0,
        unsupported_packets: 0,
        error_packets: 0,
        line_details_returned: 0,
        price_adjustments_returned: 0,
        rate_card_entries_returned: 0,
        rate_adjustments_returned: 0,
        usage_grants_returned: 0,
        usage_policies_returned: 0
      },
      recommended_next_commands: ['inspect-pricing-waterfall']
    },
    warnings: [],
    errors: [],
    evidence: []
  } satisfies CapturePostPstEvidencePrimitiveResult;

  return {
    ...base,
    ...overrides,
    result: {
      ...base.result,
      ...(overrides.result ?? {})
    }
  };
}

describe('classify-pricing-outcome primitive', () => {
  it('classifies proven overwrite when a hinted target step is followed by a later same-family writer that matches persistence', async () => {
    const result = await executeClassifyPricingOutcome({
      orgAlias: 'ARM',
      quoteId: 'Q-001',
      lineIds: ['L-1'],
      expectedChange: 'final persisted total should reflect the formula step',
      metadataProofState: 'verified',
      outputFamilyHint: 'Subtotal',
      targetStepHint: 'Formula Based Pricing',
      executeCapturePostPstEvidence: vi.fn(async () => makeCaptureResult())
    });

    expect(result.status).toBe('ok');
    expect(result.result.outcome_class).toBe('landed_but_overwritten_before_persistence');
    expect(result.result.proof_status).toBe('proven');
    expect(result.result.recommended_next_action).toBe('retarget_downstream_writer');
    expect(result.result.line_classifications[0]).toMatchObject({
      outcome_class: 'landed_but_overwritten_before_persistence',
      proof_status: 'proven'
    });
  });

  it('classifies persisted usage rate-card artifacts as a usage output family', async () => {
    const capture = makeCaptureResult({
      result: {
        ...makeCaptureResult().result,
        line_evidence_packets: [{
          ...makeCaptureResult().result.line_evidence_packets[0],
          artifact_statuses: {
            line_detail: 'not_requested',
            price_adjustments: 'not_requested',
            rate_card_entries: 'ok',
            rate_adjustments: 'not_found',
            usage_grants: 'not_found',
            usage_policies: 'not_found'
          }
        }],
        optional_artifacts: {
          ...makeCaptureResult().result.optional_artifacts,
          rate_card_entries: [{
            Id: 'QLRCE-1',
            QuoteLineItemId: 'L-1',
            RateCardEntryId: 'RCE-1',
            RateCardId: 'RC-1',
            UsageResourceId: 'UR-1'
          }]
        },
        counts: {
          ...makeCaptureResult().result.counts,
          rate_card_entries_returned: 1
        }
      }
    });

    const result = await executeClassifyPricingOutcome({
      orgAlias: 'ARM',
      quoteId: 'Q-001',
      lineIds: ['L-1'],
      expectedChange: 'usage rate card should persist on quote line',
      metadataProofState: 'verified',
      outputFamilyHint: 'usage_rate_card_family',
      executeCapturePostPstEvidence: vi.fn(async () => capture)
    });

    expect(result.status).toBe('ok');
    expect(result.result.outcome_class).toBe('landed_and_survived');
    expect(result.result.output_family_under_test).toBe('usage_rate_card_family');
    expect(result.result.recommended_next_action).toBe('accept_success');
  });

  it('treats a visible target step with live discriminator outputs as reached runtime evidence and closes out as overwritten when a later family writer wins persistence', async () => {
    const capture = makeCaptureResult({
      result: {
        ...makeCaptureResult().result,
        line_evidence_packets: [{
          ...makeCaptureResult().result.line_evidence_packets[0],
          waterfall: {
            ...makeCaptureResult().result.line_evidence_packets[0].waterfall!,
            summary: {
              element_count: 2,
              formula_count: 1,
              output_targets: ['Output Variable', 'formula-section-0-output', 'Subtotal'],
              overwrite_candidates: ['Subtotal']
            },
            normalized_elements: [
              {
                sequence: 3,
                name: 'Formula Based Pricing',
                filter_rules: [],
                inputs: [],
                outputs: [
                  { target: 'formula-section-0-output', value: 15601 },
                  { target: 'Output Variable', value: 15601 }
                ],
                calculation_formula: 'InputUnitPrice * LineItemQuantity + 1',
                writes: ['formula-section-0-output', 'Output Variable']
              },
              {
                sequence: 8,
                name: 'Percentage-Based (Line-Level)',
                filter_rules: [],
                inputs: [],
                outputs: [{ target: 'Subtotal', value: 95 }],
                calculation_formula: null,
                writes: ['Subtotal']
              }
            ]
          }
        }]
      }
    });

    const result = await executeClassifyPricingOutcome({
      orgAlias: 'ARM',
      quoteId: 'Q-001',
      lineIds: ['L-1'],
      expectedChange: 'final persisted total should reflect the formula step',
      metadataProofState: 'verified',
      outputFamilyHint: 'Subtotal',
      targetStepHint: 'Formula Based Pricing',
      executeCapturePostPstEvidence: vi.fn(async () => capture)
    });

    expect(result.status).toBe('ok');
    expect(result.result.outcome_class).toBe('landed_but_overwritten_before_persistence');
    expect(result.result.proof_status).toBe('hypothesis_level');
    expect(result.result.recommended_next_action).toBe('retarget_downstream_writer');
    expect(result.result.line_classifications[0]).toMatchObject({
      outcome_class: 'landed_but_overwritten_before_persistence',
      proof_status: 'hypothesis_level',
      likely_target_writer: {
        name: 'Formula Based Pricing'
      },
      likely_winning_writer: {
        name: 'Percentage-Based (Line-Level)'
      }
    });
    expect(result.result.line_classifications[0]?.classification_basis.runtime_execution_summary).toEqual(
      expect.arrayContaining([
        expect.stringContaining("matched target-step hint 'Formula Based Pricing'")
      ])
    );
    expect(result.result.line_classifications[0]?.classification_basis.overwrite_summary).toEqual(
      expect.arrayContaining([
        expect.stringContaining('distinct runtime discriminator'),
        expect.stringContaining("Later same-family writer 'Percentage-Based (Line-Level)#8' ran after target step 'Formula Based Pricing#3'")
      ])
    );
  });

  it('classifies survivor when one same-family writer matches persistence and no later writer exists', async () => {
    const capture = makeCaptureResult({
      result: {
        ...makeCaptureResult().result,
        line_evidence_packets: [{
          ...makeCaptureResult().result.line_evidence_packets[0],
          waterfall: {
            ...makeCaptureResult().result.line_evidence_packets[0].waterfall!,
            summary: {
              element_count: 1,
              formula_count: 1,
              output_targets: ['Subtotal'],
              overwrite_candidates: []
            },
            normalized_elements: [
              {
                sequence: 1,
                name: 'Formula Based Pricing',
                filter_rules: [],
                inputs: [],
                outputs: [{ target: 'Subtotal', value: 95 }],
                calculation_formula: '95',
                writes: ['Subtotal']
              }
            ]
          }
        }]
      }
    });

    const result = await executeClassifyPricingOutcome({
      orgAlias: 'ARM',
      quoteId: 'Q-001',
      lineIds: ['L-1'],
      expectedChange: 'final persisted total should be 95',
      metadataProofState: 'verified',
      outputFamilyHint: 'Subtotal',
      executeCapturePostPstEvidence: vi.fn(async () => capture)
    });

    expect(result.result.outcome_class).toBe('landed_and_survived');
    expect(result.result.proof_status).toBe('proven');
    expect(result.result.recommended_next_action).toBe('accept_success');
  });

  it('classifies not reached when the target-step hint does not appear in the runtime family writers', async () => {
    const result = await executeClassifyPricingOutcome({
      orgAlias: 'ARM',
      quoteId: 'Q-001',
      lineIds: ['L-1'],
      expectedChange: 'formula should fire',
      metadataProofState: 'verified',
      outputFamilyHint: 'Subtotal',
      targetStepHint: 'Missing Step',
      executeCapturePostPstEvidence: vi.fn(async () => makeCaptureResult())
    });

    expect(result.result.outcome_class).toBe('landed_but_not_reached_at_runtime');
    expect(result.result.proof_status).toBe('proven');
    expect(result.result.recommended_next_action).toBe('investigate_runtime_path');
  });

  it('classifies ambiguity when multiple same-family writers exist and the operator did not isolate intent', async () => {
    const result = await executeClassifyPricingOutcome({
      orgAlias: 'ARM',
      quoteId: 'Q-001',
      lineIds: ['L-1'],
      expectedChange: 'line total should change somehow',
      outputFamilyHint: 'Subtotal',
      executeCapturePostPstEvidence: vi.fn(async () => makeCaptureResult())
    });

    expect(result.result.outcome_class).toBe('runtime_effect_ambiguous_needs_user_intent');
    expect(result.result.proof_status).toBe('proven');
    expect(result.result.recommended_next_action).toBe('ask_user_to_clarify_intent');
  });

  it('classifies evidence gaps without changing transport status', async () => {
    const capture = makeCaptureResult({
      status: 'partial',
      result: {
        ...makeCaptureResult().result,
        line_evidence_packets: [{
          ...makeCaptureResult().result.line_evidence_packets[0],
          capture_status: 'partial',
          waterfall: null,
          execution_correlation: null
        }],
        counts: {
          ...makeCaptureResult().result.counts,
          ok_packets: 0,
          partial_packets: 1
        }
      },
      warnings: ['Waterfall capture stayed partial.']
    });

    const result = await executeClassifyPricingOutcome({
      orgAlias: 'ARM',
      quoteId: 'Q-001',
      lineIds: ['L-1'],
      expectedChange: 'line total should change somehow',
      executeCapturePostPstEvidence: vi.fn(async () => capture)
    });

    expect(result.status).toBe('partial');
    expect(result.result.outcome_class).toBe('blocked_by_tooling_or_evidence_gap');
    expect(result.result.proof_status).toBe('proven');
    expect(result.result.line_classifications[0].transport_capture_status).toBe('partial');
  });
});
