import { describe, expect, it, vi } from 'vitest';

import {
  buildCreateQuoteEnvelope,
  parseCreateQuoteFlags,
  runCreateQuoteCommand
} from '../../src/commands/create-quote';
import type { QuoteMutationPrimitiveResult } from '../../src/primitives/quote-mutations';

describe('create-quote command', () => {
  it('parses dry-run quote fields by default', async () => {
    await expect(parseCreateQuoteFlags([
      '--name',
      'ACME Quote',
      '--quote-account-id',
      '001xx',
      '--opportunity-id',
      '006xx',
      '--pricebook-id',
      '01sxx',
      '--field',
      'ProposalDuration__c=Short'
    ])).resolves.toMatchObject({
      mode: 'dry_run',
      quote: {
        name: 'ACME Quote',
        quoteAccountId: '001xx',
        opportunityId: '006xx',
        pricebook2Id: '01sxx',
        extraFields: {
          ProposalDuration__c: 'Short'
        }
      }
    });
  });

  it('builds a mutation envelope with snapshot-quote as the next command', () => {
    const envelope = buildCreateQuoteEnvelope({
      globalFlags: { help: false, json: true, orgAlias: 'ARMAF', failOn: undefined, output: undefined, verbose: false },
      commandFlags: { mode: 'dry_run', quote: { name: 'ACME Quote' } },
      primitiveResult: primitive('ok')
    });

    expect(envelope.command).toBe('create-quote');
    expect(envelope.summary.next_suggested_command).toBe('snapshot-quote');
    expect(envelope.result).toMatchObject({
      plan: {
        mode: 'dry_run'
      }
    });
  });

  it('runs with an injectable primitive and writes JSON output', async () => {
    const writes: string[] = [];
    const result = await runCreateQuoteCommand(
      ['--name', 'ACME Quote'],
      { help: false, json: true, orgAlias: 'ARMAF', failOn: undefined, output: undefined, verbose: false },
      {
        stdout: { write: (message: string) => void writes.push(message) },
        stderr: { write: () => undefined }
      },
      {
        executeCreateQuote: vi.fn(async () => primitive('ok'))
      }
    );

    expect(result.exitCode).toBe(0);
    expect(JSON.parse(writes.join('')).command).toBe('create-quote');
  });
});

function primitive(status: QuoteMutationPrimitiveResult['status']): QuoteMutationPrimitiveResult {
  return {
    status,
    result: {
      plan: {
        mode: 'dry_run',
        route: '/services/data/v66.0/connect/rev/sales-transaction/actions/place',
        graph: { graph: { records: [] } },
        validation: [],
        expected_verification_commands: ['snapshot-quote']
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
