import { describe, expect, it, vi } from 'vitest';

import {
  executeInspectPricingWaterfall,
  mapCorePricingFailureStatus,
  parsePriceWaterfallIdentifier,
  type InspectPricingWaterfallPrimitiveResult
} from '../../src/primitives/inspect-pricing-waterfall';
import type { SnapshotLineRecord, SnapshotLinesPrimitiveResult } from '../../src/primitives/snapshot-lines';

function makeLineRecord(overrides: Partial<SnapshotLineRecord> = {}): SnapshotLineRecord {
  return {
    Id: '0QLxx0000000001AAA',
    QuoteId: '0Q0xx0000000001AAA',
    LineNumber: 10,
    Product2Id: '01txx0000000001AAA',
    PricebookEntryId: '01uxx0000000001AAA',
    ParentQuoteLineItemId: null,
    Quantity: 1,
    StartQuantity: 1,
    EndQuantity: 1,
    UnitPrice: 100,
    ListPrice: 100,
    NetUnitPrice: 95,
    Subtotal: 95,
    TotalPrice: 95,
    TotalLineAmount: 95,
    TotalAdjustmentAmount: 5,
    SellingModelType: 'OneTime',
    StartDate: '2026-04-17',
    EndDate: null,
    PriceWaterfallIdentifier: '0QLxx0000000001AAA:40944695130560',
    QuoteActionId: '0kaxx0000000001AAA',
    'QuoteAction.Type': 'Amend',
    'QuoteAction.SourceAssetId': '02ixx0000000001AAA',
    CreatedDate: '2026-04-17T12:00:00.000+0000',
    LastModifiedDate: '2026-04-17T12:05:00.000+0000',
    ...overrides
  };
}

function makeSnapshotLinesResult(line: SnapshotLineRecord | null): SnapshotLinesPrimitiveResult {
  return {
    status: line === null ? 'no_match' : 'ok',
    result: {
      quote_id: '0Q0xx0000000001AAA',
      lines: line === null ? [] : [line],
      field_set: [],
      counts: {
        returned: line === null ? 0 : 1,
        requested: 1,
        available_on_quote: line === null ? 0 : 1,
        missing: line === null ? 1 : 0
      },
      selection: {
        mode: 'line_id_filter',
        requested_line_ids: ['0QLxx0000000001AAA'],
        missing_line_ids: line === null ? ['0QLxx0000000001AAA'] : []
      }
    },
    warnings: [],
    errors: [],
    evidence: [],
    query: 'SELECT ... FROM QuoteLineItem'
  };
}

