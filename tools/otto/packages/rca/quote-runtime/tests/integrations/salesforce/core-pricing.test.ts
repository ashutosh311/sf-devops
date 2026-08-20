import { describe, expect, it, vi } from 'vitest';

import {
  buildCorePricingApiExecutionLogPath,
  buildCorePricingWaterfallPath,
  buildPricingApiExecutionFamilyByExecutionKeySoql,
  buildPricingLineExecutionTypeKey,
  buildPricingProcessExecutionByExecutionTypeKeySoql,
  buildPricingProcessExecutionFamilyPath,
  buildPricingProcessExecutionRecordsByExecutionKeySoql,
  fetchCorePricingApiExecutionLog,
  fetchCorePricingWaterfall,
  fetchPricingApiExecutionFamilyByExecutionKey,
  fetchPricingProcessExecutionByExecutionTypeKey,
  fetchPricingProcessExecutionFamilyByExecutionKey,
  fetchPricingProcessExecutionRecordsByExecutionKey
} from '../../../src/integrations/salesforce/core-pricing';

describe('core-pricing integration seams', () => {
  it('builds the locked pricing trace selectors deterministically', () => {
    expect(buildPricingLineExecutionTypeKey('31156453661668', '0QLa5000003mqfJGAQ')).toBe(
      '31156453661668_0QLa5000003mqfJGAQ'
    );
    expect(buildPricingProcessExecutionByExecutionTypeKeySoql('31156453661668')).toBe(
      "SELECT Id, ExecutionKey, ExecutionType, ExecutionTypeKey, Status, Message, CreatedDate FROM PricingProcessExecution WHERE ExecutionTypeKey = '31156453661668' ORDER BY CreatedDate, Id"
    );
    expect(buildPricingApiExecutionFamilyByExecutionKeySoql('31156453364555')).toBe(
      "SELECT Id, ExecutionKey, ApiEndpoint, ApiType, Status, ReferenceKey, CreatedDate FROM PricingApiExecution WHERE ExecutionKey = '31156453364555' ORDER BY CreatedDate, Id"
    );
    expect(buildPricingProcessExecutionFamilyPath('31156453364555')).toBe(
      '/services/data/v66.0/connect/core-pricing/pricing-process-execution/31156453364555'
    );
    expect(buildPricingProcessExecutionRecordsByExecutionKeySoql('31156453364555')).toBe(
      "SELECT Id, ExecutionKey, ExecutionType, ExecutionTypeKey, Status, Message, CreatedDate FROM PricingProcessExecution WHERE ExecutionKey = '31156453364555' ORDER BY CreatedDate, Id"
    );
    expect(buildCorePricingApiExecutionLogPath('31156453365444')).toBe(
      '/services/data/v66.0/connect/core-pricing/apiexecutionlogs/31156453365444'
    );
    expect(buildCorePricingWaterfallPath('0QLa5000003mqfJGAQ', '40944695130560')).toBe(
      '/services/data/v66.0/connect/core-pricing/waterfall/0QLa5000003mqfJGAQ/40944695130560'
    );
  });

  it('fails fast on blank identifier inputs for path builders', () => {
    expect(() => buildPricingLineExecutionTypeKey('   ', '0QLa5000003mqfJGAQ')).toThrow(/pricingExecutionTypeKey must not be blank/i);
    expect(() => buildPricingLineExecutionTypeKey('31156453661668', '   ')).toThrow(/lineId must not be blank/i);
    expect(() => buildPricingProcessExecutionFamilyPath('   ')).toThrow(/executionKey must not be blank/i);
    expect(() => buildCorePricingWaterfallPath('0QLa5000003mqfJGAQ', '   ')).toThrow(/pricingExecutionId must not be blank/i);
    expect(() => buildCorePricingApiExecutionLogPath('   ')).toThrow(/apiExecutionTypeKey must not be blank/i);
  });

  it('queries the shared process family so the Api_Execution type key can be resolved', async () => {
    const invokeSfJson = vi.fn(async () => ({
      ok: true,
      classification: 'ok' as const,
      cliPath: '/usr/local/bin/sf',
      data: { records: [{
        Id: '1NZ-api', ExecutionKey: 'shared-001', ExecutionType: 'Api_Execution',
        ExecutionTypeKey: 'api-type-001', Status: 'Success', Message: null,
        CreatedDate: '2026-07-16T12:00:00.000+0000'
      }] },
      exitCode: 0,
      stdout: '',
      stderr: ''
    }));

    const result = await fetchPricingProcessExecutionRecordsByExecutionKey({
      orgAlias: 'ARM', executionKey: 'shared-001', invokeSfJson
    });

    expect(result.ok).toBe(true);
    if (result.ok) expect(result.data[0]?.ExecutionTypeKey).toBe('api-type-001');
  });

  it('fetches API input logs with the Api_Execution type key and preserves array payloads', async () => {
    const invokeSfRestGet = vi.fn(async () => ({
      ok: true,
      classification: 'ok' as const,
      path: '/services/data/v66.0/connect/core-pricing/apiexecutionlogs/api-type-001',
      cliPath: '/usr/local/bin/sf',
      data: [{ procedureName: 'Default Pricing Procedure', skipWaterfall: false }],
      exitCode: 0,
      stdout: '',
      stderr: ''
    }));

    const result = await fetchCorePricingApiExecutionLog({
      orgAlias: 'ARM', apiExecutionTypeKey: 'api-type-001', invokeSfRestGet
    });

    expect(invokeSfRestGet).toHaveBeenCalledWith({
      orgAlias: 'ARM',
      path: '/services/data/v66.0/connect/core-pricing/apiexecutionlogs/api-type-001'
    });
    expect(result).toMatchObject({
      ok: true,
      source: 'rest',
      data: [{ procedureName: 'Default Pricing Procedure', skipWaterfall: false }]
    });
  });

  it('queries pricing-process-execution rows by executionTypeKey through sf data query', async () => {
    const invokeSfJson = vi.fn(async () => ({
      ok: true,
      classification: 'ok' as const,
      cliPath: '/usr/local/bin/sf',
      data: {
        records: [
          {
            Id: '1NZa5000001OAIkGAO',
            ExecutionKey: '31156453364555',
            ExecutionType: 'Pricing',
            ExecutionTypeKey: '31156453661668',
            Status: 'Success',
            Message: null,
            CreatedDate: '2026-04-17T12:12:04.000+0000'
          }
        ]
      },
      exitCode: 0,
      stdout: '',
      stderr: ''
    }));

    const result = await fetchPricingProcessExecutionByExecutionTypeKey({
      orgAlias: 'ARM',
      executionTypeKey: '31156453661668',
      timeoutMs: 4000,
      invokeSfJson
    });

    expect(invokeSfJson).toHaveBeenCalledWith({
      args: [
        'data',
        'query',
        '--target-org',
        'ARM',
        '--query',
        "SELECT Id, ExecutionKey, ExecutionType, ExecutionTypeKey, Status, Message, CreatedDate FROM PricingProcessExecution WHERE ExecutionTypeKey = '31156453661668' ORDER BY CreatedDate, Id",
        '--json'
      ],
      orgAlias: 'ARM',
      timeoutMs: 4000
    });
    expect(result).toEqual({
      ok: true,
      classification: 'ok',
      source: 'soql',
      query:
        "SELECT Id, ExecutionKey, ExecutionType, ExecutionTypeKey, Status, Message, CreatedDate FROM PricingProcessExecution WHERE ExecutionTypeKey = '31156453661668' ORDER BY CreatedDate, Id",
      data: [
        {
          Id: '1NZa5000001OAIkGAO',
          ExecutionKey: '31156453364555',
          ExecutionType: 'Pricing',
          ExecutionTypeKey: '31156453661668',
          Status: 'Success',
          Message: null,
          CreatedDate: '2026-04-17T12:12:04.000+0000'
        }
      ]
    });
  });

  it('classifies malformed query payloads explicitly', async () => {
    const invokeSfJson = vi.fn(async () => ({
      ok: true,
      classification: 'ok' as const,
      cliPath: '/usr/local/bin/sf',
      data: { records: [42] },
      exitCode: 0,
      stdout: '',
      stderr: ''
    }));

    const result = await fetchPricingApiExecutionFamilyByExecutionKey({
      orgAlias: 'ARM',
      executionKey: '31156453364555',
      invokeSfJson
    });

    expect(result).toEqual({
      ok: false,
      classification: 'malformed_payload',
      source: 'soql',
      query:
        "SELECT Id, ExecutionKey, ApiEndpoint, ApiType, Status, ReferenceKey, CreatedDate FROM PricingApiExecution WHERE ExecutionKey = '31156453364555' ORDER BY CreatedDate, Id",
      message: 'Salesforce CLI returned an unexpected PricingApiExecution payload.'
    });
  });

  it('fetches pricing-process-execution family payloads through the shared rest seam', async () => {
    const invokeSfRestGet = vi.fn(async () => ({
      ok: true,
      classification: 'ok' as const,
      path: '/services/data/v66.0/connect/core-pricing/pricing-process-execution/31156453364555',
      cliPath: '/usr/local/bin/sf',
      data: {
        executionId: '31156453364555',
        executionTypes: ['Pricing', 'Api_Execution', 'Pricing_Line'],
        lineItems: [{ lineItemId: '0QLa5000003mqfJGAQ', status: 'Success' }]
      },
      exitCode: 0,
      stdout: '',
      stderr: ''
    }));

    const result = await fetchPricingProcessExecutionFamilyByExecutionKey({
      orgAlias: 'ARM',
      executionKey: '31156453364555',
      invokeSfRestGet
    });

    expect(invokeSfRestGet).toHaveBeenCalledWith({
      orgAlias: 'ARM',
      path: '/services/data/v66.0/connect/core-pricing/pricing-process-execution/31156453364555'
    });
    expect(result).toEqual({
      ok: true,
      classification: 'ok',
      source: 'rest',
      path: '/services/data/v66.0/connect/core-pricing/pricing-process-execution/31156453364555',
      data: {
        executionId: '31156453364555',
        executionTypes: ['Pricing', 'Api_Execution', 'Pricing_Line'],
        lineItems: [{ lineItemId: '0QLa5000003mqfJGAQ', status: 'Success' }]
      }
    });
  });

  it('queries pricing-api-execution family rows by executionKey', async () => {
    const invokeSfJson = vi.fn(async () => ({
      ok: true,
      classification: 'ok' as const,
      cliPath: '/usr/local/bin/sf',
      data: {
        records: [
          {
            Id: '1NIa5000001PHZlGAO',
            ExecutionKey: '31156453364555',
            ApiEndpoint: '/connect/core-pricing/price-contexts/',
            ApiType: 'Pricing',
            Status: 'Success',
            ReferenceKey: '31156453661668',
            CreatedDate: '2026-04-17T12:12:05.000+0000'
          }
        ]
      },
      exitCode: 0,
      stdout: '',
      stderr: ''
    }));

    const result = await fetchPricingApiExecutionFamilyByExecutionKey({
      orgAlias: 'ARM',
      executionKey: '31156453364555',
      invokeSfJson
    });

    expect(result).toEqual({
      ok: true,
      classification: 'ok',
      source: 'soql',
      query:
        "SELECT Id, ExecutionKey, ApiEndpoint, ApiType, Status, ReferenceKey, CreatedDate FROM PricingApiExecution WHERE ExecutionKey = '31156453364555' ORDER BY CreatedDate, Id",
      data: [
        {
          Id: '1NIa5000001PHZlGAO',
          ExecutionKey: '31156453364555',
          ApiEndpoint: '/connect/core-pricing/price-contexts/',
          ApiType: 'Pricing',
          Status: 'Success',
          ReferenceKey: '31156453661668',
          CreatedDate: '2026-04-17T12:12:05.000+0000'
        }
      ]
    });
  });

  it('fetches the waterfall payload by line id and pricing execution id', async () => {
    const invokeSfRestGet = vi.fn(async () => ({
      ok: true,
      classification: 'ok' as const,
      path: '/services/data/v66.0/connect/core-pricing/waterfall/0QLa5000003mqfJGAQ/40944695130560',
      cliPath: '/usr/local/bin/sf',
      data: {
        lineItemId: '0QLa5000003mqfJGAQ',
        pricingExecutionId: '40944695130560',
        waterfallElements: [
          { name: 'Formula Based Pricing', output: 15617 },
          { name: 'Attribute Based Pricing', output: 15600 }
        ]
      },
      exitCode: 0,
      stdout: '',
      stderr: ''
    }));

    const result = await fetchCorePricingWaterfall({
      orgAlias: 'ARM',
      lineId: '0QLa5000003mqfJGAQ',
      pricingExecutionId: '40944695130560',
      invokeSfRestGet
    });

    expect(invokeSfRestGet).toHaveBeenCalledWith({
      orgAlias: 'ARM',
      path: '/services/data/v66.0/connect/core-pricing/waterfall/0QLa5000003mqfJGAQ/40944695130560'
    });
    expect(result).toEqual({
      ok: true,
      classification: 'ok',
      source: 'rest',
      path: '/services/data/v66.0/connect/core-pricing/waterfall/0QLa5000003mqfJGAQ/40944695130560',
      data: {
        lineItemId: '0QLa5000003mqfJGAQ',
        pricingExecutionId: '40944695130560',
        waterfallElements: [
          { name: 'Formula Based Pricing', output: 15617 },
          { name: 'Attribute Based Pricing', output: 15600 }
        ]
      }
    });
  });

  it('keeps sf-cli auth failures compatible across the rest-backed helpers', async () => {
    const invokeSfRestGet = vi.fn(async () => ({
      ok: false,
      classification: 'auth' as const,
      path: '/services/data/v66.0/connect/core-pricing/waterfall/0QLa5000003mqfJGAQ/40944695130560',
      cliPath: '/usr/local/bin/sf',
      message: 'Org alias ARM is not authenticated.',
      exitCode: 1,
      stdout: '',
      stderr: 'not authenticated'
    }));

    const result = await fetchCorePricingWaterfall({
      orgAlias: 'ARM',
      lineId: '0QLa5000003mqfJGAQ',
      pricingExecutionId: '40944695130560',
      invokeSfRestGet
    });

    expect(result).toEqual({
      ok: false,
      classification: 'auth',
      source: 'rest',
      path: '/services/data/v66.0/connect/core-pricing/waterfall/0QLa5000003mqfJGAQ/40944695130560',
      message: 'Org alias ARM is not authenticated.'
    });
  });
});
