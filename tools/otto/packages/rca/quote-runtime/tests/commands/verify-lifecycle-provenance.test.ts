import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it, vi } from 'vitest';

import {
  buildVerifyLifecycleProvenanceEnvelope,
  parseVerifyLifecycleProvenanceFlags,
  renderVerifyLifecycleProvenanceHelp,
  renderVerifyLifecycleProvenanceText,
  runVerifyLifecycleProvenanceCommand
} from '../../src/commands/verify-lifecycle-provenance';
import { QUOTE_ACTION_OVERLAY_FIELDS } from '../../src/contracts/query-fields';
import type { OverlayActionsPrimitiveResult } from '../../src/primitives/overlay-actions';

const fixturesDir = resolve(import.meta.dirname, '../fixtures/scenarios/verify-lifecycle-provenance');
const actionRowsFixture = JSON.parse(readFileSync(resolve(fixturesDir, 'action-rows.json'), 'utf8')) as Array<Record<string, unknown>>;

function createOverlayActionsPrimitiveResult(
  quoteId: string,
  overrides: Partial<OverlayActionsPrimitiveResult> = {}
): OverlayActionsPrimitiveResult {
  return {
    status: 'ok',
    status_detail: 'actions_found',
    result: {
      quote_id: quoteId,
      field_set: [...QUOTE_ACTION_OVERLAY_FIELDS],
      action_rows: actionRowsFixture as never,
      line_action_links: [
        {
          line_id: '0QLxx0000000401AAA',
          quote_action_id: '7oca50000JAnrYLAQZ',
          action_type: 'Amend',
          source_asset_id: '02ixx0000000001AAA'
        },
        {
          line_id: '0QLxx0000000402AAA',
          quote_action_id: '7oca50000JAnrYLBRZ',
          action_type: 'Renew',
          source_asset_id: '02ixx0000000002AAA'
        }
      ],
      provenance_summary: {
        action_types: ['Amend', 'Renew'],
        linked_line_count: 2,
        action_row_count: 2
      }
    },
    warnings: [],
    errors: [],
    evidence: [{
      claim: `Retrieved QuoteAction lifecycle provenance overlay for ${quoteId}.`,
      evidence_level: 'org_proven',
      proof_source: ['QuoteLineItem.QuoteActionId', 'QuoteAction.Type', 'QuoteAction.SourceAssetId'],
      limitations: 'Test fixture evidence only.',
      source_refs: []
    }],
    queries: ['SELECT Id FROM QuoteAction'],
    ...overrides
  };
}

