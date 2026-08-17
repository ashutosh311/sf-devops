import { describe, expect, it, vi } from 'vitest';

import {
  parseDeployProductCatalogIndexFlags,
  renderDeployProductCatalogIndexHelp,
  runDeployProductCatalogIndexCommand
} from '../../src/commands/deploy-product-catalog-index';
import type { ProductCatalogIndexDeployPrimitiveResult } from '../../src/primitives/product-catalog-index-deploy';

describe('deploy-product-catalog-index command', () => {
  it('parses dry-run default and execute mode', async () => {
    await expect(parseDeployProductCatalogIndexFlags([])).resolves.toEqual({ mode: 'dry_run' });
    await expect(parseDeployProductCatalogIndexFlags(['--execute'])).resolves.toEqual({ mode: 'execute' });
  });

  it('documents the guarded product index deploy boundary', () => {
    expect(renderDeployProductCatalogIndexHelp()).toContain('quote-runtime deploy-product-catalog-index --org-alias <alias>');
    expect(renderDeployProductCatalogIndexHelp()).toContain('use refresh-decision-tables for DecisionTable refresh');
  });

  it('runs with an injectable primitive and writes JSON output', async () => {
    const writes: string[] = [];
    const executeProductCatalogIndexDeploy = vi.fn(async () => primitive('ok', false));
    const result = await runDeployProductCatalogIndexCommand(
      [],
      { help: false, json: true, orgAlias: 'ARMAF', failOn: undefined, output: undefined, verbose: false },
      {
        stdout: { write: (message: string) => void writes.push(message) },
        stderr: { write: () => undefined }
      },
      {
        executeProductCatalogIndexDeploy
      }
    );

    expect(result.exitCode).toBe(0);
    expect(executeProductCatalogIndexDeploy).toHaveBeenCalledWith({ orgAlias: 'ARMAF', mode: 'dry_run' });
    expect(JSON.parse(writes.join('')).command).toBe('deploy-product-catalog-index');
    expect(JSON.parse(writes.join('')).summary.primary_lane).toBe('pricing_product_sync_preflight');
  });

  it('passes execute mode to the primitive only when --execute is present', async () => {
    const executeProductCatalogIndexDeploy = vi.fn(async () => primitive('changed', true));
    const result = await runDeployProductCatalogIndexCommand(
      ['--execute'],
      { help: false, json: false, orgAlias: 'ARMAF', failOn: undefined, output: undefined, verbose: false },
      {
        stdout: { write: () => undefined },
        stderr: { write: () => undefined }
      },
      {
        executeProductCatalogIndexDeploy
      }
    );

    expect(result.exitCode).toBe(0);
    expect(executeProductCatalogIndexDeploy).toHaveBeenCalledWith({ orgAlias: 'ARMAF', mode: 'execute' });
    expect(result.text).toContain('executed: true');
  });
});

function primitive(
  status: ProductCatalogIndexDeployPrimitiveResult['status'],
  executed: boolean
): ProductCatalogIndexDeployPrimitiveResult {
  return {
    status,
    result: {
      mode: executed ? 'execute' : 'dry_run',
      route: '/services/data/v66.0/connect/pcm/index/deploy',
      method: 'POST',
      request_body: {},
      preflight: {
        status: 'ok',
        product_index_status: 'COMPLETED',
        active_snapshot_present: true,
        blockers: ['pricing sync execution is unknown']
      },
      execution: {
        executed,
        response: executed ? { status: 'ACCEPTED' } : null
      },
      expected_verification_commands: ['inspect-pricing-product-sync --include-index-logs']
    },
    warnings: [],
    errors: [],
    evidence: []
  };
}
