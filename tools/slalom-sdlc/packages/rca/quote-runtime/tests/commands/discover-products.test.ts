import { describe, expect, it, vi } from 'vitest';

import {
  parseDiscoverProductsFlags,
  runDiscoverProductsCommand
} from '../../src/commands/discover-products';
import type { ProductDiscoveryPrimitiveResult } from '../../src/primitives/product-discovery';

describe('discover-products command', () => {
  it('parses repeatable terms and optional catalog context', async () => {
    await expect(parseDiscoverProductsFlags([
      '--pricebook-id',
      '01sxx',
      '--term',
      'DR',
      '--term',
      'suite',
      '--catalog-id',
      '0ZCxx',
      '--limit',
      '3',
      '--include-raw'
    ])).resolves.toMatchObject({
      pricebookId: '01sxx',
      terms: ['DR', 'suite'],
      catalogId: '0ZCxx',
      limit: 3,
      includeRaw: true
    });
  });

  it('runs with an injectable primitive and writes JSON output', async () => {
    const writes: string[] = [];
    const result = await runDiscoverProductsCommand(
      ['--pricebook-id', '01sxx', '--term', 'DR suite'],
      { help: false, json: true, orgAlias: 'ARMAF', failOn: undefined, output: undefined, verbose: false },
      {
        stdout: { write: (message: string) => void writes.push(message) },
        stderr: { write: () => undefined }
      },
      {
        executeDiscoverProducts: vi.fn(async () => primitive('ok'))
      }
    );

    expect(result.exitCode).toBe(0);
    expect(JSON.parse(writes.join('')).command).toBe('discover-products');
  });
});

function primitive(status: ProductDiscoveryPrimitiveResult['status']): ProductDiscoveryPrimitiveResult {
  return {
    status,
    result: {
      strategy: 'soql_fallback',
      terms: ['DR suite'],
      candidates: [],
      omitted_count: 0
    },
    warnings: [],
    errors: [],
    evidence: []
  };
}
