import { describe, expect, it, vi } from 'vitest';

import {
  executeCapturePostPstEvidence,
  type CapturePostPstEvidencePrimitiveResult
} from '../../src/primitives/capture-post-pst-evidence';
import type { QuoteLineArtifactResult } from '../../src/integrations/salesforce/quote-line-artifacts';
import type {
  ExecuteInspectPricingWaterfallInput,
  InspectPricingWaterfallPrimitiveResult
} from '../../src/primitives/inspect-pricing-waterfall';
import type { SnapshotLineRecord } from '../../src/primitives/snapshot-lines';
import type { SnapshotQuotePrimitiveResult } from '../../src/primitives/snapshot-quote';

function makeQuoteSnapshotResult(status: SnapshotQuotePrimitiveResult['status'] = 'ok'): SnapshotQuotePrimitiveResult {
  return {
    status,
    result: {
      quote: status === 'ok'
        ? {
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
            LineItemCount: 2,
            OriginalActionType: null,
            CreatedDate: '2026-04-21T12:00:00.000Z',
            LastModifiedDate: '2026-04-21T12:05:00.000Z'
          }
        : null,
      field_set: [],
      snapshot_type: 'quote'
    },
    warnings: [],
    errors: status === 'error' ? ['quote lookup failed'] : [],
    evidence: [],
    query: 'SELECT ... FROM Quote'
  };
}

function makeLineRecord(id: string, identifier = `${id}:40944695130560`): SnapshotLineRecord {
  return {
    Id: id,
    QuoteId: 'Q-001',
    LineNumber: id === 'L-1' ? 10 : 20,
    Product2Id: `P-${id}`,
    PricebookEntryId: `PBE-${id}`,
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
    PriceWaterfallIdentifier: identifier,
    QuoteActionId: `QA-${id}`,
    'QuoteAction.Type': 'Amend',
    'QuoteAction.SourceAssetId': `A-${id}`,
    CreatedDate: '2026-04-21T12:00:00.000Z',
    LastModifiedDate: '2026-04-21T12:05:00.000Z'
  };
}

function makeInspectResult(
  lineId: string,
  status: InspectPricingWaterfallPrimitiveResult['status'] = 'ok'
): InspectPricingWaterfallPrimitiveResult {
  return {
    status,
    result: {
      selector_resolution: {
        quote_id: 'Q-001',
        requested_line_id: lineId,
        resolved_line_id: lineId,
        price_waterfall_identifier: `${lineId}:40944695130560`,
        waterfall_line_item_id: lineId,
        pricing_execution_id: '40944695130560',
        resolution_mode: 'persisted_price_waterfall_identifier'
      },
      persisted_anchor: null,
      correlation: {
        pricing_process_execution: {
          query_status: 'ok',
          execution_type_key: '40944695130560',
          execution_key: 'shared-001',
          record_count: 1,
          records: [{ Id: 'ppe-1' }]
        },
        pricing_line_execution: {
          query_status: 'ok',
          execution_type_key: `40944695130560_${lineId}`,
          execution_key: 'shared-001',
          record_count: 1,
          records: [{ Id: 'ppe-line-1' }]
        },
        pricing_process_family: {
          fetch_status: 'ok',
          path: '/services/data/v66.0/connect/core-pricing/pricing-process-execution/shared-001',
          execution_key: 'shared-001',
          execution_types_present: ['Pricing', 'Pricing_Line'],
          line_membership_confirmed: true,
          raw_payload: { executionId: 'shared-001' }
        },
        pricing_api_execution: {
          query_status: 'ok',
          execution_key: 'shared-001',
          record_count: 1,
          records: [{ Id: 'api-1' }]
        },
        api_execution_log: {
          fetch_status: 'ok',
          endpoint: '/services/data/v66.0/connect/core-pricing/apiexecutionlogs/api-type-001',
          api_execution_type_key: 'api-type-001',
          raw_payload: [{ procedureName: 'Default Pricing Procedure' }]
        },
        shared_execution_key: 'shared-001',
        execution_types_present: ['Pricing', 'Pricing_Line'],
        line_membership_confirmed: status === 'partial' ? null : true
      },
      waterfall: {
        endpoint: `/services/data/v66.0/connect/core-pricing/waterfall/${lineId}/40944695130560`,
        fetch_status: status === 'unsupported' ? 'unsupported' : status === 'error' ? 'error' : 'ok',
        summary: {
          element_count: status === 'error' ? 0 : 2,
          formula_count: status === 'error' ? 0 : 1,
          output_targets: status === 'error' ? [] : ['Subtotal'],
          overwrite_candidates: []
        },
        normalized_elements: [],
        raw_payload: status === 'error' ? null : { waterfallElements: [] }
      },
      recommended_next_commands: status === 'ok' ? ['inspect-rlm-context'] : ['inspect-pricing-waterfall']
    },
    warnings: status === 'partial' ? [`Correlation stayed partial for ${lineId}.`] : [],
    errors: status === 'error' ? [`Waterfall lookup failed for ${lineId}.`] : [],
    evidence: []
  };
}

