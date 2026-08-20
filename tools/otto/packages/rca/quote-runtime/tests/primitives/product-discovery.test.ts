import { describe, expect, it, vi } from 'vitest';

import {
  buildProductUsageGrantSoql,
  buildProductUsageResourceSoql,
  buildRateCardEntrySoql,
  buildProductFallbackSoql,
  executeDiscoverProducts,
  PRODUCTS_LIST_ROUTE
} from '../../src/primitives/product-discovery';

describe('product discovery primitive', () => {
  it('falls back to SOQL when no catalog or category context is provided', async () => {
    const invokeSfJson = vi.fn(async (options) => {
      const query = String(options.args[options.args.indexOf('--query') + 1]);
      if (query.includes('FROM ProductUsageResource')) {
        return sfQuery([
          {
            Id: '0PURxx000000001AAA',
            ProductId: '01txx000000001AAA',
            UsageResourceId: '1BRxx000000001AAA',
            Status: 'Active',
            UsageResource: {
              Name: 'API Calls',
              Code: 'API_CALLS'
            }
          }
        ]);
      }
      if (query.includes('FROM ProductUsageGrant')) {
        return sfQuery([
          {
            Id: '1BXxx000000001AAA',
            ProductId: '01txx000000001AAA',
            ProductSellingModelId: '0jPxx000000001AAA',
            Quantity: 500,
            Type: 'Grant',
            ValidityPeriodTerm: 1,
            ValidityPeriodUnit: 'Month'
          }
        ]);
      }
      if (query.includes('FROM RateCardEntry')) {
        return sfQuery([
          {
            Id: '0RCExx000000001AAA',
            ProductId: '01txx000000001AAA',
            RateCardId: '0RCxx000000001AAA',
            RateCard: { Name: 'API Rate Card' },
            UsageResourceId: '1BRxx000000001AAA',
            UsageResource: { Name: 'API Calls' },
            ProductSellingModelId: '0jPxx000000001AAA',
            ProductSellingModel: { Name: 'Evergreen' },
            Rate: 0.02,
            Status: 'Active'
          }
        ]);
      }
      return sfQuery([
        {
          Id: '01uxx000000001AAA',
          Pricebook2Id: '01sxx000000001AAA',
          Product2Id: '01txx000000001AAA',
          IsActive: true,
          CurrencyIsoCode: 'USD',
          UnitPrice: 125,
          ProductSellingModelId: '0jPxx000000001AAA',
          ProductSellingModel: {
            Name: 'Evergreen',
            SellingModelType: 'Evergreen',
            PricingTerm: 1,
            PricingTermUnit: 'Month'
          },
          Product2: {
            Name: 'Companion animal DR suite',
            ProductCode: 'DR-SUITE',
            Type: 'Bundle'
          }
        }
      ]);
    });

    const result = await executeDiscoverProducts({
      orgAlias: 'ARMAF',
      pricebookId: '01sxx000000001AAA',
      terms: ['DR suite'],
      invokeSfJson
    });

    expect(result.status).toBe('ok');
    expect(result.result.strategy).toBe('soql_fallback');
    expect(result.result.candidates).toEqual([
      expect.objectContaining({
        product_id: '01txx000000001AAA',
        name: 'Companion animal DR suite',
        pricebook_entry_id: '01uxx000000001AAA',
        unit_price: 125,
        currency_iso_code: 'USD',
        product_selling_model_id: '0jPxx000000001AAA',
        product_selling_model_name: 'Evergreen',
        usable: true
      })
    ]);
    expect(result.result.candidates[0].usage_rate_summary).toMatchObject({
      product_usage_resource_count: 1,
      product_usage_grant_count: 1,
      rate_card_entry_count: 1,
      usage_resources: [expect.objectContaining({ usage_resource_name: 'API Calls' })],
      usage_grants: [expect.objectContaining({ product_usage_grant_id: '1BXxx000000001AAA', quantity: 500 })],
      rate_card_entries: [expect.objectContaining({ rate_card_name: 'API Rate Card', rate: 0.02 })]
    });
    expect(result.warnings).toContain('Products List API was skipped because neither --catalog-id nor --category-id was provided.');
    expect(invokeSfJson).toHaveBeenCalledWith(expect.objectContaining({
      args: expect.arrayContaining(['data', 'query', '--target-org', 'ARMAF', '--json'])
    }));
  });

  it('uses Products List API candidates when available', async () => {
    const invokeSfRestWrite = vi.fn(async () => ({
      ok: true as const,
      classification: 'ok' as const,
      path: PRODUCTS_LIST_ROUTE,
      method: 'POST' as const,
      body: '{}',
      cliPath: '/usr/local/bin/sf',
      data: {
        result: [
          {
            id: '01txx000000002AAA',
            name: 'Wireless detector',
            productCode: 'WIRELESS',
            prices: [{ priceBookEntryId: '01uxx000000002AAA' }]
          }
        ]
      },
      exitCode: 0,
      stdout: '{}',
      stderr: ''
    }));
    const invokeSfJson = vi.fn(async () => sfQuery([]));

    const result = await executeDiscoverProducts({
      orgAlias: 'ARMAF',
      pricebookId: '01sxx000000001AAA',
      catalogId: '0ZCxx000000001AAA',
      terms: ['wireless'],
      invokeSfRestWrite,
      invokeSfJson
    });

    expect(result.status).toBe('ok');
    expect(result.result.strategy).toBe('products_list');
    expect(result.result.candidates[0]).toMatchObject({
      product_id: '01txx000000002AAA',
      name: 'Wireless detector',
      usage_rate_summary: {
        product_usage_resource_count: 0,
        usage_resources: [],
        product_usage_grant_count: 0,
        usage_grants: [],
        rate_card_entry_count: 0,
        rate_card_entries: []
      }
    });
    expect(invokeSfJson).toHaveBeenCalledTimes(3);
    expect(invokeSfRestWrite).toHaveBeenCalledWith(expect.objectContaining({
      path: PRODUCTS_LIST_ROUTE,
      method: 'POST'
    }));
  });

  it('builds the pricebook-entry fallback query with term and currency filters', () => {
    expect(buildProductFallbackSoql('01sxx', ["DR's"], 5, 'USD')).toContain("CurrencyIsoCode = 'USD'");
  });

  it('builds usage/rate enrichment queries with product selectors', () => {
    expect(buildProductUsageResourceSoql(['01txx'])).toContain("ProductId IN ('01txx')");
    expect(buildProductUsageGrantSoql(['01txx'])).toContain('FROM ProductUsageGrant');
    expect(buildRateCardEntrySoql(['01txx'])).toContain('FROM RateCardEntry');
  });
});

function sfQuery(records: unknown[]) {
  return {
    ok: true as const,
    classification: 'ok' as const,
    cliPath: '/usr/local/bin/sf',
    data: { records },
    exitCode: 0,
    stdout: '{}',
    stderr: ''
  };
}
