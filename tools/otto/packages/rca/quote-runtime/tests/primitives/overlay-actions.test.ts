import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it, vi } from 'vitest';

import {
  buildOverlayActionsLineSoql,
  buildOverlayActionsQuoteSoql,
  buildOverlayActionsRowSoql,
  executeOverlayActions,
  mapOverlayActionsFailureStatus
} from '../../src/primitives/overlay-actions';
import { QUOTE_ACTION_OVERLAY_FIELDS } from '../../src/contracts/query-fields';

const fixturesDir = resolve(import.meta.dirname, '../fixtures/primitives/overlay-actions');
const actionRowsFixture = JSON.parse(readFileSync(resolve(fixturesDir, 'action-rows.json'), 'utf8')) as Array<Record<string, unknown>>;
const lineRecordsFixture = JSON.parse(readFileSync(resolve(fixturesDir, 'line-records.json'), 'utf8')) as Array<Record<string, unknown>>;

describe('overlay-actions primitive', () => {
  it('returns lifecycle provenance overlay data only using the locked QuoteAction field set', async () => {
    const invokeSfJson = vi
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
        data: {
          totalSize: 2,
          done: true,
          records: [
            {
              ...lineRecordsFixture[0],
              MainQuoteLineRole: 'Bundle Parent',
              AssociatedQuoteLineRole: 'Component'
            },
            lineRecordsFixture[1]
          ]
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
          totalSize: 1,
          done: true,
          records: [
            {
              ...actionRowsFixture[0],
              Name: 'must-be-ignored',
              MainQuoteLineRole: 'not-allowed'
            }
          ]
        },
        exitCode: 0,
        stdout: '{}',
        stderr: ''
      });

    const result = await executeOverlayActions({
      orgAlias: 'ARM',
      quoteId: '0Q0xx0000000001AAA',
      invokeSfJson
    });

    expect(result.status).toBe('ok');
    expect(result.status_detail).toBe('actions_found');
    expect(result.result.quote_id).toBe('0Q0xx0000000001AAA');
    expect(result.result.field_set).toEqual([...QUOTE_ACTION_OVERLAY_FIELDS]);
    expect(result.result.action_rows).toEqual(actionRowsFixture);
    expect(result.result.line_action_links).toEqual([
      {
        line_id: '0QLxx0000000001AAA',
        quote_action_id: '7oca50000JAnrYLAQZ',
        action_type: 'Amend',
        source_asset_id: '02ixx0000000001AAA'
      }
    ]);
    expect(result.result.provenance_summary).toEqual({
      action_types: ['Amend'],
      linked_line_count: 1,
      action_row_count: 1
    });
    expect(result.errors).toEqual([]);
    expect(result.evidence[0]).toMatchObject({
      evidence_level: 'org_proven',
      proof_source: ['QuoteLineItem.QuoteActionId', 'QuoteAction.Type', 'QuoteAction.SourceAssetId']
    });

    expect(buildOverlayActionsQuoteSoql('0Q0xx0000000001AAA')).toContain("FROM Quote WHERE Id = '0Q0xx0000000001AAA'");
    expect(buildOverlayActionsLineSoql('0Q0xx0000000001AAA')).toContain('FROM QuoteLineItem');
    expect(buildOverlayActionsRowSoql('0Q0xx0000000001AAA', ['7oca50000JAnrYLAQZ'])).toContain(
      "SELECT Id, QuoteId, Type, Subtype, SourceAssetId, CreatedDate, LastModifiedDate FROM QuoteAction"
    );
  });

  it('returns ok with empty arrays and empty summary when the quote exists but no overlay rows exist', async () => {
    const result = await executeOverlayActions({
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
          data: { totalSize: 2, done: true, records: [{ Id: '0QLxx0000000002AAA', QuoteActionId: null }] },
          exitCode: 0,
          stdout: '{}',
          stderr: ''
        })
    });

    expect(result).toMatchObject({
      status: 'ok',
      status_detail: 'empty_overlay',
      result: {
        quote_id: '0Q0xx0000000001AAA',
        action_rows: [],
        line_action_links: [],
        provenance_summary: {}
      },
      errors: []
    });
  });

  it('returns no_match when selector narrowing makes every requested line unmatched even if the quote exists', async () => {
    const result = await executeOverlayActions({
      orgAlias: 'ARM',
      quoteId: '0Q0xx0000000001AAA',
      lineIds: ['0QLmissingAAA'],
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

    expect(result.status).toBe('no_match');
    expect(result.status_detail).toBe('line_selector_miss');
    expect(result.result.action_rows).toEqual([]);
    expect(result.result.line_action_links).toEqual([]);
    expect(result.result.provenance_summary).toEqual({});
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
      expect(mapOverlayActionsFailureStatus(classification)).toBe(expectedStatus);

      const result = await executeOverlayActions({
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
      expect(result.result.quote_id).toBe('0Q0xx0000000001AAA');
      expect(result.result.action_rows).toEqual([]);
      expect(result.errors).toEqual([`fixture ${classification}`]);
    }
  });

  it('returns quote_absent when the quote probe finds no rows', async () => {
    const result = await executeOverlayActions({
      orgAlias: 'ARM',
      quoteId: '0Q0xx0000000001AAA',
      invokeSfJson: vi.fn().mockResolvedValueOnce({
        ok: true as const,
        classification: 'ok' as const,
        cliPath: '/usr/local/bin/sf',
        data: { totalSize: 0, done: true, records: [] },
        exitCode: 0,
        stdout: '{}',
        stderr: ''
      })
    });

    expect(result.status).toBe('no_match');
    expect(result.status_detail).toBe('quote_absent');
    expect(result.errors).toEqual([]);
  });

  it('surfaces malformed successful payloads as error instead of empty results', async () => {
    const malformedQuoteResult = await executeOverlayActions({
      orgAlias: 'ARM',
      quoteId: '0Q0xx0000000001AAA',
      invokeSfJson: vi.fn().mockResolvedValueOnce({
        ok: true as const,
        classification: 'ok' as const,
        cliPath: '/usr/local/bin/sf',
        data: { totalSize: 1, done: true },
        exitCode: 0,
        stdout: '{}',
        stderr: ''
      })
    });

    expect(malformedQuoteResult.status).toBe('error');
    expect(malformedQuoteResult.status_detail).toBe('malformed_payload');
    expect(malformedQuoteResult.errors).toEqual(['Salesforce CLI returned an unexpected quote payload.']);

    const malformedLineResult = await executeOverlayActions({
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

    expect(malformedLineResult.status).toBe('error');
    expect(malformedLineResult.status_detail).toBe('malformed_payload');
    expect(malformedLineResult.errors).toEqual(['Salesforce CLI returned an unexpected quote line overlay payload.']);

    const malformedActionResult = await executeOverlayActions({
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
          data: { totalSize: 1, done: true, records: [lineRecordsFixture[0]] },
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

    expect(malformedActionResult.status).toBe('error');
    expect(malformedActionResult.status_detail).toBe('malformed_payload');
    expect(malformedActionResult.errors).toEqual(['Salesforce CLI returned an unexpected QuoteAction overlay payload.']);

    const malformedNestedFieldResult = await executeOverlayActions({
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
          data: { totalSize: 1, done: true, records: [lineRecordsFixture[0]] },
          exitCode: 0,
          stdout: '{}',
          stderr: ''
        })
        .mockResolvedValueOnce({
          ok: true as const,
          classification: 'ok' as const,
          cliPath: '/usr/local/bin/sf',
          data: { totalSize: 1, done: true, records: [{ ...actionRowsFixture[0], Type: { bad: true } }] },
          exitCode: 0,
          stdout: '{}',
          stderr: ''
        })
    });

    expect(malformedNestedFieldResult.status).toBe('error');
    expect(malformedNestedFieldResult.status_detail).toBe('malformed_payload');
    expect(malformedNestedFieldResult.errors).toEqual(['Salesforce CLI returned an unexpected QuoteAction overlay payload.']);
  });
});
