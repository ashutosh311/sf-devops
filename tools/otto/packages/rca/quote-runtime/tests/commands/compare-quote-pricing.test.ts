import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it, vi } from 'vitest';

import {
  buildCompareQuotePricingEnvelope,
  parseCompareQuotePricingFlags,
  renderCompareQuotePricingHelp,
  renderCompareQuotePricingText,
  runCompareQuotePricingCommand
} from '../../src/commands/compare-quote-pricing';
import { QUOTE_LINE_ITEM_SNAPSHOT_FIELDS, QUOTE_SNAPSHOT_FIELDS } from '../../src/contracts/query-fields';
import type { SnapshotQuotePrimitiveResult, SnapshotQuoteRecord } from '../../src/primitives/snapshot-quote';
import type { SnapshotLineRecord, SnapshotLinesPrimitiveResult } from '../../src/primitives/snapshot-lines';

const fixturesDir = resolve(import.meta.dirname, '../fixtures/scenarios/compare-quote-pricing');
const beforeQuoteFixture = JSON.parse(readFileSync(resolve(fixturesDir, 'before-quote.json'), 'utf8')) as SnapshotQuoteRecord;
const afterQuoteFixture = JSON.parse(readFileSync(resolve(fixturesDir, 'after-quote.json'), 'utf8')) as SnapshotQuoteRecord;
const beforeLinesFixture = JSON.parse(readFileSync(resolve(fixturesDir, 'before-lines.json'), 'utf8')) as SnapshotLineRecord[];
const afterLinesFixture = JSON.parse(readFileSync(resolve(fixturesDir, 'after-lines.json'), 'utf8')) as SnapshotLineRecord[];

