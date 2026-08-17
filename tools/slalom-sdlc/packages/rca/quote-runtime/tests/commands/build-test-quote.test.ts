import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import { describe, expect, it } from 'vitest';

import { parseBuildTestQuoteFlags } from '../../src/commands/build-test-quote';

describe('build-test-quote command', () => {
  it('parses the documented top-level quote_intent selector shape', async () => {
    const tempDir = mkdtempSync(join(tmpdir(), 'quote-intent-'));
    const inputPath = join(tempDir, 'quote-intent.json');

    try {
      writeFileSync(inputPath, JSON.stringify({
        account_id: '001xx',
        opportunity_id: '006xx',
        pricebook_id: '01sxx',
        quote: {
          name: 'ACME Quote',
          start_date: '2026-06-01',
          expirationDate: '2026-06-30'
        },
        lines: [
          {
            product_id: '01txx',
            pricebook_entry_id: '01uxx',
            quantity: 2,
            start_date: '2026-06-01'
          }
        ],
        pricing: {
          execute: true
        }
      }), 'utf8');

      await expect(parseBuildTestQuoteFlags(['--input', inputPath])).resolves.toMatchObject({
        mode: 'dry_run',
        inputPath,
        quote: {
          name: 'ACME Quote',
          quoteAccountId: '001xx',
          opportunityId: '006xx',
          pricebook2Id: '01sxx',
          startDate: '2026-06-01',
          expirationDate: '2026-06-30'
        },
        lines: [
          {
            product2Id: '01txx',
            pricebookEntryId: '01uxx',
            quantity: 2,
            startDate: '2026-06-01'
          }
        ],
        price: true
      });
    } finally {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });
});