function makeArtifactOk<T extends Record<string, string | number | null>>(record: T): QuoteLineArtifactResult<T> {
  return {
    ok: true,
    classification: 'ok',
    query: 'SELECT ...',
    data: [record]
  };
}

function makeArtifactNotFound<T extends Record<string, string | number | null>>(): QuoteLineArtifactResult<T> {
  return {
    ok: true,
    classification: 'ok',
    query: 'SELECT ...',
    data: []
  };
}

function makeArtifactUnsupported<T extends Record<string, string | number | null>>(message: string): QuoteLineArtifactResult<T> {
  return {
    ok: false,
    classification: 'cli_error',
    query: 'SELECT ...',
    message
  };
}

describe('capture-post-pst-evidence primitive', () => {
  it('returns ok when quote, lines, mandatory proof layers, and optional artifacts succeed', async () => {
    const result = await executeCapturePostPstEvidence({
      orgAlias: 'ARM',
      quoteId: 'Q-001',
      lineIds: ['L-1', 'L-1', 'L-2'],
      includeAdjustments: true,
      includeLineDetail: true,
      executeSnapshotQuote: vi.fn(async () => makeQuoteSnapshotResult('ok')),
      executeSnapshotLines: vi.fn(async () => ({
        status: 'ok',
        result: {
          quote_id: 'Q-001',
          lines: [makeLineRecord('L-1'), makeLineRecord('L-2')],
          field_set: [],
          counts: { returned: 2, requested: 2, available_on_quote: 2, missing: 0 },
          selection: {
            mode: 'line_id_filter',
            requested_line_ids: ['L-1', 'L-2'],
            missing_line_ids: []
          }
        },
        warnings: [],
        errors: [],
        evidence: [],
        query: 'SELECT ... FROM QuoteLineItem'
      })),
      executeInspectPricingWaterfall: vi.fn(async ({ lineIds }) => makeInspectResult(lineIds[0] ?? 'missing')),
      fetchQuoteLineDetailByLineId: vi.fn(async ({ lineId }) =>
        makeArtifactOk({
          Id: `QLD-${lineId}`,
          QuoteLineItemId: lineId,
          PriceWaterfallIdentifier: `${lineId}:40944695130560`,
          UnitPrice: 100,
          NetUnitPrice: 95,
          TotalPrice: 95,
          TotalLineAmount: 95,
          EffectiveFrom: '2026-04-21',
          EffectiveTo: null,
          ReferenceNumber: `REF-${lineId}`,
          ReferenceDate: '2026-04-21'
        })
      ),
      fetchQuoteLinePriceAdjustmentsByLineId: vi.fn(async ({ lineId }) =>
        makeArtifactOk({
          Id: `QLPA-${lineId}`,
          QuoteLineItemId: lineId,
          AdjustmentSource: 'Rule',
          AdjustmentType: 'Amount',
          AdjustmentValue: 5,
          TotalAmount: 5,
          Description: `Adjustment ${lineId}`,
          Priority: 1,
          PriceAdjustmentCauseId: `PAC-${lineId}`
        })
      )
    });

    expect(result.status).toBe('ok');
    expect(result.result.line_snapshots.map((line) => line.Id)).toEqual(['L-1', 'L-2']);
    expect(result.result.line_evidence_packets.map((packet) => packet.capture_status)).toEqual(['ok', 'ok']);
    expect(result.result.line_evidence_packets.map((packet) => packet.artifact_statuses)).toEqual([
      { line_detail: 'ok', price_adjustments: 'ok', rate_card_entries: 'not_requested', rate_adjustments: 'not_requested', usage_grants: 'not_requested', usage_policies: 'not_requested' },
      { line_detail: 'ok', price_adjustments: 'ok', rate_card_entries: 'not_requested', rate_adjustments: 'not_requested', usage_grants: 'not_requested', usage_policies: 'not_requested' }
    ]);
    expect(result.result.counts).toMatchObject({
      requested_lines: 2,
      resolved_line_snapshots: 2,
      ok_packets: 2,
      partial_packets: 0,
      no_match_packets: 0,
      error_packets: 0,
      line_details_returned: 2,
      price_adjustments_returned: 2
    });
    expect(result.result.optional_artifacts.line_details).toHaveLength(2);
    expect(result.result.optional_artifacts.price_adjustments).toHaveLength(2);
    expect(result.result.recommended_next_commands).toEqual(['inspect-rlm-context']);
  });

  it('returns no_match when the quote resolves but none of the requested lines resolve', async () => {
    const result = await executeCapturePostPstEvidence({
      orgAlias: 'ARM',
      quoteId: 'Q-001',
      lineIds: ['L-1'],
      includeAdjustments: true,
      includeLineDetail: true,
      executeSnapshotQuote: vi.fn(async () => makeQuoteSnapshotResult('ok')),
      executeSnapshotLines: vi.fn(async () => ({
        status: 'no_match',
        result: {
          quote_id: 'Q-001',
          lines: [],
          field_set: [],
          counts: { returned: 0, requested: 1, available_on_quote: 2, missing: 1 },
          selection: {
            mode: 'line_id_filter',
            requested_line_ids: ['L-1'],
            missing_line_ids: ['L-1']
          }
        },
        warnings: ["Requested line ids not found on quote 'Q-001': L-1."],
        errors: [],
        evidence: [],
        query: 'SELECT ... FROM QuoteLineItem'
      })),
      executeInspectPricingWaterfall: vi.fn(),
      fetchQuoteLineDetailByLineId: vi.fn(),
      fetchQuoteLinePriceAdjustmentsByLineId: vi.fn()
    });

    expect(result.status).toBe('no_match');
    expect(result.result.line_evidence_packets).toEqual([
      expect.objectContaining({
        requested_line_id: 'L-1',
        resolved_line_id: null,
        capture_status: 'no_match',
        artifact_statuses: { line_detail: 'not_found', price_adjustments: 'not_found', rate_card_entries: 'not_requested', rate_adjustments: 'not_requested', usage_grants: 'not_requested', usage_policies: 'not_requested' }
      })
    ]);
    expect(result.warnings.join(' ')).toContain('optional artifact status is recorded as not_found');
    expect(result.result.recommended_next_commands).toEqual(['snapshot-lines', 'doctor']);
  });

  it('keeps command status ok when optional artifacts are cleanly absent', async () => {
    const result = await executeCapturePostPstEvidence({
      orgAlias: 'ARM',
      quoteId: 'Q-001',
      lineIds: ['L-1'],
      includeAdjustments: true,
      includeLineDetail: true,
      executeSnapshotQuote: vi.fn(async () => makeQuoteSnapshotResult('ok')),
      executeSnapshotLines: vi.fn(async () => ({
        status: 'ok',
        result: {
          quote_id: 'Q-001',
          lines: [makeLineRecord('L-1')],
          field_set: [],
          counts: { returned: 1, requested: 1, available_on_quote: 1, missing: 0 },
          selection: {
            mode: 'line_id_filter',
            requested_line_ids: ['L-1'],
            missing_line_ids: []
          }
        },
        warnings: [],
        errors: [],
        evidence: [],
        query: 'SELECT ... FROM QuoteLineItem'
      })),
      executeInspectPricingWaterfall: vi.fn(async () => makeInspectResult('L-1', 'ok')),
      fetchQuoteLineDetailByLineId: vi.fn(async () => makeArtifactNotFound()),
      fetchQuoteLinePriceAdjustmentsByLineId: vi.fn(async () => makeArtifactNotFound())
    });

    expect(result.status).toBe('ok');
    expect(result.result.line_evidence_packets[0]?.artifact_statuses).toEqual({
      line_detail: 'not_found',
      price_adjustments: 'not_found',
      rate_card_entries: 'not_requested',
      rate_adjustments: 'not_requested',
      usage_grants: 'not_requested',
      usage_policies: 'not_requested'
    });
    expect(result.result.optional_artifacts).toEqual({ line_details: [], price_adjustments: [], rate_card_entries: [], rate_adjustments: [], usage_grants: [], usage_policies: [] });
    expect(result.result.counts).toMatchObject({
      ok_packets: 1,
      partial_packets: 0,
      line_details_returned: 0,
      price_adjustments_returned: 0
    });
    expect(result.warnings.join(' ')).toContain('no rows were returned');
  });

  it('captures quote-side usage and rate artifacts when requested', async () => {
    const result = await executeCapturePostPstEvidence({
      orgAlias: 'ARM',
      quoteId: 'Q-001',
      lineIds: ['L-1'],
      includeUsageRating: true,
      executeSnapshotQuote: vi.fn(async () => makeQuoteSnapshotResult('ok')),
      executeSnapshotLines: vi.fn(async () => ({
        status: 'ok',
        result: {
          quote_id: 'Q-001',
          lines: [makeLineRecord('L-1')],
          field_set: [],
          counts: { returned: 1, requested: 1, available_on_quote: 1, missing: 0 },
          selection: {
            mode: 'line_id_filter',
            requested_line_ids: ['L-1'],
            missing_line_ids: []
          }
        },
        warnings: [],
        errors: [],
        evidence: [],
        query: 'SELECT ... FROM QuoteLineItem'
      })),
      executeInspectPricingWaterfall: vi.fn(async () => makeInspectResult('L-1', 'ok')),
      fetchQuoteLineRateCardEntriesByLineId: vi.fn(async ({ lineId }) =>
        makeArtifactOk({
          Id: `QLRCE-${lineId}`,
          QuoteLineItemId: lineId,
          RateCardEntryId: `RCE-${lineId}`,
          RateCardId: `RC-${lineId}`,
          UsageResourceId: `UR-${lineId}`
        })
      ),
      fetchQuoteLineRateAdjustmentsByRateCardEntryIds: vi.fn(async ({ quoteLineRateCardEntryIds }) =>
        makeArtifactOk({
          Id: 'QLRA-1',
          QuoteLineRateCardEntryId: quoteLineRateCardEntryIds[0] ?? 'QLRCE-L-1',
          AdjustmentType: 'Override',
          AdjustmentValue: 1.25,
          LowerBound: 0,
          UpperBound: null,
          Name: 'Usage tier'
        })
      ),
      fetchQuoteLineUsageResourceGrantsByLineId: vi.fn(async ({ lineId }) =>
        makeArtifactOk({
          Id: `QLURG-${lineId}`,
          QuoteLineItemId: lineId,
          UsageResourceId: `UR-${lineId}`,
          TokenResourceId: `TR-${lineId}`
        })
      ),
      fetchQuoteLineUsageResourcePoliciesByLineId: vi.fn(async ({ lineId }) =>
        makeArtifactOk({
          Id: `QLURP-${lineId}`,
          QuoteLineItemId: lineId,
          UsageResourceId: `UR-${lineId}`
        })
      )
    });

    expect(result.status).toBe('ok');
    expect(result.result.line_evidence_packets[0]?.artifact_statuses).toMatchObject({
      rate_card_entries: 'ok',
      rate_adjustments: 'ok',
      usage_grants: 'ok',
      usage_policies: 'ok'
    });
    expect(result.result.counts).toMatchObject({
      rate_card_entries_returned: 1,
      rate_adjustments_returned: 1,
      usage_grants_returned: 1,
      usage_policies_returned: 1
    });
    expect(result.result.optional_artifacts.rate_card_entries).toHaveLength(1);
    expect(result.result.optional_artifacts.rate_adjustments).toHaveLength(1);
    expect(result.result.optional_artifacts.usage_grants).toHaveLength(1);
    expect(result.result.optional_artifacts.usage_policies).toHaveLength(1);
  });

  it('records unsupported optional artifact reads without changing mandatory packet completeness', async () => {
    const result = await executeCapturePostPstEvidence({
      orgAlias: 'ARM',
      quoteId: 'Q-001',
      lineIds: ['L-1', 'L-2'],
      includeAdjustments: true,
      includeLineDetail: true,
      executeSnapshotQuote: vi.fn(async () => makeQuoteSnapshotResult('ok')),
      executeSnapshotLines: vi.fn(async () => ({
        status: 'partial',
        result: {
          quote_id: 'Q-001',
          lines: [makeLineRecord('L-1')],
          field_set: [],
          counts: { returned: 1, requested: 2, available_on_quote: 1, missing: 1 },
          selection: {
            mode: 'line_id_filter',
            requested_line_ids: ['L-1', 'L-2'],
            missing_line_ids: ['L-2']
          }
        },
        warnings: ["Requested line ids not found on quote 'Q-001': L-2."],
        errors: [],
        evidence: [],
        query: 'SELECT ... FROM QuoteLineItem'
      })),
      executeInspectPricingWaterfall: vi.fn(async ({ lineIds }) => makeInspectResult(lineIds[0] ?? 'missing', 'partial')),
      fetchQuoteLineDetailByLineId: vi.fn(async () => makeArtifactUnsupported('INVALID_TYPE: sObject type QuoteLineDetail is not supported.')),
      fetchQuoteLinePriceAdjustmentsByLineId: vi.fn(async () => makeArtifactNotFound())
    });

    expect(result.status).toBe('partial');
    expect(result.result.line_evidence_packets).toEqual([
      expect.objectContaining({
        requested_line_id: 'L-1',
        capture_status: 'partial',
        artifact_statuses: { line_detail: 'unsupported', price_adjustments: 'not_found', rate_card_entries: 'not_requested', rate_adjustments: 'not_requested', usage_grants: 'not_requested', usage_policies: 'not_requested' }
      }),
      expect.objectContaining({
        requested_line_id: 'L-2',
        capture_status: 'no_match',
        artifact_statuses: { line_detail: 'not_found', price_adjustments: 'not_found', rate_card_entries: 'not_requested', rate_adjustments: 'not_requested', usage_grants: 'not_requested', usage_policies: 'not_requested' }
      })
    ]);
    expect(result.result.optional_artifacts).toEqual({ line_details: [], price_adjustments: [], rate_card_entries: [], rate_adjustments: [], usage_grants: [], usage_policies: [] });
    expect(result.warnings.join(' ')).toContain('QuoteLineDetail could not be captured');
    expect(result.result.recommended_next_commands).toEqual(['snapshot-lines', 'doctor', 'inspect-pricing-waterfall', 'inspect-rlm-context']);
  });

  it('returns error when quote snapshot cannot be collected', async () => {
    const result = await executeCapturePostPstEvidence({
      orgAlias: 'ARM',
      quoteId: 'Q-001',
      lineIds: ['L-1'],
      executeSnapshotQuote: vi.fn(async () => makeQuoteSnapshotResult('error')),
      executeSnapshotLines: vi.fn(),
      executeInspectPricingWaterfall: vi.fn()
    });

    expect(result.status).toBe('error');
    expect(result.errors).toEqual(['quote lookup failed']);
    expect(result.result.recommended_next_commands).toEqual(['snapshot-quote', 'doctor']);
  });

  it('discovers and captures every persisted quote line in all-lines mode', async () => {
    const executeSnapshotLines = vi.fn(async () => ({
      status: 'ok' as const,
      result: {
        quote_id: 'Q-001',
        lines: [makeLineRecord('L-1'), makeLineRecord('L-2')],
        field_set: [],
        counts: { returned: 2, requested: 0, available_on_quote: 2, missing: 0 },
        selection: { mode: 'all_quote_lines' as const, requested_line_ids: [], missing_line_ids: [] }
      },
      warnings: [], errors: [], evidence: [], query: 'SELECT ... FROM QuoteLineItem'
    }));
    const executeInspectPricingWaterfall = vi.fn(async ({ lineIds }) => makeInspectResult(lineIds[0] ?? 'missing'));

    const result = await executeCapturePostPstEvidence({
      orgAlias: 'ARM',
      quoteId: 'Q-001',
      lineIds: [],
      allLines: true,
      executeSnapshotQuote: vi.fn(async () => makeQuoteSnapshotResult('ok')),
      executeSnapshotLines,
      executeInspectPricingWaterfall
    });

    expect(executeSnapshotLines).toHaveBeenCalledWith(expect.objectContaining({ lineIds: [] }));
    expect(executeInspectPricingWaterfall).toHaveBeenCalledTimes(2);
    expect(result.status).toBe('ok');
    expect(result.result.counts).toMatchObject({ requested_lines: 2, resolved_line_snapshots: 2, ok_packets: 2 });
    expect(result.result.line_evidence_packets.map((packet) => packet.requested_line_id)).toEqual(['L-1', 'L-2']);
  });

  it('fetches shared-family records and the API execution log once across lines', async () => {
    const fetchPricingProcessExecutionRecordsByExecutionKey = vi.fn(async () => ({
      ok: true as const,
      classification: 'ok' as const,
      source: 'soql' as const,
      query: 'SELECT ... FROM PricingProcessExecution',
      data: [{ Id: 'ppe-api', ExecutionKey: 'shared-001', ExecutionType: 'Api_Execution', ExecutionTypeKey: 'api-type-001', Status: 'Success', Message: null, CreatedDate: '2026-04-17T12:10:03.000+0000' }]
    }));
    const fetchCorePricingApiExecutionLog = vi.fn(async () => ({
      ok: true as const,
      classification: 'ok' as const,
      source: 'rest' as const,
      path: '/services/data/v66.0/connect/core-pricing/apiexecutionlogs/api-type-001',
      data: [{ procedureName: 'Default Pricing Procedure' }]
    }));
    const executeInspectPricingWaterfall = vi.fn(async (inspectInput: ExecuteInspectPricingWaterfallInput) => {
      await inspectInput.fetchPricingProcessExecutionRecordsByExecutionKey?.({ orgAlias: 'ARM', executionKey: 'shared-001' });
      await inspectInput.fetchCorePricingApiExecutionLog?.({ orgAlias: 'ARM', apiExecutionTypeKey: 'api-type-001' });
      return makeInspectResult(inspectInput.lineIds[0] ?? 'missing');
    });

    const result = await executeCapturePostPstEvidence({
      orgAlias: 'ARM',
      quoteId: 'Q-001',
      lineIds: [],
      allLines: true,
      executeSnapshotQuote: vi.fn(async () => makeQuoteSnapshotResult('ok')),
      executeSnapshotLines: vi.fn(async () => ({
        status: 'ok' as const,
        result: {
          quote_id: 'Q-001',
          lines: [makeLineRecord('L-1'), makeLineRecord('L-2')],
          field_set: [],
          counts: { returned: 2, requested: 0, available_on_quote: 2, missing: 0 },
          selection: { mode: 'all_quote_lines' as const, requested_line_ids: [], missing_line_ids: [] }
        },
        warnings: [], errors: [], evidence: [], query: 'SELECT ... FROM QuoteLineItem'
      })),
      executeInspectPricingWaterfall,
      fetchPricingProcessExecutionRecordsByExecutionKey,
      fetchCorePricingApiExecutionLog
    });

    expect(executeInspectPricingWaterfall).toHaveBeenCalledTimes(2);
    expect(fetchPricingProcessExecutionRecordsByExecutionKey).toHaveBeenCalledTimes(1);
    expect(fetchCorePricingApiExecutionLog).toHaveBeenCalledTimes(1);
    expect(result.status).toBe('ok');
  });

  it('keeps correlation status ok when only the API execution log fetch failed', async () => {
    const inspectResult = makeInspectResult('L-1');
    inspectResult.result.correlation.api_execution_log = {
      fetch_status: 'error',
      endpoint: '/services/data/v66.0/connect/core-pricing/apiexecutionlogs/api-type-001',
      api_execution_type_key: 'api-type-001',
      raw_payload: null
    };

    const result = await executeCapturePostPstEvidence({
      orgAlias: 'ARM',
      quoteId: 'Q-001',
      lineIds: ['L-1'],
      executeSnapshotQuote: vi.fn(async () => makeQuoteSnapshotResult('ok')),
      executeSnapshotLines: vi.fn(async () => ({
        status: 'ok' as const,
        result: {
          quote_id: 'Q-001',
          lines: [makeLineRecord('L-1')],
          field_set: [],
          counts: { returned: 1, requested: 1, available_on_quote: 1, missing: 0 },
          selection: { mode: 'line_id_filter' as const, requested_line_ids: ['L-1'], missing_line_ids: [] }
        },
        warnings: [], errors: [], evidence: [], query: 'SELECT ... FROM QuoteLineItem'
      })),
      executeInspectPricingWaterfall: vi.fn(async () => inspectResult)
    });

    expect(result.status).toBe('ok');
    expect(result.result.line_evidence_packets[0]?.execution_correlation).toMatchObject({
      correlation_status: 'ok',
      api_execution_log: { fetch_status: 'error' }
    });
  });
});
