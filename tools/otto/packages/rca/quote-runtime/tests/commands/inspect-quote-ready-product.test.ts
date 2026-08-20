import { describe, expect, it, vi } from 'vitest';

import {
  buildInspectQuoteReadyProductEnvelope,
  parseInspectQuoteReadyProductFlags,
  runInspectQuoteReadyProductCommand
} from '../../src/commands/inspect-quote-ready-product';
import type { ProductCatalogConfigPrimitiveResult } from '../../src/primitives/product-catalog-config';
import type { ProductDiscoveryCandidate, ProductDiscoveryPrimitiveResult } from '../../src/primitives/product-discovery';

describe('inspect-quote-ready-product command', () => {
  it('parses product-id input and optional catalog context', async () => {
    await expect(parseInspectQuoteReadyProductFlags([
      '--pricebook-id',
      '01sxx',
      '--product-id',
      '01txx',
      '--catalog-id',
      '0ZCxx',
      '--account-id',
      '001xx',
      '--product-selling-model-id',
      '0jPxx',
      '--include-raw'
    ])).resolves.toMatchObject({
      pricebookId: '01sxx',
      productId: '01txx',
      terms: [],
      catalogId: '0ZCxx',
      accountId: '001xx',
      productSellingModelId: '0jPxx',
      includeRaw: true
    });
  });

  it('requires exactly one product selector', async () => {
    await expect(parseInspectQuoteReadyProductFlags(['--pricebook-id', '01sxx'])).rejects.toThrow(/requires exactly one selector/i);
    await expect(parseInspectQuoteReadyProductFlags([
      '--pricebook-id',
      '01sxx',
      '--product-id',
      '01txx',
      '--term',
      'DR suite'
    ])).rejects.toThrow(/requires exactly one selector/i);
  });

  it('builds a readiness envelope with config templates and next commands', () => {
    const envelope = buildInspectQuoteReadyProductEnvelope({
      globalFlags: { help: false, json: true, orgAlias: 'ARMAF', failOn: undefined, output: undefined, verbose: false },
      commandFlags: {
        pricebookId: '01sxx',
        productId: '01txx',
        terms: [],
        catalogId: null,
        accountId: null,
        productSellingModelId: null,
        includeRaw: false
      },
      discoveryResult: null,
      catalogConfigResult: catalogPrimitive('ok', { requiredAttribute: true, requiredComponent: true })
    });

    expect(envelope.command).toBe('inspect-quote-ready-product');
    expect(envelope.status).toBe('ok');
    expect(envelope.result.readiness_status).toBe('needs_configuration');
    expect(envelope.result.quote_intent_line_template).toMatchObject({
      pricebook_entry_id: '01uxx',
      product_id: '01txx',
      quantity: 1
    });
    expect(envelope.result.config_choices_template).toMatchObject({
      attributes: { Detector: '<choose allowed value>' },
      componentSelections: { Console: ['<choose component product name or id>'] }
    });
    expect(envelope.summary.next_suggested_command).toBe('plan-product-config --org-alias <alias> --product-config product-config.json --choices choices.json');
  });

  it('uses product discovery for term input and inspects the one usable candidate', async () => {
    const writes: string[] = [];
    const executeDiscoverProducts = vi.fn(async () => discoveryPrimitive([candidate('01txx', 'DR suite')]));
    const executeProductCatalogConfig = vi.fn(async () => catalogPrimitive('ok'));
    const result = await runInspectQuoteReadyProductCommand(
      ['--pricebook-id', '01sxx', '--term', 'DR suite'],
      { help: false, json: true, orgAlias: 'ARMAF', failOn: undefined, output: undefined, verbose: false },
      {
        stdout: { write: (message: string) => void writes.push(message) },
        stderr: { write: () => undefined }
      },
      {
        executeDiscoverProducts,
        executeProductCatalogConfig
      }
    );

    expect(result.exitCode).toBe(0);
    expect(executeDiscoverProducts).toHaveBeenCalledWith(expect.objectContaining({
      orgAlias: 'ARMAF',
      pricebookId: '01sxx',
      terms: ['DR suite']
    }));
    expect(executeProductCatalogConfig).toHaveBeenCalledWith(expect.objectContaining({
      productId: '01txx',
      pricebookId: '01sxx'
    }));
    const output = JSON.parse(writes.join('')) as { command: string; result: { readiness_status: string } };
    expect(output.command).toBe('inspect-quote-ready-product');
    expect(output.result.readiness_status).toBe('ready');
  });

  it('does not inspect catalog config when term discovery is ambiguous', async () => {
    const executeProductCatalogConfig = vi.fn(async () => catalogPrimitive('ok'));
    const result = await runInspectQuoteReadyProductCommand(
      ['--pricebook-id', '01sxx', '--term', 'DR'],
      { help: false, json: false, orgAlias: 'ARMAF', failOn: undefined, output: undefined, verbose: false },
      {
        stdout: { write: () => undefined },
        stderr: { write: () => undefined }
      },
      {
        executeDiscoverProducts: vi.fn(async () => discoveryPrimitive([
          candidate('01txx', 'DR suite'),
          candidate('01tyy', 'DR portable')
        ])),
        executeProductCatalogConfig
      }
    );

    expect(result.exitCode).toBe(0);
    expect(result.envelope.result.readiness_status).toBe('ambiguous_product');
    expect(result.envelope.result.product_match.candidates).toHaveLength(2);
    expect(executeProductCatalogConfig).not.toHaveBeenCalled();
  });
});

