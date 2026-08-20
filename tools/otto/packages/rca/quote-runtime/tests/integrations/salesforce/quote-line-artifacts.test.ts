import { describe, expect, it, vi } from 'vitest';

import {
  buildQuoteLineDetailSoql,
  buildQuoteLinePriceAdjustmentSoql,
  fetchQuoteLineDetailByLineId,
  fetchQuoteLinePriceAdjustmentsByLineId
} from '../../../src/integrations/salesforce/quote-line-artifacts';

describe('quote-line-artifacts integration helpers', () => {
  it('builds the documented QuoteLineDetail SOQL shape', () => {
    expect(buildQuoteLineDetailSoql('L-001')).toBe(
      "SELECT Id, QuoteLineItemId, PriceWaterfallIdentifier, UnitPrice, NetUnitPrice, TotalPrice, TotalLineAmount, EffectiveFrom, EffectiveTo, ReferenceNumber, ReferenceDate FROM QuoteLineDetail WHERE QuoteLineItemId = 'L-001' ORDER BY EffectiveFrom, Id"
    );
  });

  it('builds the documented QuoteLinePriceAdjustment SOQL shape', () => {
    expect(buildQuoteLinePriceAdjustmentSoql('L-001')).toBe(
      "SELECT Id, QuoteLineItemId, AdjustmentSource, AdjustmentType, AdjustmentValue, TotalAmount, Description, Priority, PriceAdjustmentCauseId FROM QuoteLinePriceAdjustment WHERE QuoteLineItemId = 'L-001' ORDER BY Priority, Id"
    );
  });

  it('queries and normalizes QuoteLineDetail records', async () => {
    const invokeSfJson = vi.fn(async () => ({
      ok: true as const,
      classification: 'ok' as const,
      cliPath: 'sf',
      data: {
        records: [
          {
            Id: 'QLD-1',
            QuoteLineItemId: 'L-001',
            PriceWaterfallIdentifier: 'L-001:40944695130560',
            UnitPrice: 100,
            NetUnitPrice: 95,
            TotalPrice: 95,
            TotalLineAmount: 95,
            EffectiveFrom: '2026-04-21',
            EffectiveTo: null,
            ReferenceNumber: 'REF-1',
            ReferenceDate: '2026-04-21'
          }
        ]
      },
      exitCode: 0,
      stdout: '{}',
      stderr: ''
    }));

    const result = await fetchQuoteLineDetailByLineId({
      orgAlias: 'ARM',
      lineId: 'L-001',
      invokeSfJson
    });

    expect(result).toMatchObject({
      ok: true,
      classification: 'ok',
      data: [
        expect.objectContaining({
          Id: 'QLD-1',
          QuoteLineItemId: 'L-001',
          UnitPrice: 100
        })
      ]
    });
    expect(invokeSfJson).toHaveBeenCalledWith({
      args: ['data', 'query', '--target-org', 'ARM', '--query', buildQuoteLineDetailSoql('L-001'), '--json'],
      orgAlias: 'ARM'
    });
  });

  it('returns CLI failures from QuoteLinePriceAdjustment queries', async () => {
    const invokeSfJson = vi.fn(async () => ({
      ok: false as const,
      classification: 'cli_error' as const,
      cliPath: 'sf',
      message: 'INVALID_TYPE: sObject type QuoteLinePriceAdjustment is not supported.',
      exitCode: 1,
      stdout: '',
      stderr: ''
    }));

    const result = await fetchQuoteLinePriceAdjustmentsByLineId({
      orgAlias: 'ARM',
      lineId: 'L-001',
      invokeSfJson
    });

    expect(result).toEqual({
      ok: false,
      classification: 'cli_error',
      query: buildQuoteLinePriceAdjustmentSoql('L-001'),
      message: 'INVALID_TYPE: sObject type QuoteLinePriceAdjustment is not supported.'
    });
  });
});
