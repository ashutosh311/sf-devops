import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it, vi } from 'vitest';

import {
  buildExplainMissingPriceEnvelope,
  parseExplainMissingPriceFlags,
  renderExplainMissingPriceHelp,
  renderExplainMissingPriceText,
  runExplainMissingPriceCommand
} from '../../src/commands/explain-missing-price';
import { QUOTE_ACTION_OVERLAY_FIELDS, QUOTE_LINE_ITEM_SNAPSHOT_FIELDS } from '../../src/contracts/query-fields';
import type { OverlayActionsPrimitiveResult } from '../../src/primitives/overlay-actions';
import type { OverlayRelationshipsPrimitiveResult, OverlayRelationshipRow } from '../../src/primitives/overlay-relationships';
import type { SnapshotLineRecord, SnapshotLinesPrimitiveResult } from '../../src/primitives/snapshot-lines';

const fixturesDir = resolve(import.meta.dirname, '../fixtures/scenarios/explain-missing-price');
const linesBundleFixture = JSON.parse(readFileSync(resolve(fixturesDir, 'lines-bundle.json'), 'utf8')) as SnapshotLineRecord[];
const linesLifecycleFixture = JSON.parse(readFileSync(resolve(fixturesDir, 'lines-lifecycle.json'), 'utf8')) as SnapshotLineRecord[];
const relationshipBundleFixture = JSON.parse(
  readFileSync(resolve(fixturesDir, 'relationship-bundle.json'), 'utf8')
) as OverlayRelationshipRow[];
const actionLifecycleFixture = JSON.parse(
  readFileSync(resolve(fixturesDir, 'action-lifecycle.json'), 'utf8')
) as Array<Record<string, unknown>>;

function createSnapshotLinesPrimitiveResult(
  quoteId: string,
  lines: SnapshotLineRecord[],
  requestedLineIds: string[] = []
): SnapshotLinesPrimitiveResult {
  const missingLineIds = requestedLineIds.filter((lineId) => !lines.some((line) => String(line.Id) === lineId));
  return {
    status: requestedLineIds.length > 0 && missingLineIds.length > 0
      ? (lines.length > 0 ? 'partial' : 'no_match')
      : 'ok',
    result: {
      quote_id: quoteId,
      lines,
      field_set: [...QUOTE_LINE_ITEM_SNAPSHOT_FIELDS],
      counts: {
        returned: lines.length,
        requested: requestedLineIds.length,
        available_on_quote: lines.length,
        missing: missingLineIds.length
      },
      selection: {
        mode: requestedLineIds.length === 0 ? 'all_lines' : 'line_id_filter',
        requested_line_ids: requestedLineIds,
        missing_line_ids: missingLineIds
      }
    },
    warnings: missingLineIds.length > 0 ? [`Missing line ids: ${missingLineIds.join(', ')}`] : [],
    errors: [],
    evidence: [{
      claim: `Retrieved ${lines.length} persisted quote lines for ${quoteId}.`,
      evidence_level: 'org_proven',
      proof_source: [`lines:${quoteId}`],
      limitations: 'Test fixture evidence only.',
      source_refs: []
    }],
    query: `SELECT ${QUOTE_LINE_ITEM_SNAPSHOT_FIELDS.join(', ')} FROM QuoteLineItem WHERE QuoteId = '${quoteId}'`
  };
}

function createOverlayActionsPrimitiveResult(
  quoteId: string,
  overrides: Partial<OverlayActionsPrimitiveResult> = {}
): OverlayActionsPrimitiveResult {
  return {
    status: 'ok',
    status_detail: 'empty_overlay',
    result: {
      quote_id: quoteId,
      field_set: [...QUOTE_ACTION_OVERLAY_FIELDS],
      action_rows: [],
      line_action_links: [],
      provenance_summary: {
        action_types: [],
        linked_line_count: 0,
        action_row_count: 0
      }
    },
    warnings: [],
    errors: [],
    evidence: [{
      claim: `Retrieved QuoteAction lifecycle provenance overlay for ${quoteId}.`,
      evidence_level: 'org_proven',
      proof_source: [`actions:${quoteId}`],
      limitations: 'Test fixture evidence only.',
      source_refs: []
    }],
    queries: ['SELECT Id FROM QuoteAction'],
    ...overrides
  };
}

