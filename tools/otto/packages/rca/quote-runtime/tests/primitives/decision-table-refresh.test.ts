import { describe, expect, it, vi } from 'vitest';

import {
  executeDecisionTableRefresh
} from '../../src/primitives/decision-table-refresh';
import {
  DECISION_TABLE_REFRESH_ACTION_PATH,
  PRODUCT_INDEX_DEPLOY_PATH,
  type PricingProductSyncPrimitiveResult
} from '../../src/primitives/pricing-product-sync';

describe('decision-table-refresh primitive', () => {
  it('dry-runs by preflighting action metadata and DecisionTable readback without POSTing', async () => {
    const executeInspectPricingProductSync = vi.fn(async () => preflight('ok'));
    const invokeSfRestGet = vi.fn(async () => actionDescribe());
    const invokeSfRestWrite = vi.fn(async () => writeSuccess({ status: 'ACCEPTED' }));

    const result = await executeDecisionTableRefresh({
      orgAlias: 'ARMAF',
      mode: 'dry_run',
      decisionTableApiNames: ['Rate_Card_Entry_Decision_Table'],
      executeInspectPricingProductSync,
      invokeSfRestGet,
      invokeSfRestWrite
    });

    expect(result.status).toBe('ok');
    expect(result.result.route).toBe(DECISION_TABLE_REFRESH_ACTION_PATH);
    expect(result.result.request_body).toEqual({
      inputs: [{ DecisionTableApiName: 'Rate_Card_Entry_Decision_Table' }]
    });
    expect(result.result.preflight.action_available).toBe(true);
    expect(result.result.preflight.matching_sampled_tables).toEqual(['Rate_Card_Entry_Decision_Table']);
    expect(result.result.execution.executed).toBe(false);
    expect(invokeSfRestWrite).not.toHaveBeenCalled();
  });

  it('executes the standard refreshDecisionTable action when requested', async () => {
    const invokeSfRestWrite = vi.fn(async () => writeSuccess({ outputs: [{ Status: 'Success' }] }));

    const result = await executeDecisionTableRefresh({
      orgAlias: 'ARMAF',
      mode: 'execute',
      decisionTableApiNames: ['Rate_Card_Entry_Decision_Table'],
      incremental: true,
      executeInspectPricingProductSync: vi.fn(async () => preflight('ok')),
      invokeSfRestGet: vi.fn(async () => actionDescribe()),
      invokeSfRestWrite
    });

    expect(result.status).toBe('changed');
    expect(result.result.execution.executed).toBe(true);
    expect(invokeSfRestWrite).toHaveBeenCalledWith({
      orgAlias: 'ARMAF',
      path: DECISION_TABLE_REFRESH_ACTION_PATH,
      method: 'POST',
      body: {
        inputs: [{
          DecisionTableApiName: 'Rate_Card_Entry_Decision_Table',
          isDecisionTableIncremental: true
        }]
      }
    });
  });

  it('does not POST when the refresh action is unavailable', async () => {
    const invokeSfRestWrite = vi.fn(async () => writeSuccess({ outputs: [{ Status: 'Success' }] }));

    const result = await executeDecisionTableRefresh({
      orgAlias: 'ARMAF',
      mode: 'execute',
      decisionTableApiNames: ['Rate_Card_Entry_Decision_Table'],
      executeInspectPricingProductSync: vi.fn(async () => preflight('ok')),
      invokeSfRestGet: vi.fn(async () => ({
        ok: false as const,
        classification: 'cli_error' as const,
        path: DECISION_TABLE_REFRESH_ACTION_PATH,
        cliPath: '/usr/local/bin/sf',
        message: 'action not found',
        exitCode: 1,
        stdout: '',
        stderr: 'action not found'
      })),
      invokeSfRestWrite
    });

    expect(result.status).toBe('unsupported');
    expect(result.errors).toEqual(['action not found']);
    expect(result.result.execution.executed).toBe(false);
    expect(invokeSfRestWrite).not.toHaveBeenCalled();
  });

  it('reports refresh POST failures without marking execution changed', async () => {
    const result = await executeDecisionTableRefresh({
      orgAlias: 'ARMAF',
      mode: 'execute',
      decisionTableApiNames: ['Rate_Card_Entry_Decision_Table'],
      executeInspectPricingProductSync: vi.fn(async () => preflight('ok')),
      invokeSfRestGet: vi.fn(async () => actionDescribe()),
      invokeSfRestWrite: vi.fn(async () => ({
        ok: false as const,
        classification: 'cli_error' as const,
        path: DECISION_TABLE_REFRESH_ACTION_PATH,
        method: 'POST' as const,
        body: '{}',
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

function actionDescribe() {
  return {
    ok: true as const,
    classification: 'ok' as const,
    path: DECISION_TABLE_REFRESH_ACTION_PATH,
    cliPath: '/usr/local/bin/sf',
    data: {
      name: 'refreshDecisionTable',
      inputs: [
        { name: 'DecisionTableApiName', required: true, type: 'STRING' },
        { name: 'isDecisionTableIncremental', required: false, type: 'BOOLEAN' }
      ],
      outputs: [
        { name: 'Status', type: 'STRING' },
        { name: 'ErrorMessage', type: 'STRING' }
      ]
    },
    exitCode: 0,
    stdout: '{}',
    stderr: ''
  };
}

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
    path: DECISION_TABLE_REFRESH_ACTION_PATH,
    method: 'POST' as const,
    body: '{}',
    cliPath: '/usr/local/bin/sf',
    data,
    exitCode: 0,
    stdout: JSON.stringify(data),
    stderr: ''
  };
}
