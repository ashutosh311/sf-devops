import { describe, expect, it, vi } from 'vitest';

import {
  parseRefreshDecisionTablesFlags,
  renderRefreshDecisionTablesHelp,
  runRefreshDecisionTablesCommand
} from '../../src/commands/refresh-decision-tables';
import type { DecisionTableRefreshPrimitiveResult } from '../../src/primitives/decision-table-refresh';

describe('refresh-decision-tables command', () => {
  it('parses dry-run default, execute mode, incremental mode, and repeated DecisionTable API names', async () => {
    await expect(parseRefreshDecisionTablesFlags(['--decision-table-api-name', 'A'])).resolves.toEqual({
      mode: 'dry_run',
      decisionTableApiNames: ['A']
    });
    await expect(parseRefreshDecisionTablesFlags([
      '--execute',
      '--incremental',
      '--decision-table-api-name',
      'A',
      '--decision-table-api-name',
      'B'
    ])).resolves.toEqual({
      mode: 'execute',
      incremental: true,
      decisionTableApiNames: ['A', 'B']
    });
  });

  it('documents the guarded decision table refresh boundary', () => {
    expect(renderRefreshDecisionTablesHelp()).toContain('quote-runtime refresh-decision-tables --org-alias <alias>');
    expect(renderRefreshDecisionTablesHelp()).toContain('standard refreshDecisionTable action');
  });

  it('runs with an injectable primitive and writes JSON output', async () => {
    const writes: string[] = [];
    const executeDecisionTableRefresh = vi.fn(async () => primitive('ok', false));
    const result = await runRefreshDecisionTablesCommand(
      ['--decision-table-api-name', 'Rate_Card_Entry_Decision_Table'],
      { help: false, json: true, orgAlias: 'ARMAF', failOn: undefined, output: undefined, verbose: false },
      {
        stdout: { write: (message: string) => void writes.push(message) },
        stderr: { write: () => undefined }
      },
      {
        executeDecisionTableRefresh
      }
    );

    expect(result.exitCode).toBe(0);
    expect(executeDecisionTableRefresh).toHaveBeenCalledWith({
      orgAlias: 'ARMAF',
      mode: 'dry_run',
      decisionTableApiNames: ['Rate_Card_Entry_Decision_Table']
    });
    expect(JSON.parse(writes.join('')).command).toBe('refresh-decision-tables');
    expect(JSON.parse(writes.join('')).summary.primary_lane).toBe('pricing_product_sync_preflight');
  });

  it('passes execute mode to the primitive only when --execute is present', async () => {
    const executeDecisionTableRefresh = vi.fn(async () => primitive('changed', true));
    const result = await runRefreshDecisionTablesCommand(
      ['--execute', '--decision-table-api-name', 'Rate_Card_Entry_Decision_Table'],
      { help: false, json: false, orgAlias: 'ARMAF', failOn: undefined, output: undefined, verbose: false },
      {
        stdout: { write: () => undefined },
        stderr: { write: () => undefined }
      },
      {
        executeDecisionTableRefresh
      }
    );

    expect(result.exitCode).toBe(0);
    expect(executeDecisionTableRefresh).toHaveBeenCalledWith({
      orgAlias: 'ARMAF',
      mode: 'execute',
      decisionTableApiNames: ['Rate_Card_Entry_Decision_Table']
    });
    expect(result.text).toContain('executed: true');
  });
});

function primitive(
  status: DecisionTableRefreshPrimitiveResult['status'],
  executed: boolean
): DecisionTableRefreshPrimitiveResult {
  return {
    status,
    result: {
      mode: executed ? 'execute' : 'dry_run',
      route: '/services/data/v66.0/actions/standard/refreshDecisionTable',
      method: 'POST',
      request_body: {
        inputs: [{ DecisionTableApiName: 'Rate_Card_Entry_Decision_Table' }]
      },
      preflight: {
        status: 'ok',
        action_available: true,
        action_inputs: ['DecisionTableApiName', 'isDecisionTableIncremental'],
        matching_sampled_tables: ['Rate_Card_Entry_Decision_Table'],
        sampled_missing_tables: []
      },
      execution: {
        executed,
        response: executed ? { outputs: [{ Status: 'Success' }] } : null
      },
      expected_verification_commands: ['inspect-pricing-product-sync --sample-limit 100']
    },
    warnings: [],
    errors: [],
    evidence: []
  };
}
