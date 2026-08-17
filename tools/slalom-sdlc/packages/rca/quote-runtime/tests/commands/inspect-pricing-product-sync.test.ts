import { describe, expect, it, vi } from 'vitest';

import {
  parseInspectPricingProductSyncFlags,
  renderInspectPricingProductSyncHelp,
  runInspectPricingProductSyncCommand
} from '../../src/commands/inspect-pricing-product-sync';
import type { PricingProductSyncPrimitiveResult } from '../../src/primitives/pricing-product-sync';

describe('inspect-pricing-product-sync command', () => {
  it('parses optional preflight flags', async () => {
    await expect(parseInspectPricingProductSyncFlags(['--include-index-logs', '--sample-limit', '10'])).resolves.toEqual({
      includeIndexLogs: true,
      sampleLimit: 10
    });
  });

  it('documents the read-only sync preflight contract', () => {
    expect(renderInspectPricingProductSyncHelp()).toContain('quote-runtime inspect-pricing-product-sync --org-alias <alias>');
    expect(renderInspectPricingProductSyncHelp()).toContain('Does not execute product index deploy, pricing data sync, decision-table refresh, or quote mutation.');
  });

  it('runs with an injectable primitive and writes JSON output', async () => {
    const writes: string[] = [];
    const result = await runInspectPricingProductSyncCommand(
      [],
      { help: false, json: true, orgAlias: 'ARMAF', failOn: undefined, output: undefined, verbose: false },
      {
        stdout: { write: (message: string) => void writes.push(message) },
        stderr: { write: () => undefined }
      },
      {
        executeInspectPricingProductSync: vi.fn(async () => primitive('ok'))
      }
    );

    expect(result.exitCode).toBe(0);
    expect(JSON.parse(writes.join('')).command).toBe('inspect-pricing-product-sync');
    expect(JSON.parse(writes.join('')).summary.primary_lane).toBe('pricing_product_sync_preflight');
  });
});

function primitive(status: PricingProductSyncPrimitiveResult['status']): PricingProductSyncPrimitiveResult {
  return {
    status,
    result: {
      documented: {
        product_catalog_index: {
          snapshot_collection_get: '/services/data/v66.0/connect/pcm/index/snapshots',
          snapshot_deploy_post: '/services/data/v66.0/connect/pcm/index/deploy',
          snapshot_error_get: '/services/data/v66.0/connect/pcm/index/error'
        },
        pricing_data_sync: {
          manual_setup_step: 'manual',
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
    errors: [],
    evidence: []
  };
}