describe('inspect-pricing-waterfall primitive', () => {
  it('parses observed PriceWaterfallIdentifier values', () => {
    expect(parsePriceWaterfallIdentifier('0QLxx0000000001AAA:40944695130560')).toEqual({
      kind: 'parsed',
      raw: '0QLxx0000000001AAA:40944695130560',
      lineItemId: '0QLxx0000000001AAA',
      pricingExecutionId: '40944695130560'
    });
    expect(parsePriceWaterfallIdentifier('   ')).toEqual({ kind: 'missing' });
    expect(parsePriceWaterfallIdentifier('0QLxx0000000001AAA')).toEqual({
      kind: 'malformed',
      raw: '0QLxx0000000001AAA'
    });
    expect(parsePriceWaterfallIdentifier('0QLxx0000000001AAA:   ')).toEqual({
      kind: 'malformed',
      raw: '0QLxx0000000001AAA:'
    });
    expect(parsePriceWaterfallIdentifier('0QLxx0000000001AAA:40944695130560:extra')).toEqual({
      kind: 'malformed',
      raw: '0QLxx0000000001AAA:40944695130560:extra'
    });
  });

  it('maps core-pricing helper failures to runtime status classes', () => {
    expect(
      mapCorePricingFailureStatus({
        ok: false,
        classification: 'auth',
        source: 'rest',
        path: '/x',
        message: 'auth failed'
      })
    ).toBe('unsupported');
    expect(
      mapCorePricingFailureStatus({
        ok: false,
        classification: 'malformed_payload',
        source: 'soql',
        query: 'SELECT 1',
        message: 'bad payload'
      })
    ).toBe('error');
  });

  it('returns ok when persisted resolution, correlation, and waterfall fetch all succeed', async () => {
    const result = await executeInspectPricingWaterfall({
      orgAlias: 'ARM',
      quoteId: '0Q0xx0000000001AAA',
      lineIds: ['0QLxx0000000001AAA'],
      executeSnapshotLines: vi.fn(async () => makeSnapshotLinesResult(makeLineRecord())),
      invokeSfJson: vi
        .fn()
        .mockResolvedValueOnce({
          ok: true,
          classification: 'ok',
          cliPath: '/usr/local/bin/sf',
          data: {
            records: [
              {
                Id: 'ppe-pricing',
                ExecutionKey: 'shared-001',
                ExecutionType: 'Pricing',
                ExecutionTypeKey: '40944695130560',
                Status: 'Success',
                Message: null,
                CreatedDate: '2026-04-17T12:10:00.000+0000'
              }
            ]
          },
          exitCode: 0,
          stdout: '',
          stderr: ''
        })
        .mockResolvedValueOnce({
          ok: true,
          classification: 'ok',
          cliPath: '/usr/local/bin/sf',
          data: {
            records: [
              {
                Id: 'ppe-line',
                ExecutionKey: 'shared-001',
                ExecutionType: 'Pricing_Line',
                ExecutionTypeKey: '40944695130560_0QLxx0000000001AAA',
                Status: 'Success',
                Message: null,
                CreatedDate: '2026-04-17T12:10:01.000+0000'
              }
            ]
          },
          exitCode: 0,
          stdout: '',
          stderr: ''
        })
        .mockResolvedValueOnce({
          ok: true,
          classification: 'ok',
          cliPath: '/usr/local/bin/sf',
          data: {
            records: [
              {
                Id: 'api-1',
                ExecutionKey: 'shared-001',
                ApiEndpoint: '/connect/core-pricing/price-contexts',
                ApiType: 'Pricing',
                Status: 'Success',
                ReferenceKey: '40944695130560',
                CreatedDate: '2026-04-17T12:10:02.000+0000'
              }
            ]
          },
          exitCode: 0,
          stdout: '',
          stderr: ''
        })
        .mockResolvedValueOnce({
          ok: true,
          classification: 'ok',
          cliPath: '/usr/local/bin/sf',
          data: { records: [{ Id: 'ppe-api', ExecutionKey: 'shared-001', ExecutionType: 'Api_Execution', ExecutionTypeKey: 'api-type-001', Status: 'Success', Message: null, CreatedDate: '2026-04-17T12:10:02.000+0000' }] },
          exitCode: 0,
          stdout: '',
          stderr: ''
        }),
      invokeSfRestGet: vi
        .fn()
        .mockResolvedValueOnce({
          ok: true,
          classification: 'ok',
          path: '/services/data/v66.0/connect/core-pricing/pricing-process-execution/shared-001',
          cliPath: '/usr/local/bin/sf',
          data: {
            executionId: 'shared-001',
            executionTypes: ['Pricing', 'Api_Execution', 'Pricing_Line'],
            lineItems: [{ lineItemId: '0QLxx0000000001AAA', status: 'Success' }]
          },
          exitCode: 0,
          stdout: '',
          stderr: ''
        })
        .mockResolvedValueOnce({
          ok: true,
          classification: 'ok',
          path: '/services/data/v66.0/connect/core-pricing/apiexecutionlogs/api-type-001',
          cliPath: '/usr/local/bin/sf',
          data: [{ procedureName: 'Default Pricing Procedure' }],
          exitCode: 0,
          stdout: '',
          stderr: ''
        })
        .mockResolvedValueOnce({
          ok: true,
          classification: 'ok',
          path: '/services/data/v66.0/connect/core-pricing/waterfall/0QLxx0000000001AAA/40944695130560',
          cliPath: '/usr/local/bin/sf',
          data: {
            lineItemId: '0QLxx0000000001AAA',
            pricingExecutionId: '40944695130560',
            waterfallElements: [
              {
                sequence: 1,
                name: 'Formula Based Pricing',
                calculationFormula: 'InputUnitPrice * LineItemQuantity + 17',
                outputParameters: [{ target: 'Subtotal' }, { target: 'ItemNetTotalPrice' }]
              },
              {
                sequence: 2,
                name: 'Finalize Totals',
                outputParameters: [{ target: 'Subtotal' }]
              }
            ]
          },
          exitCode: 0,
          stdout: '',
          stderr: ''
        })
    });

    expect(result.status).toBe('ok');
    expect(result.result.selector_resolution).toMatchObject({
      requested_line_id: '0QLxx0000000001AAA',
      resolved_line_id: '0QLxx0000000001AAA',
      price_waterfall_identifier: '0QLxx0000000001AAA:40944695130560',
      pricing_execution_id: '40944695130560'
    });
    expect(result.result.correlation).toMatchObject({
      shared_execution_key: 'shared-001',
      execution_types_present: ['Pricing', 'Api_Execution', 'Pricing_Line'],
      line_membership_confirmed: true,
      api_execution_log: {
        fetch_status: 'ok',
        api_execution_type_key: 'api-type-001',
        raw_payload: [{ procedureName: 'Default Pricing Procedure' }]
      }
    });
    expect(result.result.waterfall.fetch_status).toBe('ok');
    expect(result.result.waterfall.summary).toMatchObject({
      element_count: 2,
      formula_count: 1
    });
    expect(result.result.recommended_next_commands).toEqual(['inspect-rlm-context']);
  });

  it('stays ok when the execution family has no Api_Execution row', async () => {
    const result = await executeInspectPricingWaterfall({
      orgAlias: 'ARM',
      quoteId: '0Q0xx0000000001AAA',
      lineIds: ['0QLxx0000000001AAA'],
      executeSnapshotLines: vi.fn(async () => makeSnapshotLinesResult(makeLineRecord())),
      invokeSfJson: vi
        .fn()
        .mockResolvedValueOnce({ ok: true, classification: 'ok', cliPath: '/usr/local/bin/sf', data: { records: [{ Id: 'ppe-pricing', ExecutionKey: 'shared-001', ExecutionType: 'Pricing', ExecutionTypeKey: '40944695130560', Status: 'Success', Message: null, CreatedDate: '2026-04-17T12:10:00.000+0000' }] }, exitCode: 0, stdout: '', stderr: '' })
        .mockResolvedValueOnce({ ok: true, classification: 'ok', cliPath: '/usr/local/bin/sf', data: { records: [{ Id: 'ppe-line', ExecutionKey: 'shared-001', ExecutionType: 'Pricing_Line', ExecutionTypeKey: '40944695130560_0QLxx0000000001AAA', Status: 'Success', Message: null, CreatedDate: '2026-04-17T12:10:01.000+0000' }] }, exitCode: 0, stdout: '', stderr: '' })
        .mockResolvedValueOnce({ ok: true, classification: 'ok', cliPath: '/usr/local/bin/sf', data: { records: [] }, exitCode: 0, stdout: '', stderr: '' })
        .mockResolvedValueOnce({ ok: true, classification: 'ok', cliPath: '/usr/local/bin/sf', data: { records: [{ Id: 'ppe-pricing', ExecutionKey: 'shared-001', ExecutionType: 'Pricing', ExecutionTypeKey: '40944695130560', Status: 'Success', Message: null, CreatedDate: '2026-04-17T12:10:00.000+0000' }] }, exitCode: 0, stdout: '', stderr: '' }),
      invokeSfRestGet: vi
        .fn()
        .mockResolvedValueOnce({ ok: true, classification: 'ok', path: '/services/data/v66.0/connect/core-pricing/pricing-process-execution/shared-001', cliPath: '/usr/local/bin/sf', data: { executionTypes: ['Pricing', 'Pricing_Line'], lineItems: [{ lineItemId: '0QLxx0000000001AAA', status: 'Success' }] }, exitCode: 0, stdout: '', stderr: '' })
        .mockResolvedValueOnce({ ok: true, classification: 'ok', path: '/services/data/v66.0/connect/core-pricing/waterfall/0QLxx0000000001AAA/40944695130560', cliPath: '/usr/local/bin/sf', data: { waterfallElements: [{ sequence: 1, name: 'Formula Based Pricing' }] }, exitCode: 0, stdout: '', stderr: '' })
    });

    expect(result.status).toBe('ok');
    expect(result.result.correlation.api_execution_log).toEqual({
      fetch_status: 'not_requested',
      endpoint: null,
      api_execution_type_key: null,
      raw_payload: null
    });
    expect(result.warnings).not.toContain(
      "Pricing API execution log retrieval was incomplete for line '0QLxx0000000001AAA'."
    );
  });

  it('stays ok and warns when the API execution log fetch fails', async () => {
    const result = await executeInspectPricingWaterfall({
      orgAlias: 'ARM',
      quoteId: '0Q0xx0000000001AAA',
      lineIds: ['0QLxx0000000001AAA'],
      executeSnapshotLines: vi.fn(async () => makeSnapshotLinesResult(makeLineRecord())),
      invokeSfJson: vi
        .fn()
        .mockResolvedValueOnce({ ok: true, classification: 'ok', cliPath: '/usr/local/bin/sf', data: { records: [{ Id: 'ppe-pricing', ExecutionKey: 'shared-001', ExecutionType: 'Pricing', ExecutionTypeKey: '40944695130560', Status: 'Success', Message: null, CreatedDate: '2026-04-17T12:10:00.000+0000' }] }, exitCode: 0, stdout: '', stderr: '' })
        .mockResolvedValueOnce({ ok: true, classification: 'ok', cliPath: '/usr/local/bin/sf', data: { records: [{ Id: 'ppe-line', ExecutionKey: 'shared-001', ExecutionType: 'Pricing_Line', ExecutionTypeKey: '40944695130560_0QLxx0000000001AAA', Status: 'Success', Message: null, CreatedDate: '2026-04-17T12:10:01.000+0000' }] }, exitCode: 0, stdout: '', stderr: '' })
        .mockResolvedValueOnce({ ok: true, classification: 'ok', cliPath: '/usr/local/bin/sf', data: { records: [] }, exitCode: 0, stdout: '', stderr: '' })
        .mockResolvedValueOnce({ ok: true, classification: 'ok', cliPath: '/usr/local/bin/sf', data: { records: [{ Id: 'ppe-api', ExecutionKey: 'shared-001', ExecutionType: 'Api_Execution', ExecutionTypeKey: 'api-type-001', Status: 'Success', Message: null, CreatedDate: '2026-04-17T12:10:03.000+0000' }] }, exitCode: 0, stdout: '', stderr: '' }),
      invokeSfRestGet: vi
        .fn()
        .mockResolvedValueOnce({ ok: true, classification: 'ok', path: '/services/data/v66.0/connect/core-pricing/pricing-process-execution/shared-001', cliPath: '/usr/local/bin/sf', data: { executionTypes: ['Pricing', 'Api_Execution', 'Pricing_Line'], lineItems: [{ lineItemId: '0QLxx0000000001AAA', status: 'Success' }] }, exitCode: 0, stdout: '', stderr: '' })
        .mockResolvedValueOnce({ ok: false, classification: 'cli_error', path: '/services/data/v66.0/connect/core-pricing/apiexecutionlogs/api-type-001', cliPath: '/usr/local/bin/sf', message: 'apiexecutionlogs GET failed', exitCode: 1, stdout: '', stderr: 'boom' })
        .mockResolvedValueOnce({ ok: true, classification: 'ok', path: '/services/data/v66.0/connect/core-pricing/waterfall/0QLxx0000000001AAA/40944695130560', cliPath: '/usr/local/bin/sf', data: { waterfallElements: [{ sequence: 1, name: 'Formula Based Pricing' }] }, exitCode: 0, stdout: '', stderr: '' })
    });

    expect(result.status).toBe('ok');
    expect(result.errors).toEqual([]);
    expect(result.result.correlation.api_execution_log).toMatchObject({
      fetch_status: 'error',
      api_execution_type_key: 'api-type-001',
      raw_payload: null
    });
    expect(result.warnings).toContain(
      "Pricing API execution log retrieval was incomplete for line '0QLxx0000000001AAA'."
    );
  });

  it('routes shared-family and API-log lookups through injected fetch overrides', async () => {
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

    const result = await executeInspectPricingWaterfall({
      orgAlias: 'ARM',
      quoteId: '0Q0xx0000000001AAA',
      lineIds: ['0QLxx0000000001AAA'],
      executeSnapshotLines: vi.fn(async () => makeSnapshotLinesResult(makeLineRecord())),
      fetchPricingProcessExecutionRecordsByExecutionKey,
      fetchCorePricingApiExecutionLog,
      invokeSfJson: vi
        .fn()
        .mockResolvedValueOnce({ ok: true, classification: 'ok', cliPath: '/usr/local/bin/sf', data: { records: [{ Id: 'ppe-pricing', ExecutionKey: 'shared-001', ExecutionType: 'Pricing', ExecutionTypeKey: '40944695130560', Status: 'Success', Message: null, CreatedDate: '2026-04-17T12:10:00.000+0000' }] }, exitCode: 0, stdout: '', stderr: '' })
        .mockResolvedValueOnce({ ok: true, classification: 'ok', cliPath: '/usr/local/bin/sf', data: { records: [{ Id: 'ppe-line', ExecutionKey: 'shared-001', ExecutionType: 'Pricing_Line', ExecutionTypeKey: '40944695130560_0QLxx0000000001AAA', Status: 'Success', Message: null, CreatedDate: '2026-04-17T12:10:01.000+0000' }] }, exitCode: 0, stdout: '', stderr: '' })
        .mockResolvedValueOnce({ ok: true, classification: 'ok', cliPath: '/usr/local/bin/sf', data: { records: [] }, exitCode: 0, stdout: '', stderr: '' }),
      invokeSfRestGet: vi
        .fn()
        .mockResolvedValueOnce({ ok: true, classification: 'ok', path: '/services/data/v66.0/connect/core-pricing/pricing-process-execution/shared-001', cliPath: '/usr/local/bin/sf', data: { executionTypes: ['Pricing', 'Api_Execution', 'Pricing_Line'], lineItems: [{ lineItemId: '0QLxx0000000001AAA', status: 'Success' }] }, exitCode: 0, stdout: '', stderr: '' })
        .mockResolvedValueOnce({ ok: true, classification: 'ok', path: '/services/data/v66.0/connect/core-pricing/waterfall/0QLxx0000000001AAA/40944695130560', cliPath: '/usr/local/bin/sf', data: { waterfallElements: [{ sequence: 1, name: 'Formula Based Pricing' }] }, exitCode: 0, stdout: '', stderr: '' })
    });

    expect(fetchPricingProcessExecutionRecordsByExecutionKey).toHaveBeenCalledWith(
      expect.objectContaining({ orgAlias: 'ARM', executionKey: 'shared-001' })
    );
    expect(fetchCorePricingApiExecutionLog).toHaveBeenCalledWith(
      expect.objectContaining({ orgAlias: 'ARM', apiExecutionTypeKey: 'api-type-001' })
    );
    expect(result.status).toBe('ok');
    expect(result.result.correlation.api_execution_log).toMatchObject({
      fetch_status: 'ok',
      api_execution_type_key: 'api-type-001',
      raw_payload: [{ procedureName: 'Default Pricing Procedure' }]
    });
  });

  it('normalizes live-style waterfall payloads with pricingElement names and object parameter maps', async () => {
    const result = await executeInspectPricingWaterfall({
      orgAlias: 'ARM',
      quoteId: '0Q0xx0000000001AAA',
      lineIds: ['0QLxx0000000001AAA'],
      executeSnapshotLines: vi.fn(async () => makeSnapshotLinesResult(makeLineRecord())),
      invokeSfJson: vi
        .fn()
        .mockResolvedValueOnce({ ok: true, classification: 'ok', cliPath: '/usr/local/bin/sf', data: { records: [{ Id: 'ppe-pricing', ExecutionKey: 'shared-001', ExecutionType: 'Pricing', ExecutionTypeKey: '40944695130560', Status: 'Success', Message: null, CreatedDate: '2026-04-17T12:10:00.000+0000' }] }, exitCode: 0, stdout: '', stderr: '' })
        .mockResolvedValueOnce({ ok: true, classification: 'ok', cliPath: '/usr/local/bin/sf', data: { records: [{ Id: 'ppe-line', ExecutionKey: 'shared-001', ExecutionType: 'Pricing_Line', ExecutionTypeKey: '40944695130560_0QLxx0000000001AAA', Status: 'Success', Message: null, CreatedDate: '2026-04-17T12:10:01.000+0000' }] }, exitCode: 0, stdout: '', stderr: '' })
        .mockResolvedValueOnce({ ok: true, classification: 'ok', cliPath: '/usr/local/bin/sf', data: { records: [{ Id: 'api-1', ExecutionKey: 'shared-001', ApiEndpoint: '/connect/core-pricing/price-contexts', ApiType: 'Pricing', Status: 'Success', ReferenceKey: '40944695130560', CreatedDate: '2026-04-17T12:10:02.000+0000' }] }, exitCode: 0, stdout: '', stderr: '' })
        .mockResolvedValueOnce({ ok: true, classification: 'ok', cliPath: '/usr/local/bin/sf', data: { records: [{ Id: 'ppe-api', ExecutionKey: 'shared-001', ExecutionType: 'Api_Execution', ExecutionTypeKey: 'api-type-001', Status: 'Success', Message: null, CreatedDate: '2026-04-17T12:10:03.000+0000' }] }, exitCode: 0, stdout: '', stderr: '' }),
      invokeSfRestGet: vi
        .fn()
        .mockResolvedValueOnce({ ok: true, classification: 'ok', path: '/services/data/v66.0/connect/core-pricing/pricing-process-execution/shared-001', cliPath: '/usr/local/bin/sf', data: { pricingProcessExecutionList: [{ executionType: 'Pricing_Line', executionTypeId: '40944695130560_0QLxx0000000001AAA', status: 'Success' }] }, exitCode: 0, stdout: '', stderr: '' })
        .mockResolvedValueOnce({ ok: true, classification: 'ok', path: '/services/data/v66.0/connect/core-pricing/apiexecutionlogs/api-type-001', cliPath: '/usr/local/bin/sf', data: [{ procedureName: 'Default Pricing Procedure' }], exitCode: 0, stdout: '', stderr: '' })
        .mockResolvedValueOnce({
          ok: true,
          classification: 'ok',
          path: '/services/data/v66.0/connect/core-pricing/waterfall/0QLxx0000000001AAA/40944695130560',
          cliPath: '/usr/local/bin/sf',
          data: {
            lineItemId: '0QLxx0000000001AAA',
            pricingExecutionId: '40944695130560',
            waterfall: [
              {
                sequence: 3,
                inputParameters: {
                  'Calculation Formula': 'InputUnitPrice * LineItemQuantity + 17',
                  InputUnitPrice: 100
                },
                outputParameters: {
                  'Output Variable': 117,
                  Subtotal: 117
                },
                pricingElement: {
                  elementType: 'FormulaBasedPricing',
                  name: 'Formula Based Pricing'
                }
              }
            ]
          },
          exitCode: 0,
          stdout: '',
          stderr: ''
        })
    });

    expect(result.status).toBe('ok');
    expect(result.result.waterfall.summary).toMatchObject({ element_count: 1, formula_count: 1 });
    expect(result.result.waterfall.normalized_elements[0]).toMatchObject({
      sequence: 3,
      name: 'Formula Based Pricing',
      calculation_formula: 'InputUnitPrice * LineItemQuantity + 17'
    });
    expect(result.result.waterfall.normalized_elements[0]?.writes).toEqual(expect.arrayContaining(['Output Variable', 'Subtotal']));
  });

  it('uses PST graph line references from PriceWaterfallIdentifier for live-created quote lines', async () => {
    const invokeSfJson = vi
      .fn()
      .mockResolvedValueOnce({ ok: true, classification: 'ok', cliPath: '/usr/local/bin/sf', data: { records: [{ Id: 'ppe-pricing', ExecutionKey: 'shared-001', ExecutionType: 'Pricing', ExecutionTypeKey: '40944695130560', Status: 'Success', Message: null, CreatedDate: '2026-04-17T12:10:00.000+0000' }] }, exitCode: 0, stdout: '', stderr: '' })
      .mockResolvedValueOnce({ ok: true, classification: 'ok', cliPath: '/usr/local/bin/sf', data: { records: [{ Id: 'ppe-line', ExecutionKey: 'shared-001', ExecutionType: 'Pricing_Line', ExecutionTypeKey: '40944695130560_line1', Status: 'Success', Message: null, CreatedDate: '2026-04-17T12:10:01.000+0000' }] }, exitCode: 0, stdout: '', stderr: '' })
      .mockResolvedValueOnce({ ok: true, classification: 'ok', cliPath: '/usr/local/bin/sf', data: { records: [{ Id: 'api-1', ExecutionKey: 'shared-001', ApiEndpoint: '/connect/core-pricing/price-contexts', ApiType: 'Pricing', Status: 'Success', ReferenceKey: '40944695130560', CreatedDate: '2026-04-17T12:10:02.000+0000' }] }, exitCode: 0, stdout: '', stderr: '' })
      .mockResolvedValueOnce({ ok: true, classification: 'ok', cliPath: '/usr/local/bin/sf', data: { records: [{ Id: 'ppe-api', ExecutionKey: 'shared-001', ExecutionType: 'Api_Execution', ExecutionTypeKey: 'api-type-001', Status: 'Success', Message: null, CreatedDate: '2026-04-17T12:10:03.000+0000' }] }, exitCode: 0, stdout: '', stderr: '' });
    const invokeSfRestGet = vi
      .fn()
      .mockResolvedValueOnce({ ok: true, classification: 'ok', path: '/services/data/v66.0/connect/core-pricing/pricing-process-execution/shared-001', cliPath: '/usr/local/bin/sf', data: { executionTypes: ['Pricing', 'Api_Execution', 'Pricing_Line'], lineItems: [{ lineItemId: 'line1', status: 'Success' }] }, exitCode: 0, stdout: '', stderr: '' })
      .mockResolvedValueOnce({ ok: true, classification: 'ok', path: '/services/data/v66.0/connect/core-pricing/apiexecutionlogs/api-type-001', cliPath: '/usr/local/bin/sf', data: [{ procedureName: 'Default Pricing Procedure' }], exitCode: 0, stdout: '', stderr: '' })
      .mockResolvedValueOnce({ ok: true, classification: 'ok', path: '/services/data/v66.0/connect/core-pricing/waterfall/line1/40944695130560', cliPath: '/usr/local/bin/sf', data: { lineItemId: 'line1', waterfallElements: [{ sequence: 1, name: 'Formula Based Pricing' }] }, exitCode: 0, stdout: '', stderr: '' });

    const result = await executeInspectPricingWaterfall({
      orgAlias: 'ARM',
      quoteId: '0Q0xx0000000001AAA',
      lineIds: ['0QLxx0000000001AAA'],
      executeSnapshotLines: vi.fn(async () =>
        makeSnapshotLinesResult(makeLineRecord({ PriceWaterfallIdentifier: 'line1:40944695130560' }))
      ),
      invokeSfJson,
      invokeSfRestGet
    });

    expect(result.status).toBe('ok');
    expect(result.result.selector_resolution).toMatchObject({
      requested_line_id: '0QLxx0000000001AAA',
      resolved_line_id: '0QLxx0000000001AAA',
      price_waterfall_identifier: 'line1:40944695130560',
      waterfall_line_item_id: 'line1',
      pricing_execution_id: '40944695130560'
    });
    expect(invokeSfJson).toHaveBeenNthCalledWith(2, expect.objectContaining({
      args: expect.arrayContaining(['--query', expect.stringContaining("ExecutionTypeKey = '40944695130560_line1'")])
    }));
    expect(invokeSfRestGet).toHaveBeenNthCalledWith(3, expect.objectContaining({
      path: '/services/data/v66.0/connect/core-pricing/waterfall/line1/40944695130560'
    }));
    expect(result.warnings).toContain(
      "PriceWaterfallIdentifier line token 'line1' does not match requested Salesforce line id '0QLxx0000000001AAA'; treating it as a PST graph line reference for pricing waterfall lookup."
    );
  });

  it('returns no_match when the requested line is missing on the quote', async () => {
    const invokeSfJson = vi.fn();
    const invokeSfRestGet = vi.fn();

    const result = await executeInspectPricingWaterfall({
      orgAlias: 'ARM',
      quoteId: '0Q0xx0000000001AAA',
      lineIds: ['0QLxx0000000001AAA'],
      executeSnapshotLines: vi.fn(async () => makeSnapshotLinesResult(null)),
      invokeSfJson,
      invokeSfRestGet
    });

    expect(result.status).toBe('no_match');
    expect(result.result.recommended_next_commands).toEqual(['snapshot-lines', 'doctor']);
    expect(invokeSfJson).not.toHaveBeenCalled();
    expect(invokeSfRestGet).not.toHaveBeenCalled();
  });

  it('returns partial when PriceWaterfallIdentifier is blank', async () => {
    const result = await executeInspectPricingWaterfall({
      orgAlias: 'ARM',
      quoteId: '0Q0xx0000000001AAA',
      lineIds: ['0QLxx0000000001AAA'],
      executeSnapshotLines: vi.fn(async () => makeSnapshotLinesResult(makeLineRecord({ PriceWaterfallIdentifier: null })))
    });

    expect(result.status).toBe('partial');
    expect(result.result.selector_resolution.price_waterfall_identifier).toBeNull();
    expect(result.warnings).toContain("Persisted line '0QLxx0000000001AAA' does not currently expose PriceWaterfallIdentifier.");
  });

  it('returns error when PriceWaterfallIdentifier is malformed but nonblank', async () => {
    const invokeSfJson = vi.fn();
    const invokeSfRestGet = vi.fn();

    const result = await executeInspectPricingWaterfall({
      orgAlias: 'ARM',
      quoteId: '0Q0xx0000000001AAA',
      lineIds: ['0QLxx0000000001AAA'],
      executeSnapshotLines: vi.fn(async () =>
        makeSnapshotLinesResult(makeLineRecord({ PriceWaterfallIdentifier: '0QLxx0000000001AAA' }))
      ),
      invokeSfJson,
      invokeSfRestGet
    });

    expect(result.status).toBe('error');
    expect(result.result.selector_resolution.price_waterfall_identifier).toBe('0QLxx0000000001AAA');
    expect(result.result.selector_resolution.pricing_execution_id).toBeNull();
    expect(result.errors).toEqual([
      "PriceWaterfallIdentifier '0QLxx0000000001AAA' did not match the expected <lineItemId>:<pricingExecutionId> format."
    ]);
    expect(result.evidence[0]?.claim).toContain('PriceWaterfallIdentifier was malformed');
    expect(invokeSfJson).not.toHaveBeenCalled();
    expect(invokeSfRestGet).not.toHaveBeenCalled();
  });

  it('returns error when the parsed line id mismatches the requested line id', async () => {
    const result = await executeInspectPricingWaterfall({
      orgAlias: 'ARM',
      quoteId: '0Q0xx0000000001AAA',
      lineIds: ['0QLxx0000000001AAA'],
      executeSnapshotLines: vi.fn(async () =>
        makeSnapshotLinesResult(makeLineRecord({ PriceWaterfallIdentifier: '0QLxx0000000009AAA:40944695130560' }))
      )
    });

    expect(result.status).toBe('error');
    expect(result.errors[0]).toContain("did not match requested line id '0QLxx0000000001AAA'");
  });

  it('returns partial when correlation is incomplete but the waterfall fetch still succeeds', async () => {
    const result = await executeInspectPricingWaterfall({
      orgAlias: 'ARM',
      quoteId: '0Q0xx0000000001AAA',
      lineIds: ['0QLxx0000000001AAA'],
      executeSnapshotLines: vi.fn(async () => makeSnapshotLinesResult(makeLineRecord())),
      invokeSfJson: vi
        .fn()
        .mockResolvedValueOnce({
          ok: true,
          classification: 'ok',
          cliPath: '/usr/local/bin/sf',
          data: { records: [] },
          exitCode: 0,
          stdout: '',
          stderr: ''
        })
        .mockResolvedValueOnce({
          ok: true,
          classification: 'ok',
          cliPath: '/usr/local/bin/sf',
          data: { records: [] },
          exitCode: 0,
          stdout: '',
          stderr: ''
        }),
      invokeSfRestGet: vi.fn(async () => ({
        ok: true,
        classification: 'ok',
        path: '/services/data/v66.0/connect/core-pricing/waterfall/0QLxx0000000001AAA/40944695130560',
        cliPath: '/usr/local/bin/sf',
        data: {
          waterfallElements: [{ sequence: 1, name: 'Formula Based Pricing' }]
        },
        exitCode: 0,
        stdout: '',
        stderr: ''
      }))
    });

    expect(result.status).toBe('partial');
    expect(result.result.waterfall.fetch_status).toBe('ok');
    expect(result.warnings).toContain(
      "Could not derive a shared execution key for line '0QLxx0000000001AAA' from PricingProcessExecution correlation."
    );
  });

  it('returns unsupported when the resolved waterfall GET is unavailable', async () => {
    const result = await executeInspectPricingWaterfall({
      orgAlias: 'ARM',
      quoteId: '0Q0xx0000000001AAA',
      lineIds: ['0QLxx0000000001AAA'],
      executeSnapshotLines: vi.fn(async () => makeSnapshotLinesResult(makeLineRecord())),
      invokeSfJson: vi
        .fn()
        .mockResolvedValueOnce({ ok: true, classification: 'ok', cliPath: '/usr/local/bin/sf', data: { records: [] }, exitCode: 0, stdout: '', stderr: '' })
        .mockResolvedValueOnce({ ok: true, classification: 'ok', cliPath: '/usr/local/bin/sf', data: { records: [] }, exitCode: 0, stdout: '', stderr: '' }),
      invokeSfRestGet: vi.fn(async () => ({
        ok: false,
        classification: 'auth',
        path: '/services/data/v66.0/connect/core-pricing/waterfall/0QLxx0000000001AAA/40944695130560',
        cliPath: '/usr/local/bin/sf',
        message: 'Org alias ARM is not authenticated.',
        exitCode: 1,
        stdout: '',
        stderr: 'auth failed'
      }))
    });

    expect(result.status).toBe('unsupported');
    expect(result.errors).toContain('Org alias ARM is not authenticated.');
  });
});
