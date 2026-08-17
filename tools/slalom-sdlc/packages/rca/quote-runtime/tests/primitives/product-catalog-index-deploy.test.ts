import { describe, expect, it, vi } from 'vitest';

import {
  executeProductCatalogIndexDeploy
} from '../../src/primitives/product-catalog-index-deploy';
import {
  PRODUCT_INDEX_DEPLOY_PATH,
  type PricingProductSyncPrimitiveResult
} from '../../src/primitives/pricing-product-sync';

describe('product-catalog-index-deploy primitive', () => {
  it('dry-runs by preflighting product index readiness without submitting the deploy route', async () => {
    const executeInspectPricingProductSync = vi.fn(async () => preflight('ok'));
    const invokeSfRestWrite = vi.fn(async () => writeSuccess({ id: 'job-1' }));

    const result = await executeProductCatalogIndexDeploy({
      orgAlias: 'ARMAF',
      mode: 'dry_run',
      executeInspectPricingProductSync,
      invokeSfRestWrite
    });

    expect(result.status).toBe('ok');
    expect(result.result.execution.executed).toBe(false);
    expect(result.result.route).toBe(PRODUCT_INDEX_DEPLOY_PATH);
    expect(result.result.preflight.product_index_status).toBe('COMPLETED');
    expect(result.result.expected_verification_commands).toContain('inspect-pricing-product-sync --include-index-logs');
    expect(invokeSfRestWrite).not.toHaveBeenCalled();
  });

  it('executes the documented product catalog index deploy POST after preflight', async () => {
    const executeInspectPricingProductSync = vi.fn(async () => preflight('ok'));
    const invokeSfRestWrite = vi.fn(async () => writeSuccess({ status: 'ACCEPTED' }));

    const result = await executeProductCatalogIndexDeploy({
      orgAlias: 'ARMAF',
      mode: 'execute',
      executeInspectPricingProductSync,
      invokeSfRestWrite
    });

    expect(result.status).toBe('changed');
    expect(result.result.execution.executed).toBe(true);
    expect(result.result.execution.response).toEqual({ status: 'ACCEPTED' });
    expect(invokeSfRestWrite).toHaveBeenCalledWith({
      orgAlias: 'ARMAF',
      path: PRODUCT_INDEX_DEPLOY_PATH,
      method: 'POST',
      body: {}
    });
  });

  it('does not submit the deploy route when preflight is unsupported', async () => {
    const executeInspectPricingProductSync = vi.fn(async () => preflight('unsupported'));
    const invokeSfRestWrite = vi.fn(async () => writeSuccess({ status: 'ACCEPTED' }));

    const result = await executeProductCatalogIndexDeploy({
      orgAlias: 'ARMAF',
      mode: 'execute',
      executeInspectPricingProductSync,
      invokeSfRestWrite
    });

    expect(result.status).toBe('unsupported');
    expect(result.result.execution.executed).toBe(false);
    expect(invokeSfRestWrite).not.toHaveBeenCalled();
  });

  it('reports deploy POST failures without marking execution changed', async () => {
    const result = await executeProductCatalogIndexDeploy({
      orgAlias: 'ARMAF',
      mode: 'execute',
      executeInspectPricingProductSync: vi.fn(async () => preflight('ok')),
      invokeSfRestWrite: vi.fn(async () => ({
        ok: false as const,
        classification: 'cli_error' as const,
        path: PRODUCT_INDEX_DEPLOY_PATH,
        cliPath: '/usr/local/bin/sf',
        message: 'POST failed',
        exitCode: 1,
        stdout: '',
        stderr: 'POST failed'
      }))
    });

    expect(result.status).toBe('error');
    expect(result.result.execution.executed).toBe(false);
    expect(result.errors).toEqual(['POST failed']);
  });
});

function preflight(status: PricingProductSyncPrimitiveResult['status']): PricingProductSyncPrimitiveResult {
  return {
    status,
    result: {
      documented: {
        product_catalog_index: {
          snapshot_collection_get: '/services/data/v66.0/connect/pcm/index/snapshots',
          snapshot_deploy_post: PRODUCT_INDEX_DEPLOY_PATH,
          snapshot_error_get: '/services/data/v66.0/connect/pcm/index/error'
        },
        pricing_data_sync: {
          manual_setup_step: 'Pricing Data Sync',
          execution_api_status: 'unknown'
        }
      },
      repo_proven: {
        rest_helper: 'rest.ts',
        command_scope: 'read-only'
      },
      org_proven: {
        product_catalog_index: {
          status: 'ok',
          path: '/services/data/v66.0/connect/pcm/index/snapshots',
          status_code: 200,
          snapshot_count: 1,
          active_snapshot_present: true,
          index_count: 1,
          latest_index_status: 'COMPLETED',
          latest_index_build_type: 'FULL',
          latest_index_record_count: 23,
          latest_log_status: 'COMPLETED',
          latest_log_build_type: 'INCREMENTAL',
          latest_log_change_count: 15,
          message: null
        },
        product_catalog_index_settings: {
          status: 'ok',
          path: '/services/data/v66.0/connect/pcm/index/setting',
          status_code: 200,
          default_language: 'en_US',
          supported_languages: ['en_US'],
          active_languages: ['en_US'],
          message: null
        },
        decision_tables: {
          status: 'ok',
          queryable: true,
          fields_present: ['Id'],
          fields_missing: [],
          sampled_count: 1,
          usage_types: ['DefaultRating'],
          rating_tables: ['Rate_Card_Entry_Decision_Table'],
          pricing_tables: [],
          incremental_sync_enabled_count: 0,
          incremental_sync_failed_count: 0,
          upload_statuses: [],
          download_statuses: [],
          message: null
        }
      },
      unknown: {
        blockers: ['pricing sync execution is unknown']
      },
      guardrails: ['do not execute sync jobs']
    },
    warnings: [],
    errors: status === 'unsupported' ? ['preflight unsupported'] : [],
    evidence: []
  };
}

function writeSuccess<T>(data: T) {
  return {
    ok: true as const,
    classification: 'ok' as const,
    path: PRODUCT_INDEX_DEPLOY_PATH,
    cliPath: '/usr/local/bin/sf',
    data,
    exitCode: 0,
    stdout: JSON.stringify(data),
    stderr: ''
  };
}
