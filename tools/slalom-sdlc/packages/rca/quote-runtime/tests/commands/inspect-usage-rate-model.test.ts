import { describe, expect, it, vi } from 'vitest';

import {
  parseInspectUsageRateModelFlags,
  renderInspectUsageRateModelHelp,
  runInspectUsageRateModelCommand
} from '../../src/commands/inspect-usage-rate-model';
import type { UsageRateModelPrimitiveResult } from '../../src/primitives/usage-rate-model';

describe('inspect-usage-rate-model command', () => {
  it('parses optional product, pricebook, and sample flags', async () => {
    await expect(parseInspectUsageRateModelFlags([
      '--product-id',
      '01txx',
      '--pricebook-id',
      '01sxx',
      '--include-samples',
      '--sample-limit',
      '3'
    ])).resolves.toEqual({
      productId: '01txx',
      pricebookId: '01sxx',
      includeSamples: true,
      sampleLimit: 3
    });
  });

  it('documents the read-only usage/rate inspection contract', () => {
    expect(renderInspectUsageRateModelHelp()).toContain(
      'quote-runtime inspect-usage-rate-model --org-alias <alias> [--product-id <id>] [--pricebook-id <id>] [--include-samples]'
    );
    expect(renderInspectUsageRateModelHelp()).toContain('Does not mutate catalog, pricing, decision-table, index, quote, or usage records.');
  });

  it('runs with an injectable primitive and writes JSON output', async () => {
    const writes: string[] = [];
    const result = await runInspectUsageRateModelCommand(
      ['--include-samples'],
      { help: false, json: true, orgAlias: 'ARMAF', failOn: undefined, output: undefined, verbose: false },
      {
        stdout: { write: (message: string) => void writes.push(message) },
        stderr: { write: () => undefined }
      },
      {
        executeInspectUsageRateModel: vi.fn(async () => primitive('ok'))
      }
    );

    expect(result.exitCode).toBe(0);
    expect(JSON.parse(writes.join('')).command).toBe('inspect-usage-rate-model');
    expect(JSON.parse(writes.join('')).summary.primary_lane).toBe('usage_rate_model_discovery');
  });
});

function primitive(status: UsageRateModelPrimitiveResult['status']): UsageRateModelPrimitiveResult {
  return {
    status,
    result: {
      documented: {
        object_families: [],
        source_urls: []
      },
      org_proven: {
        object_coverage: [
          {
            object_api_name: 'UsageResource',
            available: true,
            queryable: true,
            createable: true,
            updateable: true,
            key_prefix: '1BR',
            field_count: 8,
            key_fields_present: ['Id', 'Name', 'Status'],
            key_fields_missing: [],
            count_status: 'ok',
            active_or_relevant_count: 2,
            sample_status: 'ok',
            samples: [],
            warnings: []
          }
        ],
        counts: {
          UsageResource: 2
        },
        filters: {
          UsageResource: "Status = 'Active'"
        }
      },
      inferred: {
        model_notes: []
      },
      unknown: {
        blockers: []
      }
    },
    warnings: [],
    errors: [],
    evidence: []
  };
}