function createSnapshotQuotePrimitiveResult(
  quoteId: string,
  quote: SnapshotQuoteRecord | null
): SnapshotQuotePrimitiveResult {
  return {
    status: quote === null ? 'no_match' : 'ok',
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
  lines: SnapshotLineRecord[]
): SnapshotLinesPrimitiveResult {
  return {
    status: 'ok',
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

describe('compare-quote-pricing command', () => {
  it('renders the locked help text', () => {
    expect(renderCompareQuotePricingHelp()).toContain(
      'quote-runtime compare-quote-pricing --org-alias <alias> --before-quote-id <id> --after-quote-id <id>'
    );
  });

  it('requires both before and after quote selectors', async () => {
    await expect(parseCompareQuotePricingFlags(['--before-quote-id', '0Q0xx0000000001AAA'])).rejects.toThrow(
      'Missing required flag after-quote-id'
    );
    await expect(parseCompareQuotePricingFlags(['--after-quote-id', '0Q0xx0000000002AAA'])).rejects.toThrow(
      'Missing required flag before-quote-id'
    );
  });

  it('builds the persisted before/after diff composition in the result envelope', () => {
    const envelope = buildCompareQuotePricingEnvelope({
      globalFlags: {
        help: false,
        json: false,
        orgAlias: 'ARM',
        failOn: undefined,
        output: undefined,
        verbose: false
      },
      commandFlags: {
        beforeQuoteId: '0Q0xx0000000001AAA',
        afterQuoteId: '0Q0xx0000000002AAA'
      },
      beforeQuote: createSnapshotQuotePrimitiveResult('0Q0xx0000000001AAA', beforeQuoteFixture),
      beforeLines: createSnapshotLinesPrimitiveResult('0Q0xx0000000001AAA', beforeLinesFixture),
      afterQuote: createSnapshotQuotePrimitiveResult('0Q0xx0000000002AAA', afterQuoteFixture),
      afterLines: createSnapshotLinesPrimitiveResult('0Q0xx0000000002AAA', afterLinesFixture),
      generatedAt: '2026-04-15T12:00:00.000Z',
      durationMs: 24
    });

    expect(envelope).toMatchObject({
      command: 'compare-quote-pricing',
      status: 'changed',
      summary: {
        primary_subject: '0Q0xx0000000001AAA -> 0Q0xx0000000002AAA',
        primary_lane: 'persisted_comparison',
        verification_anchor: 'compare:0Q0xx0000000001AAA:0Q0xx0000000002AAA',
        next_suggested_command: 'inspect-pricing-waterfall'
      },
      result: {
        before_snapshot: {
          quote: beforeQuoteFixture,
          lines: beforeLinesFixture
        },
        after_snapshot: {
          quote: afterQuoteFixture,
          lines: afterLinesFixture
        },
        matching_strategy: {
          mode: 'cross_quote_conservative',
          same_quote: false,
          default_match_tiers: ['quote_action_source_asset_id', 'structural_key', 'structural_key_plus_line_number']
        },
        quote_diff: {
          changed_fields: ['Subtotal', 'TotalPrice', 'TotalPriceWithTax', 'GrandTotal']
        },
        line_diff: {
          added: [afterLinesFixture[1]],
          removed: [beforeLinesFixture[1]],
          changed: [
            {
              id: '0QLxx0000000001AAA',
              paired_id: '0QLxx0000000004AAA',
              match_basis: 'structural_key',
              changed_fields: ['LineNumber', 'NetTotalPrice', 'TotalPrice', 'TotalLineAmount', 'PriceWaterfallIdentifier']
            }
          ],
          ambiguous: []
        },
        changed_fields: [
          'quote.Subtotal',
          'quote.TotalPrice',
          'quote.TotalPriceWithTax',
          'quote.GrandTotal',
          'line.0QLxx0000000001AAA->0QLxx0000000004AAA.LineNumber',
          'line.0QLxx0000000001AAA->0QLxx0000000004AAA.NetTotalPrice',
          'line.0QLxx0000000001AAA->0QLxx0000000004AAA.TotalPrice',
          'line.0QLxx0000000001AAA->0QLxx0000000004AAA.TotalLineAmount',
          'line.0QLxx0000000001AAA->0QLxx0000000004AAA.PriceWaterfallIdentifier',
          'line.0QLxx0000000002AAA',
          'line.0QLxx0000000003AAA'
        ],
        recommended_next_commands: ['inspect-pricing-waterfall', 'inspect-rlm-context']
      },
      meta: {
        org_alias: 'ARM',
        duration_ms: 24
      }
    });

    expect(envelope.warnings).toContain(
      'Cross-quote line matching is conservative: same-quote comparisons use line Ids, while cross-quote comparisons only pair lines through unique QuoteAction.SourceAssetId or structural business keys and otherwise abstain.'
    );
    expect(renderCompareQuotePricingText(envelope)).toContain('status: changed');
    expect(renderCompareQuotePricingText(envelope)).toContain('matching mode: cross_quote_conservative');
    expect(renderCompareQuotePricingText(envelope)).toContain('changed fields: 11');
    expect(renderCompareQuotePricingText(envelope)).toContain('line diff counts: changed=1 added=1 removed=1 ambiguous=0');
    expect(renderCompareQuotePricingText(envelope)).toContain('recommended next commands: inspect-pricing-waterfall, inspect-rlm-context');
  });

  it('returns changed and no_change statuses with the expected recommended next commands', () => {
    const changedEnvelope = buildCompareQuotePricingEnvelope({
      globalFlags: {
        help: false,
        json: false,
        orgAlias: 'ARM',
        failOn: undefined,
        output: undefined,
        verbose: false
      },
      commandFlags: {
        beforeQuoteId: '0Q0xx0000000001AAA',
        afterQuoteId: '0Q0xx0000000002AAA'
      },
      beforeQuote: createSnapshotQuotePrimitiveResult('0Q0xx0000000001AAA', beforeQuoteFixture),
      beforeLines: createSnapshotLinesPrimitiveResult('0Q0xx0000000001AAA', beforeLinesFixture),
      afterQuote: createSnapshotQuotePrimitiveResult('0Q0xx0000000002AAA', afterQuoteFixture),
      afterLines: createSnapshotLinesPrimitiveResult('0Q0xx0000000002AAA', afterLinesFixture),
      generatedAt: '2026-04-15T12:00:00.000Z',
      durationMs: 0
    });

    const noChangeEnvelope = buildCompareQuotePricingEnvelope({
      globalFlags: {
        help: false,
        json: false,
        orgAlias: 'ARM',
        failOn: undefined,
        output: undefined,
        verbose: false
      },
      commandFlags: {
        beforeQuoteId: '0Q0xx0000000001AAA',
        afterQuoteId: '0Q0xx0000000001AAA'
      },
      beforeQuote: createSnapshotQuotePrimitiveResult('0Q0xx0000000001AAA', beforeQuoteFixture),
      beforeLines: createSnapshotLinesPrimitiveResult('0Q0xx0000000001AAA', beforeLinesFixture),
      afterQuote: createSnapshotQuotePrimitiveResult('0Q0xx0000000001AAA', beforeQuoteFixture),
      afterLines: createSnapshotLinesPrimitiveResult('0Q0xx0000000001AAA', beforeLinesFixture),
      generatedAt: '2026-04-15T12:00:00.000Z',
      durationMs: 0
    });

    expect(changedEnvelope.status).toBe('changed');
    expect(changedEnvelope.result.recommended_next_commands).toEqual(['inspect-pricing-waterfall', 'inspect-rlm-context']);
    expect(noChangeEnvelope.status).toBe('no_change');
    expect(noChangeEnvelope.summary.next_suggested_command).toBeNull();
    expect(noChangeEnvelope.result.recommended_next_commands).toEqual([]);
    expect(noChangeEnvelope.summary.status_reason).toBe(
      'Persisted before/after pricing snapshots are identical for the targeted quotes.'
    );
  });

  it('ignores identity and audit drift when pricing-relevant fields are unchanged', () => {
    const noPricingDriftEnvelope = buildCompareQuotePricingEnvelope({
      globalFlags: {
        help: false,
        json: false,
        orgAlias: 'ARM',
        failOn: undefined,
        output: undefined,
        verbose: false
      },
      commandFlags: {
        beforeQuoteId: '0Q0xx0000000001AAA',
        afterQuoteId: '0Q0xx0000000002AAA'
      },
      beforeQuote: createSnapshotQuotePrimitiveResult('0Q0xx0000000001AAA', beforeQuoteFixture),
      beforeLines: createSnapshotLinesPrimitiveResult('0Q0xx0000000001AAA', beforeLinesFixture),
      afterQuote: createSnapshotQuotePrimitiveResult('0Q0xx0000000002AAA', {
        ...beforeQuoteFixture,
        Id: '0Q0xx0000000002AAA',
        Name: 'Quote After',
        QuoteNumber: 'Q-0002',
        CreatedDate: '2026-04-02T00:00:00.000+0000',
        LastModifiedDate: '2026-04-02T00:00:00.000+0000'
      }),
      afterLines: createSnapshotLinesPrimitiveResult('0Q0xx0000000002AAA', beforeLinesFixture.map((line, index) => ({
        ...line,
        Id: index === 0 ? '0QLxx0000000101AAA' : '0QLxx0000000102AAA',
        QuoteId: '0Q0xx0000000002AAA',
        CreatedDate: '2026-04-02T00:00:00.000+0000',
        LastModifiedDate: '2026-04-02T00:00:00.000+0000'
      }))),
      generatedAt: '2026-04-15T12:00:00.000Z',
      durationMs: 0
    });

    const result = noPricingDriftEnvelope.result as {
      matching_strategy: { mode: string };
      quote_diff: { changed_fields: string[] };
      line_diff: { changed: unknown[]; ambiguous: unknown[] };
      changed_fields: string[];
    };

    expect(noPricingDriftEnvelope.status).toBe('no_change');
    expect(result.matching_strategy.mode).toBe('cross_quote_conservative');
    expect(noPricingDriftEnvelope.summary.next_suggested_command).toBeNull();
    expect(result.quote_diff.changed_fields).toEqual([]);
    expect(result.line_diff.changed).toEqual([]);
    expect(result.line_diff.ambiguous).toEqual([]);
    expect(result.changed_fields).toEqual([]);
  });

  it('runs through the command entry and composes the snapshot primitives plus compare-quotes helper', async () => {
    const stdout: string[] = [];
    const stderr: string[] = [];
    const executeSnapshotQuote = vi.fn(async ({ quoteId }: { quoteId: string }) =>
      quoteId === '0Q0xx0000000001AAA'
        ? createSnapshotQuotePrimitiveResult(quoteId, beforeQuoteFixture)
        : createSnapshotQuotePrimitiveResult(quoteId, afterQuoteFixture)
    );
    const executeSnapshotLines = vi.fn(async ({ quoteId }: { quoteId: string }) =>
      quoteId === '0Q0xx0000000001AAA'
        ? createSnapshotLinesPrimitiveResult(quoteId, beforeLinesFixture)
        : createSnapshotLinesPrimitiveResult(quoteId, afterLinesFixture)
    );

    const execution = await runCompareQuotePricingCommand(
      ['--before-quote-id', '0Q0xx0000000001AAA', '--after-quote-id', '0Q0xx0000000002AAA'],
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
    expect(executeSnapshotQuote).toHaveBeenNthCalledWith(1, { orgAlias: 'ARM', quoteId: '0Q0xx0000000001AAA' });
    expect(executeSnapshotQuote).toHaveBeenNthCalledWith(2, { orgAlias: 'ARM', quoteId: '0Q0xx0000000002AAA' });
    expect(executeSnapshotLines).toHaveBeenNthCalledWith(1, { orgAlias: 'ARM', quoteId: '0Q0xx0000000001AAA', lineIds: [] });
    expect(executeSnapshotLines).toHaveBeenNthCalledWith(2, { orgAlias: 'ARM', quoteId: '0Q0xx0000000002AAA', lineIds: [] });
    expect(JSON.parse(stdout.join(''))).toMatchObject({
      command: 'compare-quote-pricing',
      status: 'changed',
      result: {
        recommended_next_commands: ['inspect-pricing-waterfall', 'inspect-rlm-context']
      }
    });
  });
});
