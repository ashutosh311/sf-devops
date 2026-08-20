import { describe, expect, it, vi } from 'vitest';

import {
  PRODUCT_CONFIGURE_ROUTE,
  buildConfigureBody,
  buildQuoteLineAttributesSoql,
  buildQuoteLineRelationshipsSoql,
  executeInspectProductConfig,
  executeValidateProductConfig
} from '../../src/primitives/product-config-runtime';

describe('product config runtime primitive', () => {
  it('calls configure for an existing quote line and reports runtime messages', async () => {
    const invokeSfRestWrite = vi.fn(async () => ({
      ok: true as const,
      classification: 'ok' as const,
      path: PRODUCT_CONFIGURE_ROUTE,
      method: 'POST' as const,
      body: '{}',
      cliPath: '/usr/local/bin/sf',
      data: {
        transactionContext: { contextId: 'ctx-1' },
        messages: [
          {
            category: 'Configuration',
            messageType: 'Error',
            message: 'Detector Options requires exactly one selection.',
            primaryRecordId: '0QLxx'
          }
        ],
        catalogProducts: [{ id: 'prod-1' }]
      },
      exitCode: 0,
      stdout: '{}',
      stderr: ''
    }));

    const result = await executeInspectProductConfig({
      orgAlias: 'ARMAF',
      quoteId: '0Q0xx',
      lineId: '0QLxx',
      invokeSfRestWrite
    });

    expect(invokeSfRestWrite).toHaveBeenCalledWith(expect.objectContaining({
      path: PRODUCT_CONFIGURE_ROUTE,
      method: 'POST',
      body: expect.objectContaining({
        transactionId: '0Q0xx',
        transactionLineId: '0QLxx',
        configuratorOptions: expect.objectContaining({
          returnProductCatalogData: true,
          executeConfigurationRules: true
        })
      })
    }));
    expect(result.status).toBe('warn');
    expect(result.result.context_id).toBe('ctx-1');
    expect(result.result.messages[0]).toMatchObject({
      message: 'Detector Options requires exactly one selection.',
      primary_record_id: '0QLxx'
    });
  });

  it('maps headless configurator failures to unsupported', async () => {
    const result = await executeInspectProductConfig({
      orgAlias: 'ARMAF',
      quoteId: '0Q0xx',
      lineId: '0QLxx',
      invokeSfRestWrite: vi.fn(async () => ({
        ok: false as const,
        classification: 'server_error' as const,
        message: 'IHeadlessConfiguratorFamily is not available',
        path: PRODUCT_CONFIGURE_ROUTE,
        method: 'POST' as const,
        body: '{}',
        cliPath: '/usr/local/bin/sf',
        exitCode: 1,
        stdout: '',
        stderr: 'IHeadlessConfiguratorFamily is not available'
      }))
    });

    expect(result.status).toBe('unsupported');
  });

  it('reads persisted attributes and relationships for validation proof', async () => {
    const invokeSfJson = vi.fn(async (options) => {
      const query = String(options.args[5]);
      if (query.includes('FROM QuoteLineItemAttribute')) {
        return sfQuery([
          {
            Id: '0vaxx',
            QuoteLineItemId: '0QLxx',
            AttributeName: 'Detector Size',
            AttributeValue: '10x12'
          }
        ]);
      }
      return sfQuery([
        {
          Id: '0rlxx',
          MainItemId: '0QLxx',
          AssociatedItemId: '0QLchild',
          AssociatedItem: { Name: 'Wireless DR detector 10x12' }
        }
      ]);
    });

    const result = await executeValidateProductConfig({
      orgAlias: 'ARMAF',
      quoteId: '0Q0xx',
      lineIds: ['0QLxx'],
      invokeSfJson
    });

    expect(result.status).toBe('ok');
    expect(result.result.persisted_attributes).toHaveLength(1);
    expect(result.result.persisted_relationships).toHaveLength(1);
    expect(buildQuoteLineAttributesSoql('0Q0xx', ['0QLxx'])).toContain("QuoteLineItem.QuoteId = '0Q0xx'");
    expect(buildQuoteLineRelationshipsSoql('0Q0xx', ['0QLxx'])).toContain("QuoteId = '0Q0xx' AND MainQuoteLineId IN ('0QLxx')");
  });

  it('builds the compact configure request body', () => {
    expect(buildConfigureBody({
      orgAlias: 'ARMAF',
      quoteId: '0Q0xx',
      lineId: '0QLxx',
      accountId: '001xx'
    })).toMatchObject({
      transactionId: '0Q0xx',
      transactionLineId: '0QLxx',
      qualificationContext: { accountId: '001xx' }
    });
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