function createOverlayRelationshipsPrimitiveResult(
  quoteId: string,
  overrides: Partial<OverlayRelationshipsPrimitiveResult> = {}
): OverlayRelationshipsPrimitiveResult {
  return {
    status: 'ok',
    status_detail: 'empty_overlay',
    result: {
      quote_id: quoteId,
      relationship_rows: [],
      bundle_summary: {
        targeted_line_count: 0,
        relationship_count: 0,
        matched_line_ids: [],
        missing_line_ids: [],
        distinct_main_line_count: 0,
        distinct_associated_line_count: 0,
        root_line_count: 0,
        main_roles: [],
        associated_roles: []
      },
      pricing_inclusion_summary: {
        included_in_bundle_price_count: 0,
        other_pricing_count: 0,
        unknown_pricing_count: 0,
        price_inclusive_true_count: 0,
        price_inclusive_false_count: 0,
        price_inclusive_unknown_count: 0,
        associated_pricing_values: []
      }
    },
    warnings: [],
    errors: [],
    evidence: [{
      claim: `Retrieved QuoteLineRelationship structure overlay for ${quoteId}.`,
      evidence_level: 'org_proven',
      proof_source: [`relationships:${quoteId}`],
      limitations: 'Test fixture evidence only.',
      source_refs: []
    }],
    queries: {
      quote: 'SELECT Id FROM Quote',
      relationships: 'SELECT Id FROM QuoteLineRelationship'
    },
    ...overrides
  };
}

