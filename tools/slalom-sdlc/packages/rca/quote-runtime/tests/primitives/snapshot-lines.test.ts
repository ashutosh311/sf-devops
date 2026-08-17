import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it, vi } from 'vitest';

import {
  buildSnapshotLinesSoql,
  executeSnapshotLines,
  mapSnapshotLinesFailureStatus,
  type SnapshotLineRecord
} from '../../src/primitives/snapshot-lines';
import { QUOTE_LINE_ITEM_SNAPSHOT_FIELDS } from '../../src/contracts/query-fields';

const fixturesDir = resolve(import.meta.dirname, '../fixtures/primitives/snapshot-lines');
const lineRecordsFixture = JSON.parse(readFileSync(resolve(fixturesDir, 'line-records.json'), 'utf8')) as SnapshotLineRecord[];

function toSfLineRecord(record: SnapshotLineRecord): Record<string, unknown> {
  return {
    attributes: { type: 'QuoteLineItem' },
    Id: record.Id,
    QuoteId: record.QuoteId,
    LineNumber: record.LineNumber,
    Product2Id: record.Product2Id,
    PricebookEntryId: record.PricebookEntryId,
    ParentQuoteLineItemId: record.ParentQuoteLineItemId,
    Quantity: record.Quantity,
    StartQuantity: record.StartQuantity,
    EndQuantity: record.EndQuantity,
    UnitPrice: record.UnitPrice,
    ListPrice: record.ListPrice,
    NetUnitPrice: record.NetUnitPrice,
    NetTotalPrice: record.NetTotalPrice,
    Subtotal: record.Subtotal,
    TotalPrice: record.TotalPrice,
    TotalLineAmount: record.TotalLineAmount,
    TotalAdjustmentAmount: record.TotalAdjustmentAmount,
    SellingModelType: record.SellingModelType,
    StartDate: record.StartDate,
    EndDate: record.EndDate,
    PriceWaterfallIdentifier: record.PriceWaterfallIdentifier,
    QuoteActionId: record.QuoteActionId,
    QuoteAction:
      record['QuoteAction.Type'] === null && record['QuoteAction.SourceAssetId'] === null
        ? null
        : {
            Type: record['QuoteAction.Type'],
            SourceAssetId: record['QuoteAction.SourceAssetId'],
            IgnoredField: 'ignored'
          },
    CreatedDate: record.CreatedDate,
    LastModifiedDate: record.LastModifiedDate,
    UnexpectedField: 'ignored'
  };
}

