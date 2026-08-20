import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it, vi } from 'vitest';

import {
  buildTestPricingChangeEnvelope,
  parseTestPricingChangeFlags,
  renderTestPricingChangeHelp,
  renderTestPricingChangeText,
  runTestPricingChangeCommand
} from '../../src/commands/test-pricing-change';
import { QUOTE_LINE_ITEM_SNAPSHOT_FIELDS, QUOTE_SNAPSHOT_FIELDS } from '../../src/contracts/query-fields';
import type { SnapshotLineRecord, SnapshotLinesPrimitiveResult } from '../../src/primitives/snapshot-lines';
import type { SnapshotQuotePrimitiveResult, SnapshotQuoteRecord } from '../../src/primitives/snapshot-quote';

const fixturesDir = resolve(import.meta.dirname, '../fixtures/scenarios/test-pricing-change');
const quoteFixture = JSON.parse(readFileSync(resolve(fixturesDir, 'quote.json'), 'utf8')) as SnapshotQuoteRecord;
const linesFixture = JSON.parse(readFileSync(resolve(fixturesDir, 'lines.json'), 'utf8')) as SnapshotLineRecord[];

function createSnapshotQuotePrimitiveResult(
  quoteId: string,
  quote: SnapshotQuoteRecord | null,
  status: SnapshotQuotePrimitiveResult['status'] = quote === null ? 'no_match' : 'ok'
): SnapshotQuotePrimitiveResult {
  return {
    status,
    result: {
      quote,
      field_set: [...QUOTE_SNAPSHOT_FIELDS],
      snapshot_type: 'quote'
    },
    warnings: [],
    errors: [],
    evidence: quote === null ? [] : [{
      claim: `Retrieved persisted quote snapshot for ${quoteId}.`,
      evidence_level: 'org_proven',
      proof_source: [`quote:${quoteId}`],
      limitations: 'Test fixture evidence only.',
      source_refs: []
    }],
    query: `SELECT ${QUOTE_SNAPSHOT_FIELDS.join(', ')} FROM Quote WHERE Id = '${quoteId}'`
  };
}

