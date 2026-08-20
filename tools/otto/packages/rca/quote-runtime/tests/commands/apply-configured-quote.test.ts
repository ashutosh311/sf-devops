import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import { describe, expect, it, vi } from 'vitest';

import {
  buildConfiguredQuoteRecords,
  runApplyConfiguredQuoteCommand
} from '../../src/commands/apply-configured-quote';
import type { QuoteMutationPrimitiveResult } from '../../src/primitives/quote-mutations';

describe('apply-configured-quote command', () => {
  it('assembles quote, line, and attribute records in one PST graph', () => {
    const records = buildConfiguredQuoteRecords(quoteIntent(), {
      pst_plan: {
        quote_line_attributes: [attributeRecord()]
      }
    });

    expect(records.map((record) => record.record.attributes.type)).toEqual([
      'Quote',
      'QuoteLineItem',
      'QuoteLineItemAttribute'
    ]);
    expect(records[0].record).toMatchObject({
      Name: 'Patterson DR suite quote',
      QuoteAccountId: '001xx',
      OpportunityId: '006xx',
      Pricebook2Id: '01sxx'
    });
    expect(records[1].record).toMatchObject({
      QuoteId: '@{quote1.id}',
      PricebookEntryId: '01uxx',
      Product2Id: '01txx',
      Quantity: 1
    });
    expect(records[2].record).toMatchObject({
      QuoteLineItemId: '@{line1.id}',
      AttributeDefinitionId: 'attr-detector',
      AttributePicklistValueId: 'value-10x12',
      AttributeValue: '10x12'
    });
  });

  it('accepts a full plan-product-config envelope as the config-plan artifact', async () => {
    const tempDir = mkdtempSync(join(tmpdir(), 'apply-configured-quote-'));
    const quoteIntentPath = join(tempDir, 'quote-intent.json');
    const configPlanPath = join(tempDir, 'config-plan-envelope.json');
    const executePstGraphMutation = vi.fn(async () => mutationResult());

    try {
      writeFileSync(quoteIntentPath, JSON.stringify(quoteIntent()), 'utf8');
      writeFileSync(configPlanPath, JSON.stringify({
        command: 'plan-product-config',
        result: {
          pst_plan: {
            quote_line_attributes: [attributeRecord()]
          }
        }
      }), 'utf8');

      const result = await runApplyConfiguredQuoteCommand(
        ['--quote-intent', quoteIntentPath, '--config-plan', configPlanPath],
        { help: false, json: true, orgAlias: 'ARMAF', failOn: undefined, output: undefined, verbose: false },
        {
          stdout: { write: () => undefined },
          stderr: { write: () => undefined }
        },
        { executePstGraphMutation }
      );

      expect(result.exitCode).toBe(0);
      expect(result.envelope.warnings).toContain('apply-configured-quote creates a new configured quote. Do not use it to patch an existing target quote; use pst-apply-quote-intent when existing-quote mutation is required.');
      expect(executePstGraphMutation).toHaveBeenCalledWith(expect.objectContaining({
        mode: 'dry_run',
        records: expect.arrayContaining([
          expect.objectContaining({
            record: expect.objectContaining({
              QuoteLineItemId: '@{line1.id}'
            })
          })
        ])
      }));
    } finally {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });
});

function quoteIntent() {
  return {
    account_id: '001xx',
    opportunity_id: '006xx',
    pricebook_id: '01sxx',
    quote: {
      name: 'Patterson DR suite quote',
      start_date: '2026-05-01'
    },
    lines: [
      {
        product_id: '01txx',
        pricebook_entry_id: '01uxx',
        quantity: 1
      }
    ]
  };
}

function attributeRecord() {
  return {
    referenceId: 'attribute1',
    record: {
      attributes: {
        type: 'QuoteLineItemAttribute' as const,
        method: 'POST' as const
      },
      QuoteLineItemId: '@{line1.id}',
      AttributeDefinitionId: 'attr-detector',
      AttributePicklistValueId: 'value-10x12',
      AttributeValue: '10x12'
    }
  };
}

function mutationResult(): QuoteMutationPrimitiveResult {
  return {
    status: 'ok',
    result: {
      plan: {
        mode: 'dry_run',
        route: '/services/data/v66.0/connect/rev/sales-transaction/actions/place',
        graph: { graph: { records: [] } },
        validation: [],
        expected_verification_commands: []
      },
      execution: {
        executed: false,
        response: null
      }
    },
    warnings: [],
    errors: [],
    evidence: []
  };
}
