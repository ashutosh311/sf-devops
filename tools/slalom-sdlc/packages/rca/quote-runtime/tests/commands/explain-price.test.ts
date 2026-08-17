import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it, vi } from 'vitest';

import {
  buildExplainPriceEnvelope,
  parseExplainPriceFlags,
  renderExplainPriceHelp,
  renderExplainPriceText,
  runExplainPriceCommand
} from '../../src/commands/explain-price';
import { QUOTE_LINE_ITEM_SNAPSHOT_FIELDS, QUOTE_SNAPSHOT_FIELDS } from '../../src/contracts/query-fields';
import type { SnapshotQuotePrimitiveResult, SnapshotQuoteRecord } from '../../src/primitives/snapshot-quote';
import type { SnapshotLineRecord, SnapshotLinesPrimitiveResult } from '../../src/primitives/snapshot-lines';

const fixturesDir = resolve(import.meta.dirname, '../fixtures/scenarios/explain-price');
const quoteFixture = JSON.parse(readFileSync(resolve(fixturesDir, 'quote.json'), 'utf8')) as SnapshotQuoteRecord;
const linesPersistedExplainsFixture = JSON.parse(
  readFileSync(resolve(fixturesDir, 'lines-persisted-explains.json'), 'utf8')
) as SnapshotLineRecord[];
const linesContextNeededFixture = JSON.parse(
  readFileSync(resolve(fixturesDir, 'lines-context-needed.json'), 'utf8')
) as SnapshotLineRecord[];

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
  lines: SnapshotLineRecord[],
  requestedLineIds: string[] = []
): SnapshotLinesPrimitiveResult {
  const missingLineIds = requestedLineIds.filter((lineId) => !lines.some((line) => String(line.Id) === lineId));
  return {
    status: requestedLineIds.length > 0 && missingLineIds.length > 0 ? 'partial' : 'ok',
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

describe('explain-price command', () => {
  it('renders the locked help text', () => {
    expect(renderExplainPriceHelp()).toContain(
      'quote-runtime explain-price --org-alias <alias> --quote-id <id> [--line-id <id> ...] --expected-change <text>'
    );
    expect(renderExplainPriceHelp()).toContain('stays persisted-first');
    expect(renderExplainPriceHelp()).toContain('only escalates to inspect-rlm-context when persisted quote and line evidence does not explain the unexpected price');
  });

  it('requires quote-id and expected-change selectors', async () => {
    await expect(parseExplainPriceFlags(['--expected-change', 'line should be discounted'])).rejects.toThrow(
      'Missing required flag quote-id'
    );
    await expect(parseExplainPriceFlags(['--quote-id', '0Q0xx0000000100AAA'])).rejects.toThrow(
      'Missing required flag expected-change'
    );
  });

  it('uses persisted-first reasoning when quote and line snapshots already explain the price', () => {
    const envelope = buildExplainPriceEnvelope({
      globalFlags: {
        help: false,
        json: false,
        orgAlias: 'ARM',
        failOn: undefined,
        output: undefined,
        verbose: false
      },
      commandFlags: {
        quoteId: '0Q0xx0000000100AAA',
        lineIds: ['0QLxx0000000101AAA'],
        expectedChange: 'line should use the discounted renewal price'
      },
      quoteSnapshot: createSnapshotQuotePrimitiveResult('0Q0xx0000000100AAA', quoteFixture),
      lineSnapshot: createSnapshotLinesPrimitiveResult(
        '0Q0xx0000000100AAA',
        linesPersistedExplainsFixture,
        ['0QLxx0000000101AAA']
      ),
      generatedAt: '2026-04-15T12:00:00.000Z',
      durationMs: 8
    });

    expect(envelope).toMatchObject({
      command: 'explain-price',
      status: 'ok',
      summary: {
        primary_subject: '0Q0xx0000000100AAA (1 scoped line id(s))',
        primary_lane: 'quote_pricing',
        verification_anchor: 'quote:0Q0xx0000000100AAA:lines:0QLxx0000000101AAA',
        symptom_class: 'wrong-price',
        next_suggested_command: null
      },
      result: {
        symptom_class: 'wrong-price',
        context_bridge_needed: false,
        recommended_next_commands: []
      },
      meta: {
        org_alias: 'ARM',
        duration_ms: 8
      }
    });

    expect(envelope.result.persisted_evidence).toContain(
      'Line 0QLxx0000000101AAA carries persisted TotalAdjustmentAmount -15, so the current price is already diverging from the base list price inside persisted quote data.'
    );
    expect(envelope.result.overlay_findings).toEqual([
      'Shared route logic classified the scenario as wrong-price and did not require lifecycle or structure overlays for the persisted explanation.'
    ]);
    expect(renderExplainPriceText(envelope)).toContain('status: ok');
    expect(renderExplainPriceText(envelope)).toContain('context bridge needed: no');
    expect(renderExplainPriceText(envelope)).toContain('recommended next commands: (none)');
  });

  it('escalates to inspect-rlm-context only when persisted evidence does not explain the unexpected price', () => {
    const envelope = buildExplainPriceEnvelope({
      globalFlags: {
        help: false,
        json: false,
        orgAlias: 'ARM',
        failOn: undefined,
        output: undefined,
        verbose: false
      },
      commandFlags: {
        quoteId: '0Q0xx0000000100AAA',
        lineIds: ['0QLxx0000000102AAA'],
        expectedChange: 'line should have repriced after the metadata change'
      },
      quoteSnapshot: createSnapshotQuotePrimitiveResult('0Q0xx0000000100AAA', quoteFixture),
      lineSnapshot: createSnapshotLinesPrimitiveResult(
        '0Q0xx0000000100AAA',
        linesContextNeededFixture,
        ['0QLxx0000000102AAA']
      ),
      generatedAt: '2026-04-15T12:00:00.000Z',
      durationMs: 9
    });

    expect(envelope).toMatchObject({
      command: 'explain-price',
      status: 'partial',
      summary: {
        next_suggested_command: 'inspect-rlm-context'
      },
      result: {
        symptom_class: 'wrong-price',
        context_bridge_needed: true,
        recommended_next_commands: ['inspect-rlm-context']
      }
    });

    expect(envelope.result.persisted_evidence).toContain(
      'Line 0QLxx0000000102AAA stays present with persisted ListPrice 52.5, UnitPrice 52.5, NetUnitPrice 52.5, TotalAdjustmentAmount 0, and TotalPrice 105.'
    );
    expect(renderExplainPriceText(envelope)).toContain('status: partial');
    expect(renderExplainPriceText(envelope)).toContain('context bridge needed: yes');
    expect(renderExplainPriceText(envelope)).toContain('recommended next commands: inspect-rlm-context');
  });

  it('gives coherent remediation guidance when only part of the requested line scope resolves', () => {
    const envelope = buildExplainPriceEnvelope({
      globalFlags: {
        help: false,
        json: false,
        orgAlias: 'ARM',
        failOn: undefined,
        output: undefined,
        verbose: false
      },
      commandFlags: {
        quoteId: '0Q0xx0000000100AAA',
        lineIds: ['0QLxx0000000101AAA', '0QLxx0000000999AAA'],
        expectedChange: 'both targeted lines should carry the discounted renewal price'
      },
      quoteSnapshot: createSnapshotQuotePrimitiveResult('0Q0xx0000000100AAA', quoteFixture),
      lineSnapshot: createSnapshotLinesPrimitiveResult(
        '0Q0xx0000000100AAA',
        linesPersistedExplainsFixture,
        ['0QLxx0000000101AAA', '0QLxx0000000999AAA']
      ),
      generatedAt: '2026-04-15T12:00:00.000Z',
      durationMs: 7
    });

    expect(envelope).toMatchObject({
      command: 'explain-price',
      status: 'partial',
      summary: {
        next_suggested_command: 'snapshot-lines',
        status_reason:
          "Explain-price only resolved part of the requested line scope for 'both targeted lines should carry the discounted renewal price', so rerun snapshot-lines or explain-price with line ids that exist on the quote before escalating."
      },
      result: {
        symptom_class: 'wrong-price',
        context_bridge_needed: false,
        recommended_next_commands: ['snapshot-lines']
      }
    });

    expect(envelope.result.persisted_evidence).toContain(
      "Persisted analysis resolved 1 of 2 requested line(s) for expected change 'both targeted lines should carry the discounted renewal price'. Missing requested line ids: 0QLxx0000000999AAA."
    );
    expect(envelope.result.overlay_findings).toEqual([
      'Shared route logic kept lifecycle and structure overlays out of scope because explain-price could only resolve 1 of 2 requested line ids from persisted data.'
    ]);
    expect(envelope.warnings).toEqual(['Missing line ids: 0QLxx0000000999AAA']);
    expect(renderExplainPriceText(envelope)).toContain('status: partial');
    expect(renderExplainPriceText(envelope)).toContain('context bridge needed: no');
    expect(renderExplainPriceText(envelope)).toContain('recommended next commands: snapshot-lines');
  });

  it('runs through the command entrypoint and emits the composed envelope', async () => {
    const stdout: string[] = [];
    const stderr: string[] = [];
    const executeSnapshotQuote = vi.fn().mockResolvedValue(
      createSnapshotQuotePrimitiveResult('0Q0xx0000000100AAA', quoteFixture)
    );
    const executeSnapshotLines = vi.fn().mockResolvedValue(
      createSnapshotLinesPrimitiveResult('0Q0xx0000000100AAA', linesPersistedExplainsFixture, ['0QLxx0000000101AAA'])
    );

    const execution = await runExplainPriceCommand(
      [
        '--quote-id',
        '0Q0xx0000000100AAA',
        '--line-id',
        '0QLxx0000000101AAA',
        '--expected-change',
        'line should use the discounted renewal price'
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

    expect(executeSnapshotQuote).toHaveBeenCalledWith({ orgAlias: 'ARM', quoteId: '0Q0xx0000000100AAA' });
    expect(executeSnapshotLines).toHaveBeenCalledWith({
      orgAlias: 'ARM',
      quoteId: '0Q0xx0000000100AAA',
      lineIds: ['0QLxx0000000101AAA']
    });
    expect(execution.exitCode).toBe(0);
    expect(stderr).toEqual([]);
    expect(JSON.parse(stdout.join(''))).toMatchObject({
      command: 'explain-price',
      status: 'ok',
      result: {
        symptom_class: 'wrong-price',
        context_bridge_needed: false,
        recommended_next_commands: []
      }
    });
  });
});