describe('explain-missing-price command', () => {
  it('renders the locked help text and requires quote-id', async () => {
    expect(renderExplainMissingPriceHelp()).toContain(
      'quote-runtime explain-missing-price --org-alias <alias> --quote-id <id> [--line-id <id> ...]'
    );
    expect(renderExplainMissingPriceHelp()).toContain('keeps lifecycle provenance and bundle inclusion as separate branches');
    await expect(parseExplainMissingPriceFlags([])).rejects.toThrow('Missing required flag quote-id');
  });

  it('builds a bundle-inclusion explanation without collapsing the lifecycle branch into it', () => {
    const envelope = buildExplainMissingPriceEnvelope({
      globalFlags: {
        help: false,
        json: false,
        orgAlias: 'ARM',
        failOn: undefined,
        output: undefined,
        verbose: false
      },
      commandFlags: {
        quoteId: '0Q0xx0000000200AAA',
        lineIds: ['0QLxx0000000201AAA']
      },
      lineSnapshot: createSnapshotLinesPrimitiveResult('0Q0xx0000000200AAA', linesBundleFixture, ['0QLxx0000000201AAA']),
      overlayActions: createOverlayActionsPrimitiveResult('0Q0xx0000000200AAA'),
      overlayRelationships: createOverlayRelationshipsPrimitiveResult('0Q0xx0000000200AAA', {
        status: 'ok',
        status_detail: 'relationships_found',
        result: {
          quote_id: '0Q0xx0000000200AAA',
          relationship_rows: relationshipBundleFixture,
          bundle_summary: {
            targeted_line_count: 1,
            relationship_count: 1,
            matched_line_ids: ['0QLxx0000000201AAA'],
            missing_line_ids: [],
            distinct_main_line_count: 1,
            distinct_associated_line_count: 1,
            root_line_count: 1,
            main_roles: ['Bundle'],
            associated_roles: ['Component']
          },
          pricing_inclusion_summary: {
            included_in_bundle_price_count: 1,
            other_pricing_count: 0,
            unknown_pricing_count: 0,
            price_inclusive_true_count: 1,
            price_inclusive_false_count: 0,
            price_inclusive_unknown_count: 0,
            associated_pricing_values: ['IncludedInBundlePrice']
          }
        }
      }),
      generatedAt: '2026-04-15T12:00:00.000Z',
      durationMs: 10
    });

    expect(envelope).toMatchObject({
      command: 'explain-missing-price',
      status: 'ok',
      summary: {
        primary_subject: '0Q0xx0000000200AAA (1 scoped line id(s))',
        primary_lane: 'quote_pricing',
        verification_anchor: 'quote:0Q0xx0000000200AAA:lines:0QLxx0000000201AAA',
        symptom_class: 'missing-price',
        next_suggested_command: 'overlay-relationships'
      },
      result: {
        symptom_class: 'missing-price',
        likely_root_cause_class: 'bundle_included_component',
        recommended_next_commands: ['overlay-relationships', 'inspect-rlm-context']
      },
      meta: {
        org_alias: 'ARM',
        duration_ms: 10
      }
    });

    expect(envelope.result.persisted_evidence).toContain(
      'Line 0QLxx0000000201AAA surfaces missing-or-zero persisted pricing in ListPrice, UnitPrice, NetUnitPrice, TotalPrice.'
    );
    expect(envelope.result.bundle_inclusion_findings).toEqual([
      'QuoteLineRelationship overlay found 1 IncludedInBundlePrice relationship row(s) in scope.'
    ]);
    expect(envelope.result.lifecycle_provenance_findings).toEqual([
      'QuoteAction overlay did not show lifecycle links for the targeted scope.'
    ]);
    expect(renderExplainMissingPriceText(envelope)).toContain('likely root cause class: bundle_included_component');
  });

  it('builds a lifecycle explanation without collapsing the structure branch into it', () => {
    const envelope = buildExplainMissingPriceEnvelope({
      globalFlags: {
        help: false,
        json: false,
        orgAlias: 'ARM',
        failOn: undefined,
        output: undefined,
        verbose: false
      },
      commandFlags: {
        quoteId: '0Q0xx0000000300AAA',
        lineIds: ['0QLxx0000000301AAA']
      },
      lineSnapshot: createSnapshotLinesPrimitiveResult('0Q0xx0000000300AAA', linesLifecycleFixture, ['0QLxx0000000301AAA']),
      overlayActions: createOverlayActionsPrimitiveResult('0Q0xx0000000300AAA', {
        status: 'ok',
        status_detail: 'actions_found',
        result: {
          quote_id: '0Q0xx0000000300AAA',
          field_set: [...QUOTE_ACTION_OVERLAY_FIELDS],
          action_rows: actionLifecycleFixture as never,
          line_action_links: [
            {
              line_id: '0QLxx0000000301AAA',
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
      overlayRelationships: createOverlayRelationshipsPrimitiveResult('0Q0xx0000000300AAA'),
      generatedAt: '2026-04-15T12:00:00.000Z',
      durationMs: 9
    });

    expect(envelope).toMatchObject({
      command: 'explain-missing-price',
      status: 'ok',
      summary: {
        next_suggested_command: 'overlay-actions'
      },
      result: {
        symptom_class: 'missing-price',
        likely_root_cause_class: 'lifecycle_provenance_gap',
        recommended_next_commands: ['overlay-actions', 'inspect-rlm-context']
      }
    });

    expect(envelope.result.bundle_inclusion_findings).toEqual([
      'QuoteLineRelationship overlay did not show bundle-inclusion semantics for the targeted scope.'
    ]);
    expect(envelope.result.lifecycle_provenance_findings).toEqual([
      'QuoteAction overlay linked 1 targeted line(s) to lifecycle actions.'
    ]);
    expect(renderExplainMissingPriceText(envelope)).toContain('likely root cause class: lifecycle_provenance_gap');
  });

  it('runs through the command entrypoint and emits the composed envelope', async () => {
    const stdout: string[] = [];
    const stderr: string[] = [];
    const executeSnapshotLines = vi.fn().mockResolvedValue(
      createSnapshotLinesPrimitiveResult('0Q0xx0000000300AAA', linesLifecycleFixture, ['0QLxx0000000301AAA'])
    );
    const executeOverlayActions = vi.fn().mockResolvedValue(
      createOverlayActionsPrimitiveResult('0Q0xx0000000300AAA', {
        status: 'ok',
        status_detail: 'actions_found',
        result: {
          quote_id: '0Q0xx0000000300AAA',
          field_set: [...QUOTE_ACTION_OVERLAY_FIELDS],
          action_rows: actionLifecycleFixture as never,
          line_action_links: [
            {
              line_id: '0QLxx0000000301AAA',
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
      })
    );
    const executeOverlayRelationships = vi.fn().mockResolvedValue(
      createOverlayRelationshipsPrimitiveResult('0Q0xx0000000300AAA')
    );

    const execution = await runExplainMissingPriceCommand(
      ['--quote-id', '0Q0xx0000000300AAA', '--line-id', '0QLxx0000000301AAA'],
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
      {
        executeSnapshotLines,
        executeOverlayActions,
        executeOverlayRelationships
      }
    );

    expect(execution.exitCode).toBe(0);
    expect(stderr).toEqual([]);
    expect(executeSnapshotLines).toHaveBeenCalledWith({
      orgAlias: 'ARM',
      quoteId: '0Q0xx0000000300AAA',
      lineIds: ['0QLxx0000000301AAA']
    });
    expect(executeOverlayActions).toHaveBeenCalledWith({
      orgAlias: 'ARM',
      quoteId: '0Q0xx0000000300AAA',
      lineIds: ['0QLxx0000000301AAA']
    });
    expect(executeOverlayRelationships).toHaveBeenCalledWith({
      orgAlias: 'ARM',
      quoteId: '0Q0xx0000000300AAA',
      lineIds: ['0QLxx0000000301AAA']
    });
    expect(JSON.parse(stdout.join(''))).toMatchObject({
      command: 'explain-missing-price',
      status: 'ok',
      result: {
        likely_root_cause_class: 'lifecycle_provenance_gap',
        recommended_next_commands: ['overlay-actions', 'inspect-rlm-context']
      }
    });
  });
});