describe('verify-lifecycle-provenance command', () => {
  it('renders the locked help text and requires quote-id', async () => {
    expect(renderVerifyLifecycleProvenanceHelp()).toContain(
      'quote-runtime verify-lifecycle-provenance --org-alias <alias> --quote-id <id> [--line-id <id> ...] [--asset-id <id> ...]'
    );
    expect(renderVerifyLifecycleProvenanceHelp()).toContain('uses QuoteAction lifecycle provenance only');
    await expect(parseVerifyLifecycleProvenanceFlags([])).rejects.toThrow('Missing required flag quote-id');
  });

  it('builds lifecycle provenance verification output without structure-overlay conflation', () => {
    const envelope = buildVerifyLifecycleProvenanceEnvelope({
      globalFlags: {
        help: false,
        json: false,
        orgAlias: 'ARM',
        failOn: undefined,
        output: undefined,
        verbose: false
      },
      commandFlags: {
        quoteId: '0Q0xx0000000400AAA',
        lineIds: ['0QLxx0000000401AAA', '0QLxx0000000402AAA'],
        assetIds: ['02ixx0000000001AAA']
      },
      overlayActions: createOverlayActionsPrimitiveResult('0Q0xx0000000400AAA'),
      generatedAt: '2026-04-15T12:00:00.000Z',
      durationMs: 14
    });

    expect(envelope).toMatchObject({
      command: 'verify-lifecycle-provenance',
      status: 'ok',
      summary: {
        primary_subject: '0Q0xx0000000400AAA (2 scoped line id(s), 1 scoped asset id(s))',
        primary_lane: 'lifecycle_provenance',
        verification_anchor: 'quote:0Q0xx0000000400AAA:lines:0QLxx0000000401AAA,0QLxx0000000402AAA:assets:02ixx0000000001AAA',
        next_suggested_command: 'snapshot-lines'
      },
      result: {
        quote_classification: {
          quote_id: '0Q0xx0000000400AAA',
          classification: 'lifecycle_quote',
          action_types: ['Amend', 'Renew'],
          source_asset_ids: ['02ixx0000000001AAA', '02ixx0000000002AAA']
        },
        supporting_asset_refs: [
          {
            asset_id: '02ixx0000000001AAA',
            match_status: 'requested_and_observed'
          },
          {
            asset_id: '02ixx0000000002AAA',
            match_status: 'observed_in_quoteaction'
          }
        ],
        recommended_next_commands: ['snapshot-lines', 'inspect-rlm-context']
      },
      meta: {
        org_alias: 'ARM',
        duration_ms: 14
      }
    });

    expect(envelope.result.line_provenance_findings).toEqual([
      expect.objectContaining({
        line_id: '0QLxx0000000401AAA',
        quote_action_id: '7oca50000JAnrYLAQZ',
        action_type: 'Amend',
        source_asset_id: '02ixx0000000001AAA',
        provenance_status: 'linked_via_quoteaction'
      }),
      expect.objectContaining({
        line_id: '0QLxx0000000402AAA',
        quote_action_id: '7oca50000JAnrYLBRZ',
        action_type: 'Renew',
        source_asset_id: '02ixx0000000002AAA',
        provenance_status: 'linked_via_quoteaction'
      })
    ]);
    expect(JSON.stringify(envelope.result)).not.toContain('QuoteLineRelationship');
    expect(envelope.result.recommended_next_commands).not.toContain('overlay-relationships');
    expect(envelope.evidence).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          claim: 'Verified lifecycle provenance for 2 line(s) on quote 0Q0xx0000000400AAA using QuoteAction only.',
          evidence_level: 'org_proven',
          proof_source: expect.arrayContaining([
            'QuoteLineItem.QuoteActionId',
            'QuoteAction.Id',
            'QuoteAction.Type',
            'QuoteAction.SourceAssetId',
            'quote:0Q0xx0000000400AAA',
            'line:0QLxx0000000401AAA',
            'line:0QLxx0000000402AAA',
            'quote_action:7oca50000JAnrYLAQZ',
            'quote_action:7oca50000JAnrYLBRZ'
          ])
        })
      ])
    );
    expect(renderVerifyLifecycleProvenanceText(envelope)).toContain('classification: lifecycle_quote');
    expect(renderVerifyLifecycleProvenanceText(envelope)).toContain('line provenance findings: 2');
  });

  it('returns partial when requested asset ids are not all observed in QuoteAction evidence', () => {
    const envelope = buildVerifyLifecycleProvenanceEnvelope({
      globalFlags: {
        help: false,
        json: false,
        orgAlias: 'ARM',
        failOn: undefined,
        output: undefined,
        verbose: false
      },
      commandFlags: {
        quoteId: '0Q0xx0000000400AAA',
        lineIds: ['0QLxx0000000401AAA'],
        assetIds: ['02ixx0000000001AAA', '02ixx0000000099AAA']
      },
      overlayActions: createOverlayActionsPrimitiveResult('0Q0xx0000000400AAA', {
        result: {
          quote_id: '0Q0xx0000000400AAA',
          field_set: [...QUOTE_ACTION_OVERLAY_FIELDS],
          action_rows: actionRowsFixture as never,
          line_action_links: [
            {
              line_id: '0QLxx0000000401AAA',
              quote_action_id: '7oca50000JAnrYLAQZ',
              action_type: 'Amend',
              source_asset_id: '02ixx0000000001AAA'
            }
          ],
          provenance_summary: {
            action_types: ['Amend'],
            linked_line_count: 1,
            action_row_count: 1
          }
        }
      }),
      generatedAt: '2026-04-15T12:00:00.000Z',
      durationMs: 0
    });

    expect(envelope.status).toBe('partial');
    expect(envelope.summary.status_reason).toBe(
      'Verified lifecycle provenance for 1 line(s), but 1 requested asset id(s) were not observed in QuoteAction evidence.'
    );
    expect(envelope.evidence).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          claim: 'Verified lifecycle provenance for 1 line(s), but 1 requested asset id(s) were not observed in QuoteAction evidence.',
          evidence_level: 'org_proven'
        })
      ])
    );
    expect(envelope.result.supporting_asset_refs).toEqual([
      expect.objectContaining({ asset_id: '02ixx0000000001AAA', match_status: 'requested_and_observed' }),
      expect.objectContaining({ asset_id: '02ixx0000000002AAA', match_status: 'observed_in_quoteaction' }),
      expect.objectContaining({ asset_id: '02ixx0000000099AAA', match_status: 'requested_not_observed' })
    ]);
  });

  it('runs through the command entrypoint using overlay-actions only', async () => {
    const stdout: string[] = [];
    const stderr: string[] = [];
    const executeOverlayActions = vi.fn(async () => createOverlayActionsPrimitiveResult('0Q0xx0000000400AAA'));

    const execution = await runVerifyLifecycleProvenanceCommand(
      ['--quote-id', '0Q0xx0000000400AAA', '--line-id', '0QLxx0000000401AAA', '--asset-id', '02ixx0000000001AAA', '--asset-id', '02ixx0000000001AAA'],
      {
        help: false,
        json: true,
        orgAlias: 'ARM',
        failOn: 'error',
        output: undefined,
        verbose: false
      },
      {
        stdout: { write: (message: string) => void stdout.push(message) },
        stderr: { write: (message: string) => void stderr.push(message) }
      },
      { executeOverlayActions }
    );

    expect(execution.exitCode).toBe(0);
    expect(stderr).toEqual([]);
    expect(executeOverlayActions).toHaveBeenCalledWith(
      expect.objectContaining({
        orgAlias: 'ARM',
        quoteId: '0Q0xx0000000400AAA',
        lineIds: ['0QLxx0000000401AAA']
      })
    );
    expect(JSON.parse(stdout.join(''))).toMatchObject({
      command: 'verify-lifecycle-provenance',
      status: 'ok',
      result: {
        quote_classification: {
          classification: 'lifecycle_quote'
        },
        recommended_next_commands: ['snapshot-lines', 'inspect-rlm-context']
      }
    });
  });
});
