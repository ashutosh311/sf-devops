import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import { describe, expect, it, vi } from 'vitest';

import { runRepairProductConfigCommand } from '../../src/commands/repair-product-config';

describe('repair-product-config command', () => {
  it('dry-runs a plan-product-config envelope repair plan', async () => {
    const tempDir = mkdtempSync(join(tmpdir(), 'repair-product-config-'));
    const repairPath = join(tempDir, 'repair-plan.json');

    try {
      writeFileSync(repairPath, JSON.stringify(planEnvelope()), 'utf8');

      const result = await runRepairProductConfigCommand(
        ['--quote-id', '0Q0xx', '--line-id', '0QLparent', '--repair-plan', repairPath],
        { help: false, json: true, orgAlias: 'ARMAF', failOn: undefined, output: undefined, verbose: false },
        {
          stdout: { write: () => undefined },
          stderr: { write: () => undefined }
        }
      );

      expect(result.exitCode).toBe(0);
      expect(result.envelope.status).toBe('ok');
      expect(result.envelope.result).toMatchObject({
        quote_id: '0Q0xx',
        line_id: '0QLparent'
      });
    } finally {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it('executes narrow component cleanup with PST graph deletes, relationships before child lines', async () => {
    const tempDir = mkdtempSync(join(tmpdir(), 'repair-product-config-'));
    const repairPath = join(tempDir, 'repair-plan.json');
    const invokeSfJson = vi.fn(async (options) => {
      const args = options.args.join(' ');
      if (args.includes('FROM QuoteLineItem')) {
        return sfSuccess({
          records: [
            { Id: '0QLkeep', Product2Id: 'prod-10x12', ParentQuoteLineItemId: '0QLparent' },
            { Id: '0QLdelete', Product2Id: 'prod-14x17', ParentQuoteLineItemId: '0QLparent' },
            { Id: '0QLother', Product2Id: 'prod-workstation', ParentQuoteLineItemId: '0QLparent' }
          ]
        });
      }
      if (args.includes('FROM QuoteLineRelationship')) {
        return sfSuccess({
          records: [
            { Id: '0RLdelete', MainQuoteLineId: '0QLparent', AssociatedQuoteLineId: '0QLdelete' }
          ]
        });
      }
      if (args.includes('sobject describe') && args.includes('QuoteLineRelationship')) {
        return sfSuccess({
          fields: [
            { name: 'QuoteId', createable: true, updateable: false, nillable: false, defaultedOnCreate: false },
            { name: 'MainQuoteLineId', createable: true, updateable: false, nillable: false, defaultedOnCreate: false },
            { name: 'AssociatedQuoteLineId', createable: true, updateable: false, nillable: false, defaultedOnCreate: false },
            { name: 'ProductRelatedComponentId', createable: true, updateable: false, nillable: true, defaultedOnCreate: false }
          ]
        });
      }
      if (args.includes('sobject describe') && args.includes('QuoteLineItem')) {
        return sfSuccess({
          fields: [
            { name: 'QuoteId', createable: true, updateable: false, nillable: false, defaultedOnCreate: false },
            { name: 'PricebookEntryId', createable: true, updateable: false, nillable: false, defaultedOnCreate: false },
            { name: 'Product2Id', createable: true, updateable: false, nillable: false, defaultedOnCreate: false },
            { name: 'Quantity', createable: true, updateable: true, nillable: false, defaultedOnCreate: false }
          ]
        });
      }
      return sfSuccess({});
    });
    const invokeSfRestWrite = vi.fn(async () => ({
      ok: true as const,
      classification: 'ok' as const,
      path: '/services/data/v66.0/connect/rev/sales-transaction/actions/place',
      method: 'POST' as const,
      body: '{}',
      cliPath: '/usr/local/bin/sf',
      data: { accepted: true },
      exitCode: 0,
      stdout: '{}',
      stderr: ''
    }));

    try {
      writeFileSync(repairPath, JSON.stringify(planEnvelope()), 'utf8');

      const result = await runRepairProductConfigCommand(
        ['--quote-id', '0Q0xx', '--line-id', '0QLparent', '--repair-plan', repairPath, '--execute'],
        { help: false, json: true, orgAlias: 'ARMAF', failOn: undefined, output: undefined, verbose: false },
        {
          stdout: { write: () => undefined },
          stderr: { write: () => undefined }
        },
        { invokeSfJson, invokeSfRestWrite }
      );

      expect(result.envelope.status).toBe('changed');
      expect(result.envelope.result).toMatchObject({
        delete_relationship_ids: ['0RLdelete'],
        delete_line_ids: ['0QLdelete'],
        deleted_count: 2
      });
      expect(invokeSfRestWrite).toHaveBeenCalledWith(expect.objectContaining({
        orgAlias: 'ARMAF',
        path: '/services/data/v66.0/connect/rev/sales-transaction/actions/place',
        method: 'POST'
      }));
      const body = invokeSfRestWrite.mock.calls[0]?.[0].body as {
        graph: { records: Array<{ record: { attributes: { type: string; method: string; id: string } } }> };
      };
      expect(body.graph.records.map((record) => record.record.attributes)).toEqual([
        { type: 'QuoteLineRelationship', method: 'DELETE', id: '0RLdelete' },
        { type: 'QuoteLineItem', method: 'DELETE', id: '0QLdelete' }
      ]);
      expect(invokeSfJson.mock.calls.map((call) => call[0].args.join(' ')).some((args) => args.includes('data delete record'))).toBe(false);
    } finally {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });
});

function planEnvelope() {
  return {
    command: 'plan-product-config',
    result: {
      post_create_repair_plan: {
        actions: [
          {
            action: 'enforce_component_selection',
            component_group: 'Detector Options',
            keep_product_ids: ['prod-10x12'],
            candidate_product_ids: ['prod-10x12', 'prod-14x17'],
            min_quantity: 1,
            max_quantity: 1
          }
        ]
      }
    }
  };
}

function sfSuccess(data: unknown) {
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
