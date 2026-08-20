import { describe, expect, it, vi } from 'vitest';

import {
  executeInspectPricingProductSync,
  PRODUCT_INDEX_DEPLOY_PATH,
  PRODUCT_INDEX_SNAPSHOTS_PATH
} from '../../src/primitives/pricing-product-sync';

describe('pricing-product-sync primitive', () => {
  it('reads product index status/settings and decision-table sync status without execution calls', async () => {
    const invokeSfRestGet = vi.fn(async (options) => {
      if (options.path === PRODUCT_INDEX_SNAPSHOTS_PATH) {
        return restSuccess({
          statusCode: '200',
          snapshots: [
            {
              activationStatus: 'ACTIVE',
              snapshotIndexes: [
                {
                  lastBuildStatus: 'COMPLETED',
                  indexBuildType: 'FULL',
                  numberOfRecords: 23,
                  indexLogs: [
                    {
                      indexBuildStatus: 'COMPLETED',
                      indexBuildType: 'INCREMENTAL',
                      numberOfChanges: 15
                    }
                  ]
                }
              ]
            }
          ]
        });
      }
      return restSuccess({
        statusCode: '200',
        metadata: { activeLanguages: ['en_US'] },
        setting: { defaultLanguage: 'en_US', supportedLanguages: ['en_US'] }
      });
    });
    const invokeSfJson = vi.fn(async (options) => {
      const args = options.args as string[];
      if (args.includes('describe')) {
        return sfSuccess({
          queryable: true,
          fields: [
            'Id',
            'DeveloperName',
            'MasterLabel',
            'UsageType',
            'ExecutionType',
            'UploadStatus',
            'DownloadStatus',
            'IsIncrementalSyncEnabled',
            'HasIncrementalSyncFailed',
            'LastIncrementalSyncDate'
          ].map((name) => ({ name }))
        });
      }
      return sfSuccess({
        records: [
          {
            Id: '0lDxx',
            DeveloperName: 'Rate_Card_Entry_Decision_Table',
            UsageType: 'DefaultRating',
            IsIncrementalSyncEnabled: false,
            HasIncrementalSyncFailed: false
          },
          {
            Id: '0lDyy',
            DeveloperName: 'Price_Book_Entry_Decision_Table',
            UsageType: 'DefaultPricing',
            IsIncrementalSyncEnabled: true,
            HasIncrementalSyncFailed: false
          }
        ]
      });
    });

    const result = await executeInspectPricingProductSync({
      orgAlias: 'ARMAF',
      invokeSfJson,
      invokeSfRestGet
    });

    expect(result.status).toBe('ok');
    expect(result.result.org_proven.product_catalog_index.latest_index_status).toBe('COMPLETED');
    expect(result.result.org_proven.decision_tables.usage_types).toEqual(['DefaultPricing', 'DefaultRating']);
    expect(result.result.unknown.blockers.join(' ')).toContain(PRODUCT_INDEX_DEPLOY_PATH);
    expect(invokeSfRestGet).toHaveBeenCalledTimes(2);
    expect(invokeSfJson).toHaveBeenCalledTimes(2);
  });
});

function restSuccess<T>(data: T) {
  return {
    ok: true as const,
    classification: 'ok' as const,
    path: '/services/data/v66.0/connect/pcm/index/snapshots',
    cliPath: '/usr/local/bin/sf',
    data,
    exitCode: 0,
    stdout: '{}',
    stderr: ''
  };
}

function sfSuccess<T>(data: T) {
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