function createSnapshotLinesPrimitiveResult(
  quoteId: string,
  lines: SnapshotLineRecord[],
  status: SnapshotLinesPrimitiveResult['status'] = 'ok'
): SnapshotLinesPrimitiveResult {
  return {
    status,
    result: {
      quote_id: quoteId,
      lines,
      field_set: [...QUOTE_LINE_ITEM_SNAPSHOT_FIELDS],
      counts: {
        returned: lines.length,
        requested: 0,
        available_on_quote: lines.length,
        missing: 0
      },
      selection: {
        mode: 'all_lines',
        requested_line_ids: [],
        missing_line_ids: []
      }
    },
    warnings: [],
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

describe('test-pricing-change command', () => {
  it('renders the locked help text and read-only notes', () => {
    expect(renderTestPricingChangeHelp()).toContain(
      'quote-runtime test-pricing-change --org-alias <alias> --quote-id <id> --changed-artifact <text> [--expected-change <text>]'
    );
    expect(renderTestPricingChangeHelp()).toContain('remains explicitly read-only in V1');
    expect(renderTestPricingChangeHelp()).toContain('assumes the pricing change already happened outside the command');
  });

  it('requires quote-id and changed-artifact selectors', async () => {
    await expect(parseTestPricingChangeFlags(['--changed-artifact', 'pricing procedure v2'])).rejects.toThrow(
      'Missing required flag quote-id'
    );
    await expect(parseTestPricingChangeFlags(['--quote-id', '0Q0xx0000000200AAA'])).rejects.toThrow(
      'Missing required flag changed-artifact'
    );
  });

  it('builds a read-only current-state validation envelope with locked result fields only', () => {
    const envelope = buildTestPricingChangeEnvelope({
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
        changedArtifact: 'pricing procedure v2',
        expectedChange: 'quote should now use the discounted renewal price'
      },
      quoteSnapshot: createSnapshotQuotePrimitiveResult('0Q0xx0000000200AAA', quoteFixture),
      lineSnapshot: createSnapshotLinesPrimitiveResult('0Q0xx0000000200AAA', linesFixture),
      generatedAt: '2026-04-15T12:00:00.000Z',
      durationMs: 15
    });

    expect(envelope).toMatchObject({
      command: 'test-pricing-change',
      status: 'warn',
      summary: {
        primary_subject: '0Q0xx0000000200AAA',
        primary_lane: 'quote_pricing',
        verification_anchor: '0Q0xx0000000200AAA',
        symptom_class: 'wrong-price',
        next_suggested_command: 'compare-quote-pricing'
      },
      result: {
        changed_artifact: 'pricing procedure v2',
        before_after_summary: {
          comparison_type: 'current_quote_vs_line_rollup',
          comparison_available: true,
          historical_before_after_available: false,
          comparison_status: 'no_change',
          changed_fields: []
        },
        recommended_next_commands: ['compare-quote-pricing']
      },
      meta: {
        org_alias: 'ARM',
        duration_ms: 15
      }
    });

    expect(Object.keys(envelope.result).sort()).toEqual([
      'before_after_summary',
      'changed_artifact',
      'escalation_hints',
      'persisted_findings',
      'recommended_next_commands'
    ]);
    expect(envelope.result.persisted_findings).toMatchObject([
      { finding_type: 'quote_snapshot', status: 'ok' },
      { finding_type: 'line_snapshot', status: 'ok' },
      { finding_type: 'current_state_consistency', status: 'no_change', changed_fields: [] }
    ]);
    expect(envelope.result.escalation_hints).toEqual([
      {
        lane: 'pricing-runtime-debug',
        recommended_command: 'compare-quote-pricing',
        when: 'Use when you can supply a separate before quote and want a true persisted before/after diff.',
        why: 'This command has no historical before selector in V1, so compare-quote-pricing is the explicit diff lane.'
      }
    ]);
    expect(envelope.warnings).toEqual([
      'test-pricing-change is read-only in V1 and does not perform runtime mutation or repricing execution.'
    ]);
    expect(renderTestPricingChangeText(envelope)).toContain('status: warn');
    expect(renderTestPricingChangeText(envelope)).toContain('comparison status: no_change');
    expect(renderTestPricingChangeText(envelope)).toContain('recommended next commands: compare-quote-pricing');
    expect(renderTestPricingChangeText(envelope)).not.toContain('validation mode');
    expect(renderTestPricingChangeText(envelope)).not.toContain('operation family');
  });

  it('escalates to inspect-rlm-context when current quote totals do not align with line rollups', () => {
    const envelope = buildTestPricingChangeEnvelope({
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
        changedArtifact: 'pricing procedure v2',
        expectedChange: 'quote should now use the discounted renewal price'
      },
      quoteSnapshot: createSnapshotQuotePrimitiveResult('0Q0xx0000000200AAA', {
        ...quoteFixture,
        TotalPrice: 220,
        Subtotal: 220
      }),
      lineSnapshot: createSnapshotLinesPrimitiveResult('0Q0xx0000000200AAA', linesFixture),
      generatedAt: '2026-04-15T12:00:00.000Z',
      durationMs: 11
    });

    expect(envelope.status).toBe('warn');
    expect(envelope.summary.next_suggested_command).toBe('inspect-rlm-context');
    expect(envelope.result.before_after_summary).toMatchObject({
      comparison_status: 'changed',
      changed_fields: ['Subtotal', 'TotalPrice']
    });
    expect(envelope.result.recommended_next_commands).toEqual(['inspect-rlm-context', 'compare-quote-pricing']);
    expect(envelope.result.escalation_hints[0]).toEqual({
      lane: 'runtime-context-inspection',
      recommended_command: 'inspect-rlm-context',
      when: 'Use when current quote totals and current line rollups disagree or the persisted outcome still looks wrong.',
      why: 'Persisted evidence alone did not fully explain the observed pricing state.'
    });
    expect(renderTestPricingChangeText(envelope)).toContain('comparison status: changed');
    expect(renderTestPricingChangeText(envelope)).toContain('recommended next commands: inspect-rlm-context, compare-quote-pricing');
  });

  it('stays read-only at the command entrypoint without composing pst-plan state', async () => {
    const stdout: string[] = [];
    const stderr: string[] = [];
    const executeSnapshotQuote = vi.fn(async ({ quoteId }: { quoteId: string }) =>
      createSnapshotQuotePrimitiveResult(quoteId, quoteFixture)
    );
    const executeSnapshotLines = vi.fn(async ({ quoteId }: { quoteId: string }) =>
      createSnapshotLinesPrimitiveResult(quoteId, linesFixture)
    );

    const execution = await runTestPricingChangeCommand(
      [
        '--quote-id',
        '0Q0xx0000000200AAA',
        '--changed-artifact',
        'pricing procedure v2',
        '--expected-change',
        'quote should now use the discounted renewal price'
      ],
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
        executeSnapshotQuote,
        executeSnapshotLines
      }
    );

    expect(execution.exitCode).toBe(0);
    expect(stderr).toEqual([]);
    expect(executeSnapshotQuote).toHaveBeenCalledWith({ orgAlias: 'ARM', quoteId: '0Q0xx0000000200AAA' });
    expect(executeSnapshotLines).toHaveBeenCalledWith({ orgAlias: 'ARM', quoteId: '0Q0xx0000000200AAA', lineIds: [] });
    const json = JSON.parse(stdout.join('')) as { result: Record<string, unknown>; warnings: string[] };
    expect(Object.keys(json.result).sort()).toEqual([
      'before_after_summary',
      'changed_artifact',
      'escalation_hints',
      'persisted_findings',
      'recommended_next_commands'
    ]);
    expect(json).toMatchObject({
      result: {
        changed_artifact: 'pricing procedure v2',
        recommended_next_commands: ['compare-quote-pricing']
      },
      warnings: [
        'test-pricing-change is read-only in V1 and does not perform runtime mutation or repricing execution.'
      ]
    });
  });
});
