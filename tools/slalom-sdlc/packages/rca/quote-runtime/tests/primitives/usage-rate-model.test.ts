import { describe, expect, it, vi } from 'vitest';

import {
  executeInspectUsageRateModel,
  USAGE_RATE_OBJECTS
} from '../../src/primitives/usage-rate-model';

describe('usage-rate-model primitive', () => {
  it('describes known usage/rate objects and queries counts plus samples from existing fields only', async () => {
    const invokeSfJson = vi.fn(async (options) => {
      const args = options.args as string[];
      if (args.includes('describe')) {
        const objectName = args[args.indexOf('--sobject') + 1];
        return success(describePayload(objectName));
      }
      const query = String(args[args.indexOf('--query') + 1]);
      if (query.includes('count()')) {
        return success({ totalSize: 2, records: [] });
      }
      return success({
        records: [
          {
            attributes: { type: 'UsageResource' },
            Id: '1BRxx',
            Name: 'API Calls',
            Code: 'API_CALLS',
            Category: 'Usage',
            Status: 'Active'
          }
        ]
      });
    });

    const result = await executeInspectUsageRateModel({
      orgAlias: 'ARMAF',
      includeSamples: true,
      productId: '01txx',
      pricebookId: '01sxx',
      invokeSfJson
    });

    expect(result.status).toBe('ok');
    expect(result.result.org_proven.object_coverage).toHaveLength(USAGE_RATE_OBJECTS.length);
    expect(result.result.org_proven.counts.UsageResource).toBe(2);
    expect(result.result.org_proven.object_coverage[0].samples[0]).not.toHaveProperty('attributes');
    expect(invokeSfJson).toHaveBeenCalledWith(expect.objectContaining({
      args: expect.arrayContaining(['sobject', 'describe', '--target-org', 'ARMAF'])
    }));
    expect(invokeSfJson).toHaveBeenCalledWith(expect.objectContaining({
      args: expect.arrayContaining(['data', 'query', '--target-org', 'ARMAF'])
    }));
  });

  it('keeps unavailable objects in coverage instead of failing the entire inspection', async () => {
    const invokeSfJson = vi.fn(async (options) => {
      const args = options.args as string[];
      const objectName = args[args.indexOf('--sobject') + 1];
      if (objectName === 'UsageResource') {
        return success(describePayload(objectName));
      }
      return {
        ok: false as const,
        classification: 'cli_error' as const,
        cliPath: '/usr/local/bin/sf',
        message: `The requested resource does not exist: ${objectName}`,
        exitCode: 1,
        stdout: '{}',
        stderr: ''
      };
    });

    const result = await executeInspectUsageRateModel({
      orgAlias: 'ARMAF',
      invokeSfJson
    });

    expect(result.status).toBe('warn');
    expect(result.result.org_proven.object_coverage.find((object) => object.object_api_name === 'UsageResource')?.available).toBe(true);
    expect(result.result.org_proven.object_coverage.find((object) => object.object_api_name === 'RateCard')?.available).toBe(false);
    expect(result.warnings.some((warning) => warning.includes('RateCard describe failed'))).toBe(true);
  });
});

function describePayload(objectName: string) {
  return {
    name: objectName,
    queryable: true,
    createable: true,
    updateable: true,
    keyPrefix: objectName === 'UsageResource' ? '1BR' : '1XX',
    fields: [
      'Id',
      'Name',
      'Code',
      'Category',
      'Status',
      'ProductId',
      'Pricebook2Id',
      'RateCardId',
      'RateCardEntryId',
      'UsageResourceId',
      'ProductSellingModelId',
      'Rate',
      'CreatedDate'
    ].map((name) => ({ name }))
  };
}

function success<T>(data: T) {
  return {
    ok: true as const,
    classification: 'ok' as const,
    cliPath: '/usr/local/bin/sf',
    data,
    exitCode: 0,
    stdout: '{}',
    stderr: ''
  };
}