describe('snapshot-lines primitive', () => {
  it('returns all lines by default when no line ids are provided', async () => {
    const invokeSfJson = vi.fn(async () => ({
      ok: true as const,
      classification: 'ok' as const,
      cliPath: '/usr/local/bin/sf',
      data: {
        totalSize: 3,
        done: true,
        records: lineRecordsFixture.map(toSfLineRecord)
      },
      exitCode: 0,
      stdout: '{}',
      stderr: ''
    }));

    const result = await executeSnapshotLines({
      orgAlias: 'ARM',
      quoteId: '0Q0xx0000000001AAA',
      invokeSfJson
    });

    expect(result.status).toBe('ok');
    expect(result.result).toMatchObject({
      quote_id: '0Q0xx0000000001AAA',
      lines: lineRecordsFixture,
      field_set: [...QUOTE_LINE_ITEM_SNAPSHOT_FIELDS],
      counts: {
        returned: 3,
        requested: 0,
        available_on_quote: 3,
        missing: 0
      },
      selection: {
        mode: 'all_lines',
        requested_line_ids: [],
        missing_line_ids: []
      }
    });
    expect(result.errors).toEqual([]);
    expect(result.evidence[0]).toMatchObject({
      evidence_level: 'org_proven',
      claim: 'Retrieved 3 persisted quote lines for 0Q0xx0000000001AAA.'
    });
    expect(invokeSfJson).toHaveBeenCalledWith(
      expect.objectContaining({
        orgAlias: 'ARM',
        args: expect.arrayContaining(['data', 'query', '--target-org', 'ARM', '--json'])
      })
    );
  });

  it('keeps the default all-lines selection as ok when the quote has no persisted lines', async () => {
    const result = await executeSnapshotLines({
      orgAlias: 'ARM',
      quoteId: '0Q0xx0000000001AAA',
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

    expect(result.status).toBe('ok');
    expect(result.result.counts).toEqual({
      returned: 0,
      requested: 0,
      available_on_quote: 0,
      missing: 0
    });
    expect(result.result.selection).toEqual({
      mode: 'all_lines',
      requested_line_ids: [],
      missing_line_ids: []
    });
    expect(result.warnings).toEqual([]);
  });

  it('narrows to deduplicated line ids while preserving first-seen order and normalized counts', async () => {
    const result = await executeSnapshotLines({
      orgAlias: 'ARM',
      quoteId: '0Q0xx0000000001AAA',
      lineIds: ['0QLxx0000000003AAA', '0QLxx0000000001AAA', '0QLxx0000000003AAA'],
      invokeSfJson: vi.fn(async () => ({
        ok: true as const,
        classification: 'ok' as const,
        cliPath: '/usr/local/bin/sf',
        data: {
          totalSize: 3,
          done: true,
          records: [lineRecordsFixture[0], lineRecordsFixture[1], lineRecordsFixture[2]].map(toSfLineRecord)
        },
        exitCode: 0,
        stdout: '{}',
        stderr: ''
      }))
    });

    expect(result.status).toBe('ok');
    expect(result.result.lines.map((line) => line.Id)).toEqual([
      '0QLxx0000000003AAA',
      '0QLxx0000000001AAA'
    ]);
    expect(result.result.counts).toEqual({
      returned: 2,
      requested: 2,
      available_on_quote: 3,
      missing: 0
    });
    expect(result.result.selection).toEqual({
      mode: 'line_id_filter',
      requested_line_ids: ['0QLxx0000000003AAA', '0QLxx0000000001AAA'],
      missing_line_ids: []
    });
  });

  it('returns partial when some requested narrowed lines resolve and others do not', async () => {
    const result = await executeSnapshotLines({
      orgAlias: 'ARM',
      quoteId: '0Q0xx0000000001AAA',
      lineIds: ['0QLxx0000000002AAA', '0QLxx0000000999AAA'],
      invokeSfJson: vi.fn(async () => ({
        ok: true as const,
        classification: 'ok' as const,
        cliPath: '/usr/local/bin/sf',
        data: {
          totalSize: 3,
          done: true,
          records: lineRecordsFixture.map(toSfLineRecord)
        },
        exitCode: 0,
        stdout: '{}',
        stderr: ''
      }))
    });

    expect(result.status).toBe('partial');
    expect(result.result.lines.map((line) => line.Id)).toEqual(['0QLxx0000000002AAA']);
    expect(result.result.counts).toEqual({
      returned: 1,
      requested: 2,
      available_on_quote: 3,
      missing: 1
    });
    expect(result.result.selection.missing_line_ids).toEqual(['0QLxx0000000999AAA']);
    expect(result.warnings).toEqual([
      "Requested line ids not found on quote '0Q0xx0000000001AAA': 0QLxx0000000999AAA."
    ]);
  });

  it('returns no_match when narrowed line ids do not resolve to any persisted quote lines', async () => {
    const result = await executeSnapshotLines({
      orgAlias: 'ARM',
      quoteId: '0Q0xx0000000001AAA',
      lineIds: ['0QLxx0000000998AAA', '0QLxx0000000999AAA'],
      invokeSfJson: vi.fn(async () => ({
        ok: true as const,
        classification: 'ok' as const,
        cliPath: '/usr/local/bin/sf',
        data: {
          totalSize: 3,
          done: true,
          records: lineRecordsFixture.map(toSfLineRecord)
        },
        exitCode: 0,
        stdout: '{}',
        stderr: ''
      }))
    });

    expect(result.status).toBe('no_match');
    expect(result.result.lines).toEqual([]);
    expect(result.result.counts).toEqual({
      returned: 0,
      requested: 2,
      available_on_quote: 3,
      missing: 2
    });
    expect(result.warnings).toEqual([
      "Requested line ids not found on quote '0Q0xx0000000001AAA': 0QLxx0000000998AAA, 0QLxx0000000999AAA."
    ]);
  });

  it('treats malformed successful payloads without records arrays as errors instead of fallback empty results', async () => {
    const result = await executeSnapshotLines({
      orgAlias: 'ARM',
      quoteId: '0Q0xx0000000001AAA',
      lineIds: ['0QLxx0000000998AAA'],
      invokeSfJson: vi.fn(async () => ({
        ok: true as const,
        classification: 'ok' as const,
        cliPath: '/usr/local/bin/sf',
        data: {
          totalSize: 1,
          done: true
        },
        exitCode: 0,
        stdout: '{}',
        stderr: ''
      }))
    });

    expect(result.status).toBe('error');
    expect(result.result).toMatchObject({
      quote_id: '0Q0xx0000000001AAA',
      lines: [],
      counts: {
        returned: 0,
        requested: 1,
        available_on_quote: 0,
        missing: 1
      },
      selection: {
        mode: 'line_id_filter',
        requested_line_ids: ['0QLxx0000000998AAA'],
        missing_line_ids: ['0QLxx0000000998AAA']
      }
    });
    expect(result.warnings).toEqual([]);
    expect(result.errors).toEqual(['Salesforce CLI returned an unexpected quote line record payload.']);
    expect(result.evidence).toEqual([]);
  });

  it('treats malformed successful payloads with non-record rows as errors', async () => {
    const result = await executeSnapshotLines({
      orgAlias: 'ARM',
      quoteId: '0Q0xx0000000001AAA',
      invokeSfJson: vi.fn(async () => ({
        ok: true as const,
        classification: 'ok' as const,
        cliPath: '/usr/local/bin/sf',
        data: {
          totalSize: 1,
          done: true,
          records: ['not-a-record']
        },
        exitCode: 0,
        stdout: '{}',
        stderr: ''
      }))
    });

    expect(result.status).toBe('error');
    expect(result.errors).toEqual(['Salesforce CLI returned an unexpected quote line record payload.']);
    expect(result.result.lines).toEqual([]);
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
      expect(mapSnapshotLinesFailureStatus(classification)).toBe(expectedStatus);

      const result = await executeSnapshotLines({
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
      expect(result.result.lines).toEqual([]);
      expect(result.result.field_set).toEqual([...QUOTE_LINE_ITEM_SNAPSHOT_FIELDS]);
      expect(result.errors).toEqual([`fixture ${classification}`]);
    }
  });

  it('builds deterministic snapshot-lines SOQL for the locked line field set', () => {
    expect(buildSnapshotLinesSoql('0Q0xx0000000001AAA')).toBe(
      "SELECT Id, QuoteId, LineNumber, Product2Id, PricebookEntryId, ParentQuoteLineItemId, Quantity, StartQuantity, EndQuantity, UnitPrice, ListPrice, NetUnitPrice, NetTotalPrice, Subtotal, TotalPrice, TotalLineAmount, TotalAdjustmentAmount, SellingModelType, StartDate, EndDate, PriceWaterfallIdentifier, QuoteActionId, QuoteAction.Type, QuoteAction.SourceAssetId, CreatedDate, LastModifiedDate FROM QuoteLineItem WHERE QuoteId = '0Q0xx0000000001AAA' ORDER BY LineNumber, Id"
    );
  });
});
