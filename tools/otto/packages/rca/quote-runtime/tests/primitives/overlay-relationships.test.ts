import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it, vi } from 'vitest';

import { QUOTE_LINE_RELATIONSHIP_OVERLAY_FIELDS } from '../../src/contracts/query-fields';
import {
  buildOverlayRelationshipsSoql,
  executeOverlayRelationships,
  mapOverlayRelationshipsFailureStatus
} from '../../src/primitives/overlay-relationships';

const fixturesDir = resolve(import.meta.dirname, '../fixtures/primitives/overlay-relationships');
const rawRelationshipRecordsFixture = JSON.parse(
  readFileSync(resolve(fixturesDir, 'raw-relationship-records.json'), 'utf8')
) as Record<string, unknown>[];
const relationshipRowsFixture = JSON.parse(
  readFileSync(resolve(fixturesDir, 'relationship-rows.json'), 'utf8')
) as Record<string, unknown>[];

describe('overlay-relationships primitive', () => {
  it('returns the normalized structural bundle overlay shape with the locked field set only', async () => {
    const invokeSfJson = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true as const,
        classification: 'ok' as const,
        cliPath: '/usr/local/bin/sf',
        data: {
          totalSize: 1,
          done: true,
          records: [{ Id: '0Q0xx0000000001AAA' }]
        },
        exitCode: 0,
        stdout: '{}',
        stderr: ''
      })
      .mockResolvedValueOnce({
        ok: true as const,
        classification: 'ok' as const,
        cliPath: '/usr/local/bin/sf',
        data: {
          totalSize: 2,
          done: true,
          records: rawRelationshipRecordsFixture
        },
        exitCode: 0,
        stdout: '{}',
        stderr: ''
      });

    const result = await executeOverlayRelationships({
      orgAlias: 'ARM',
      quoteId: '0Q0xx0000000001AAA',
      invokeSfJson
    });

    expect(result.status).toBe('ok');
    expect(result.status_detail).toBe('relationships_found');
    expect(result.result.quote_id).toBe('0Q0xx0000000001AAA');
    expect(result.result.relationship_rows).toEqual(relationshipRowsFixture);
    expect(result.result.bundle_summary).toEqual({
      targeted_line_count: 3,
      relationship_count: 2,
      matched_line_ids: ['0QLxx0000000001AAA', '0QLxx0000000002AAA', '0QLxx0000000003AAA'],
      missing_line_ids: [],
      distinct_main_line_count: 1,
      distinct_associated_line_count: 2,
      root_line_count: 1,
      main_roles: ['Bundle'],
      associated_roles: ['Component', 'Option']
    });
    expect(result.result.pricing_inclusion_summary).toEqual({
      included_in_bundle_price_count: 1,
      other_pricing_count: 1,
      unknown_pricing_count: 0,
      price_inclusive_true_count: 1,
      price_inclusive_false_count: 1,
      price_inclusive_unknown_count: 0,
      associated_pricing_values: ['IncludedInBundlePrice', 'ListPrice']
    });
    expect(result.warnings).toEqual([]);
    expect(result.errors).toEqual([]);
    expect(result.evidence).toHaveLength(2);
    expect(result.evidence[0]).toMatchObject({
      evidence_level: 'documented',
      limitations: expect.stringContaining('not be interpreted as lifecycle provenance')
    });
    expect(invokeSfJson.mock.calls[1]?.[0]).toMatchObject({
      orgAlias: 'ARM',
      args: expect.arrayContaining(['data', 'query', '--target-org', 'ARM', '--json'])
    });
    expect(String(invokeSfJson.mock.calls[1]?.[0]?.args?.[5] ?? '')).toContain(
      `SELECT ${QUOTE_LINE_RELATIONSHIP_OVERLAY_FIELDS.join(', ')} FROM QuoteLineRelationship`
    );
    expect(String(invokeSfJson.mock.calls[1]?.[0]?.args?.[5] ?? '')).not.toContain('CreatedDate');
    expect(String(invokeSfJson.mock.calls[1]?.[0]?.args?.[5] ?? '')).not.toContain('LastModifiedDate');
  });

  it('maps the locked status rules for quote absence, malformed payloads, empty overlay rows, selector misses, and sf failures', async () => {
    const quoteAbsent = await executeOverlayRelationships({
      orgAlias: 'ARM',
      quoteId: '0Q0xx0000000009AAA',
      invokeSfJson: vi.fn(async () => ({
        ok: true as const,
        classification: 'ok' as const,
        cliPath: '/usr/local/bin/sf',
        data: { totalSize: 0, done: true, records: [] },
        exitCode: 0,
        stdout: '{}',
        stderr: ''
      }))
    });
    expect(quoteAbsent.status).toBe('no_match');
    expect(quoteAbsent.status_detail).toBe('quote_absent');
    expect(quoteAbsent.result.relationship_rows).toEqual([]);

    const malformedQuoteProbe = await executeOverlayRelationships({
      orgAlias: 'ARM',
      quoteId: '0Q0xx0000000001AAA',
      invokeSfJson: vi.fn(async () => ({
        ok: true as const,
        classification: 'ok' as const,
        cliPath: '/usr/local/bin/sf',
        data: { totalSize: 1, done: true },
        exitCode: 0,
        stdout: '{}',
        stderr: ''
      }))
    });
    expect(malformedQuoteProbe.status).toBe('error');
    expect(malformedQuoteProbe.status_detail).toBe('malformed_payload');
    expect(malformedQuoteProbe.errors).toEqual([
      'Salesforce CLI returned an unexpected QuoteLineRelationship payload.'
    ]);

    const malformedRelationshipPayload = await executeOverlayRelationships({
      orgAlias: 'ARM',
      quoteId: '0Q0xx0000000001AAA',
      invokeSfJson: vi
        .fn()
        .mockResolvedValueOnce({
          ok: true as const,
          classification: 'ok' as const,
          cliPath: '/usr/local/bin/sf',
          data: { totalSize: 1, done: true, records: [{ Id: '0Q0xx0000000001AAA' }] },
          exitCode: 0,
          stdout: '{}',
          stderr: ''
        })
        .mockResolvedValueOnce({
          ok: true as const,
          classification: 'ok' as const,
          cliPath: '/usr/local/bin/sf',
          data: { totalSize: 1, done: true },
          exitCode: 0,
          stdout: '{}',
          stderr: ''
        })
    });
    expect(malformedRelationshipPayload.status).toBe('error');
    expect(malformedRelationshipPayload.status_detail).toBe('malformed_payload');
    expect(malformedRelationshipPayload.errors).toEqual([
      'Salesforce CLI returned an unexpected QuoteLineRelationship payload.'
    ]);

    const quotePresentButNoRows = await executeOverlayRelationships({
      orgAlias: 'ARM',
      quoteId: '0Q0xx0000000001AAA',
      invokeSfJson: vi
        .fn()
        .mockResolvedValueOnce({
          ok: true as const,
          classification: 'ok' as const,
          cliPath: '/usr/local/bin/sf',
          data: { totalSize: 1, done: true, records: [{ Id: '0Q0xx0000000001AAA' }] },
          exitCode: 0,
          stdout: '{}',
          stderr: ''
        })
        .mockResolvedValueOnce({
          ok: true as const,
          classification: 'ok' as const,
          cliPath: '/usr/local/bin/sf',
          data: { totalSize: 0, done: true, records: [] },
          exitCode: 0,
          stdout: '{}',
          stderr: ''
        })
    });
    expect(quotePresentButNoRows.status).toBe('ok');
    expect(quotePresentButNoRows.status_detail).toBe('empty_overlay');
    expect(quotePresentButNoRows.result.bundle_summary).toMatchObject({
      relationship_count: 0,
      matched_line_ids: [],
      missing_line_ids: []
    });

    const narrowedSelectorMiss = await executeOverlayRelationships({
      orgAlias: 'ARM',
      quoteId: '0Q0xx0000000001AAA',
      lineIds: ['0QLxx0000000099AAA'],
      invokeSfJson: vi
        .fn()
        .mockResolvedValueOnce({
          ok: true as const,
          classification: 'ok' as const,
          cliPath: '/usr/local/bin/sf',
          data: { totalSize: 1, done: true, records: [{ Id: '0Q0xx0000000001AAA' }] },
          exitCode: 0,
          stdout: '{}',
          stderr: ''
        })
        .mockResolvedValueOnce({
          ok: true as const,
          classification: 'ok' as const,
          cliPath: '/usr/local/bin/sf',
          data: { totalSize: 0, done: true, records: [] },
          exitCode: 0,
          stdout: '{}',
          stderr: ''
        })
    });
    expect(narrowedSelectorMiss.status).toBe('no_match');
    expect(narrowedSelectorMiss.status_detail).toBe('empty_overlay_selector_miss');
    expect(narrowedSelectorMiss.result.bundle_summary).toMatchObject({
      targeted_line_count: 1,
      relationship_count: 0,
      missing_line_ids: ['0QLxx0000000099AAA']
    });

    const partialSelectorMatch = await executeOverlayRelationships({
      orgAlias: 'ARM',
      quoteId: '0Q0xx0000000001AAA',
      lineIds: ['0QLxx0000000001AAA', '0QLxx0000000099AAA'],
      invokeSfJson: vi
        .fn()
        .mockResolvedValueOnce({
          ok: true as const,
          classification: 'ok' as const,
          cliPath: '/usr/local/bin/sf',
          data: { totalSize: 1, done: true, records: [{ Id: '0Q0xx0000000001AAA' }] },
          exitCode: 0,
          stdout: '{}',
          stderr: ''
        })
        .mockResolvedValueOnce({
          ok: true as const,
          classification: 'ok' as const,
          cliPath: '/usr/local/bin/sf',
          data: { totalSize: 2, done: true, records: rawRelationshipRecordsFixture },
          exitCode: 0,
          stdout: '{}',
          stderr: ''
        })
    });
    expect(partialSelectorMatch.status).toBe('partial');
    expect(partialSelectorMatch.status_detail).toBe('partial_selector_match');
    expect(partialSelectorMatch.warnings).toEqual([
      'Requested line ids not present in QuoteLineRelationship scope: 0QLxx0000000099AAA'
    ]);

    const classifications = [
      ['auth', 'unsupported'],
      ['unavailable', 'unsupported'],
      ['internal_cli_error', 'unsupported'],
      ['timeout', 'error'],
      ['non_json_error', 'error'],
      ['cli_error', 'error']
    ] as const;

    for (const [classification, expectedStatus] of classifications) {
      expect(mapOverlayRelationshipsFailureStatus(classification)).toBe(expectedStatus);
      const result = await executeOverlayRelationships({
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
      expect(result.status_detail).toBe('sf_failure');
      expect(result.result.relationship_rows).toEqual([]);
      expect(result.errors).toEqual([`fixture ${classification}`]);
    }
  });

  it('normalizes duplicate line ids and rejects blank line ids using shared selector rules', async () => {
    const invokeSfJson = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true as const,
        classification: 'ok' as const,
        cliPath: '/usr/local/bin/sf',
        data: {
          totalSize: 1,
          done: true,
          records: [{ Id: '0Q0xx0000000001AAA' }]
        },
        exitCode: 0,
        stdout: '{}',
        stderr: ''
      })
      .mockResolvedValueOnce({
        ok: true as const,
        classification: 'ok' as const,
        cliPath: '/usr/local/bin/sf',
        data: {
          totalSize: 2,
          done: true,
          records: rawRelationshipRecordsFixture
        },
        exitCode: 0,
        stdout: '{}',
        stderr: ''
      });

    await executeOverlayRelationships({
      orgAlias: 'ARM',
      quoteId: '0Q0xx0000000001AAA',
      lineIds: [' 0QLxx0000000001AAA ', '0QLxx0000000001AAA', '0QLxx0000000002AAA'],
      invokeSfJson
    });

    expect(String(invokeSfJson.mock.calls[1]?.[0]?.args?.[5] ?? '')).toContain(
      "(MainQuoteLineId IN ('0QLxx0000000001AAA', '0QLxx0000000002AAA')"
    );

    await expect(
      executeOverlayRelationships({
        orgAlias: 'ARM',
        quoteId: '0Q0xx0000000001AAA',
        lineIds: ['   '],
        invokeSfJson: vi.fn()
      })
    ).rejects.toThrow('--line-id must not be empty when provided.');
  });

  it('builds the exact narrowing SOQL for requested line ids', () => {
    expect(buildOverlayRelationshipsSoql('0Q0xx0000000001AAA', ['a', 'b'])).toBe(
      "SELECT Id, QuoteId, MainQuoteLineId, MainQuoteLine.LineNumber, MainQuoteLine.TotalPrice, AssociatedQuoteLineId, AssociatedQuoteLine.LineNumber, AssociatedQuoteLine.TotalPrice, MainQuoteLineRole, AssociatedQuoteLineRole, AssociatedQuoteLinePricing, AssociatedQuantScaleMethod, RootQuoteLineId, ProductRelationshipTypeId, ProductRelatedComponentId, IsPriceInclusive FROM QuoteLineRelationship WHERE QuoteId = '0Q0xx0000000001AAA' AND (MainQuoteLineId IN ('a', 'b') OR AssociatedQuoteLineId IN ('a', 'b') OR RootQuoteLineId IN ('a', 'b')) ORDER BY MainQuoteLineId, AssociatedQuoteLineId, Id"
    );
  });
});