function discoveryPrimitive(candidates: ProductDiscoveryCandidate[]): ProductDiscoveryPrimitiveResult {
  return {
    status: candidates.length > 0 ? 'ok' : 'no_match',
    result: {
      strategy: 'soql_fallback',
      terms: ['DR suite'],
      candidates,
      omitted_count: 0
    },
    warnings: [],
    errors: [],
    evidence: []
  };
}

function candidate(productId: string, name: string): ProductDiscoveryCandidate {
  return {
    product_id: productId,
    name,
    product_code: null,
    node_type: null,
    pricebook_entry_id: '01uxx',
    pricebook_id: '01sxx',
    match_reason: 'test candidate',
    confidence: 'medium',
    usable: true,
    blockers: []
  };
}

function catalogPrimitive(
  status: ProductCatalogConfigPrimitiveResult['status'],
  options: { requiredAttribute?: boolean; requiredComponent?: boolean } = {}
): ProductCatalogConfigPrimitiveResult {
  return {
    status,
    result: {
      product_config: {
        product: {
          id: '01txx',
          name: 'DR suite',
          code: 'DR',
          type: null,
          pricebook_id: '01sxx',
          pricebook_entry_id: '01uxx'
        },
        attributes: [],
        component_groups: [],
        runtime_validation_available_pre_quote: false
      },
      product_identity: {
        product_id: '01txx',
        product_name: 'DR suite',
        product_code: 'DR',
        product_type: null,
        pricebook_id: '01sxx',
        pricebook_entry_id: '01uxx'
      },
      config_summary: {
        required_attributes: options.requiredAttribute
          ? [{
            id: '0vaxx',
            name: 'Detector',
            code: null,
            required: true,
            values: [{
              id: '0vavx',
              name: 'Digital',
              display_value: 'Digital',
              text_value: 'Digital',
              code: null
            }]
          }]
          : [],
        optional_attributes: [],
        component_groups: [{
          id: '0vcxx',
          name: 'Console',
          code: null,
          min_cardinality: options.requiredComponent ? 1 : 0,
          max_cardinality: 1,
          child_options: [{
            product_id: '01tchild',
            product_name: 'Clinical Console',
            product_code: 'CONSOLE',
            related_component_id: '0vrxx',
            required: options.requiredComponent === true,
            default: true,
            min_quantity: 1,
            max_quantity: 1
          }]
        }],
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
