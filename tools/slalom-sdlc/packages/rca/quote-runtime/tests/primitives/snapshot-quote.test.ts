import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it, vi } from 'vitest';

import {
  executeSnapshotQuote,
  mapSnapshotQuoteFailureStatus,
  type SnapshotQuotePrimitiveResult
} from '../../src/primitives/snapshot-quote';
import { QUOTE_SNAPSHOT_FIELDS } from '../../src/contracts/query-fields';

const fixturesDir = resolve(import.meta.dirname, '../fixtures/primitives/snapshot-quote');
const quoteRecordFixture = JSON.parse(readFileSync(resolve(fixturesDir, 'quote-record.json'), 'utf8')) as Record<string, unknown>;

describe('snapshot-quote primitive', () => {
  it('returns the normalized quote result shape with the locked field set', async () => {
    const invokeSfJson = vi.fn(async () => ({
      ok: true as const,
      classification: 'ok' as const,
      cliPath: '/usr/local/bin/sf',
      data: {
        totalSize: 1,
        done: true,
        records: [
          {
            attributes: { type: 'Quote' },
            ...quoteRecordFixture,
            UnexpectedField: 'ignored'
          }
        ]
      },
      exitCode: 0,
      stdout: '{}',
      stderr: ''
    }));

    const result = await executeSnapshotQuote({
      orgAlias: 'ARM',
      quoteId: '0Q0xx0000000001AAA',
      invokeSfJson
    });

    expect(result.status).toBe('ok');
    expect(result.result.field_set).toEqual([...QUOTE_SNAPSHOT_FIELDS]);
    expect(result.result.snapshot_type).toBe('quote');
    expect(result.result.quote).toEqual(quoteRecordFixture);
    expect(result.errors).toEqual([]);
    expect(result.evidence).toHaveLength(1);
    expect(result.evidence[0]).toMatchObject({
      evidence_level: 'org_proven',
      claim: 'Retrieved persisted quote snapshot for 0Q0xx0000000001AAA.'
    });
    expect(invokeSfJson).toHaveBeenCalledWith(
      expect.objectContaining({
        orgAlias: 'ARM',
        args: expect.arrayContaining(['data', 'query', '--target-org', 'ARM', '--json'])
      })
    );
  });

  it('returns no_match with a null quote when the target quote is absent', async () => {
    const result = await executeSnapshotQuote({
      orgAlias: 'ARM',
      quoteId: '0Q0xx0000000009AAA',
      invokeSfJson: vi.fn(async () => ({
        ok: true as const,
        classification: 'ok' as const,
        cliPath: '/usr/local/bin/sf',
        data: {
          totalSize: 0,
          done: true,
          records: []
        },
        exitCode: 0,
        stdout: '{}',
        stderr: ''
      }))
    });

    expect(result).toMatchObject({
      status: 'no_match',
      result: {
        quote: null,
        field_set: [...QUOTE_SNAPSHOT_FIELDS],
        snapshot_type: 'quote'
      },
      errors: []
    });
    expect(result.evidence).toHaveLength(1);
    expect(result.evidence[0]).toMatchObject({
      evidence_level: 'org_proven',
      claim: 'No persisted Quote row matched 0Q0xx0000000009AAA.'
    });
  });

  it('treats malformed successful payloads as errors instead of no_match', async () => {
    const result = await executeSnapshotQuote({
      orgAlias: 'ARM',
      quoteId: '0Q0xx0000000001AAA',
      invokeSfJson: vi.fn(async () => ({
        ok: true as const,
        classification: 'ok' as const,
        cliPath: '/usr/local/bin/sf',
        data: {
          totalSize: 1,
          done: true,
          records: ['bad-record']
        },
        exitCode: 0,
        stdout: '{}',
        stderr: ''
      })) as typeof executeSnapshotQuote extends (input: infer _I) => Promise<infer _O> ? never : never
    } as never);

    expect(result.status).toBe('error');
    expect(result.errors).toEqual(['Salesforce CLI returned an unexpected quote record payload.']);
  });

  it('maps sf adapter failure classifications to the locked primitive statuses', async () => {
    const classifications = [
      ['auth', 'unsupported'],
      ['unavailable', 'unsupported'],
      ['internal_cli_error', 'unsupported'],
      ['timeout', 'error'],
      ['non_json_error', 'error'],
      ['cli_error', 'error']
    ] as const;

    for (const [classification, expectedStatus] of classifications) {
      expect(mapSnapshotQuoteFailureStatus(classification)).toBe(expectedStatus);

      const result = await executeSnapshotQuote({
        orgAlias: 'ARM',
        quoteId: '0Q0xx0000000001AAA',
        invokeSfJson: vi.fn(async () => ({
          ok: false as const,
          classification,
          cliPath: '/usr/local/bin/sf',
          message: `fixture ${classification}`,
          exitCode: 1,
          stdout: '',
          stderr: ''
        }))
      });

      expect(result.status).toBe(expectedStatus);
      expect(result.result.quote).toBeNull();
      expect(result.result.field_set).toEqual([...QUOTE_SNAPSHOT_FIELDS]);
      expect(result.errors).toEqual([`fixture ${classification}`]);
    }
  });
});
