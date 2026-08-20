import { describe, expect, it, vi } from 'vitest';

import {
  buildInspectProductCatalogConfigEnvelope,
  parseInspectProductCatalogConfigFlags,
  runInspectProductCatalogConfigCommand
} from '../../src/commands/inspect-product-catalog-config';
import type { ProductCatalogConfigPrimitiveResult } from '../../src/primitives/product-catalog-config';

describe('inspect-product-catalog-config command', () => {
  it('parses product, pricebook, and focus filters', async () => {
    await expect(parseInspectProductCatalogConfigFlags([
      '--product-id',
      '01txx',
      '--pricebook-id',
      '01sxx',
      '--attribute-name',
      'Detector',
      '--component-group',
      'Options',
      '--include-raw'
    ])).resolves.toMatchObject({
      productId: '01txx',
      pricebookId: '01sxx',
      attributeName: 'Detector',
      componentGroup: 'Options',
      includeRaw: true
    });
  });

  it('builds an inspect envelope with plan-product-config as next command', () => {
    const envelope = buildInspectProductCatalogConfigEnvelope({
      globalFlags: { help: false, json: true, orgAlias: 'ARMAF', failOn: undefined, output: undefined, verbose: false },
      commandFlags: {
        productId: '01txx',
        pricebookId: '01sxx',
        catalogId: null,
        accountId: null,
        productSellingModelId: null,
        attributeName: null,
        componentGroup: null,
        includeRaw: false
      },
      primitiveResult: primitive('ok')
    });

    expect(envelope.command).toBe('inspect-product-catalog-config');
    expect(envelope.summary.next_suggested_command).toBe('plan-product-config');
  });

  it('runs with an injectable primitive and writes JSON output', async () => {
    const writes: string[] = [];
    const result = await runInspectProductCatalogConfigCommand(
      ['--product-id', '01txx', '--pricebook-id', '01sxx'],
      { help: false, json: true, orgAlias: 'ARMAF', failOn: undefined, output: undefined, verbose: false },
      {
        stdout: { write: (message: string) => void writes.push(message) },
        stderr: { write: () => undefined }
      },
      {
        executeProductCatalogConfig: vi.fn(async () => primitive('ok'))
      }
    );

    expect(result.exitCode).toBe(0);
    expect(JSON.parse(writes.join('')).command).toBe('inspect-product-catalog-config');
  });
});

function primitive(status: ProductCatalogConfigPrimitiveResult['status']): ProductCatalogConfigPrimitiveResult {
  return {
    status,
    result: {
      product_config: {
        product: {
          id: '01txx',
          name: 'DR suite',
          code: null,
          type: null,
          pricebook_id: '01sxx',
          pricebook_entry_id: null
        },
        attributes: [],
        component_groups: [],
        runtime_validation_available_pre_quote: false
      },
      product_identity: {
        product_id: '01txx',
        product_name: 'DR suite',
        product_code: null,
        product_type: null,
        pricebook_id: '01sxx',
        pricebook_entry_id: null
      },
      config_summary: {
        required_attributes: [],
        optional_attributes: [],
        component_groups: [],
        runtime_validation_available_pre_quote: false
      },
      pst_fields: {
        quote_line_item_attribute_parent_field: 'QuoteLineItemId',
        attribute_value_fields: []
      },
      filters: {
        attribute_name: null,
        component_group: null
      }
    },
    warnings: [],
    errors: [],
    evidence: [],
    queries: []
  };
}
