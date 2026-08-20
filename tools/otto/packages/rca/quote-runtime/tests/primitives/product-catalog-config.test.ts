import { describe, expect, it, vi } from 'vitest';

import {
  buildProductDetailsRoute,
  executeProductCatalogConfig
} from '../../src/primitives/product-catalog-config';

describe('product catalog config primitive', () => {
  it('normalizes Product Details attributes and SOQL component supplements', async () => {
    const invokeSfRestWrite = vi.fn(async () => ({
      ok: true as const,
      classification: 'ok' as const,
      path: buildProductDetailsRoute('01txx000000001AAA'),
      method: 'POST' as const,
      body: '{}',
      cliPath: '/usr/local/bin/sf',
      data: {
        product: {
          id: '01txx000000001AAA',
          name: 'Companion animal DR suite',
          productCode: 'DR-SUITE',
          type: 'Bundle'
        },
        attributes: [
          {
            id: '0v3xx000000001AAA',
            name: 'Detector Size',
            required: true,
            attributePickList: {
              values: [
                { id: '0v4xx000000001AAA', name: '10x12', displayValue: '10x12', textValue: '10x12' }
              ]
            }
          }
        ]
      },
      exitCode: 0,
      stdout: '{}',
      stderr: ''
    }));
    const invokeSfJson = vi.fn(async (options) => {
      const query = String(options.args[5]);
      if (query.includes('FROM PricebookEntry')) {
        return sfQuery([{ Id: '01uxx000000001AAA', Pricebook2Id: '01sxx000000001AAA', Product2Id: '01txx000000001AAA' }]);
      }
      if (query.includes('FROM ProductComponentGroup')) {
        return sfQuery([{ Id: '0cGxx000000001AAA', Name: 'Detector Options', Code: 'DETECTOR', MinBundleComponents: 1, MaxBundleComponents: 1 }]);
      }
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
          Id: '0cRxx000000001AAA',
          ProductComponentGroupId: '0cGxx000000001AAA',
          ChildProductId: '01txx000000002AAA',
          IsDefaultComponent: true,
          IsComponentRequired: true,
          MinQuantity: 1,
          MaxQuantity: 1,
          ChildProduct: {
            Name: 'Wireless DR detector 10x12',
            ProductCode: 'DET-10X12'
          }
        }
      ]);
    });

    const result = await executeProductCatalogConfig({
      orgAlias: 'ARMAF',
      productId: '01txx000000001AAA',
      pricebookId: '01sxx000000001AAA',
      invokeSfRestWrite,
      invokeSfJson
    });

    expect(invokeSfRestWrite).toHaveBeenCalledWith(expect.objectContaining({
      body: expect.objectContaining({
        priceBookId: '01sxx000000001AAA'
      })
    }));
    expect(result.status).toBe('ok');
    expect(result.result.product_identity).toMatchObject({
      product_id: '01txx000000001AAA',
      product_name: 'Companion animal DR suite',
      product_code: 'DR-SUITE',
      pricebook_entry_id: '01uxx000000001AAA'
    });
    expect(result.result.config_summary.required_attributes[0]).toMatchObject({
      name: 'Detector Size',
      values: [expect.objectContaining({ text_value: '10x12' })]
    });
    expect(result.result.config_summary.component_groups[0]).toMatchObject({
      name: 'Detector Options',
      min_cardinality: 1,
      max_cardinality: 1,
      child_options: [expect.objectContaining({ product_name: 'Wireless DR detector 10x12' })]
    });
    expect(result.result.usage_rate_summary).toMatchObject({
      product_usage_resource_count: 1,
      product_usage_grant_count: 1,
      rate_card_entry_count: 1,
      usage_resources: [expect.objectContaining({ usage_resource_name: 'API Calls' })],
      usage_grants: [expect.objectContaining({ product_usage_grant_id: '1BXxx000000001AAA', quantity: 500 })],
      rate_card_entries: [expect.objectContaining({ rate_card_name: 'API Rate Card', rate: 0.02 })]
    });
    expect(result.result.product_config.usage_rate_summary.rate_card_entry_count).toBe(1);
    expect(result.result.product_config.attributes[0]).toMatchObject({
      id: '0v3xx000000001AAA',
      name: 'Detector Size'
    });
  });

  it('supports focused attribute filters', async () => {
    const result = await executeProductCatalogConfig({
      orgAlias: 'ARMAF',
      productId: '01txx000000001AAA',
      pricebookId: '01sxx000000001AAA',
      attributeName: 'software',
      invokeSfRestWrite: vi.fn(async () => ({
        ok: true as const,
        classification: 'ok' as const,
        path: buildProductDetailsRoute('01txx000000001AAA'),
        method: 'POST' as const,
        body: '{}',
        cliPath: '/usr/local/bin/sf',
        data: {
          product: { name: 'DR suite' },
          attributes: [
            { id: 'a1', name: 'Detector Size', required: true, values: [] },
            { id: 'a2', name: 'Software Package', required: true, values: [] }
          ]
        },
        exitCode: 0,
        stdout: '{}',
        stderr: ''
      })),
      invokeSfJson: vi.fn(async () => sfQuery([]))
    });

    expect(result.result.config_summary.required_attributes.map((attribute) => attribute.name)).toEqual(['Software Package']);
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
