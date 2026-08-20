import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it, vi } from 'vitest';

import {
  buildSnapshotQuoteEnvelope,
  renderSnapshotQuoteHelp,
  renderSnapshotQuoteText,
  runSnapshotQuoteCommand
} from '../../src/commands/snapshot-quote';
import { QUOTE_SNAPSHOT_FIELDS } from '../../src/contracts/query-fields';
import type { SnapshotQuotePrimitiveResult, SnapshotQuoteRecord } from '../../src/primitives/snapshot-quote';

const fixturesDir = resolve(import.meta.dirname, '../fixtures/primitives/snapshot-quote');
const quoteRecordFixture = JSON.parse(readFileSync(resolve(fixturesDir, 'quote-record.json'), 'utf8')) as SnapshotQuoteRecord;

function createPrimitiveResult(overrides: Partial<SnapshotQuotePrimitiveResult> = {}): SnapshotQuotePrimitiveResult {
  return {
    status: 'ok',
    result: {
      quote: quoteRecordFixture,
      field_set: [...QUOTE_SNAPSHOT_FIELDS],
      snapshot_type: 'quote'
    },
    warnings: [],
    errors: [],
    evidence: [],
    query: 'SELECT Id FROM Quote',
    ...overrides
  };
}

describe('snapshot-quote command', () => {
  it('renders the locked help text', () => {
    expect(renderSnapshotQuoteHelp()).toContain('quote-runtime snapshot-quote --org-alias <alias> --quote-id <id>');
    expect(renderSnapshotQuoteHelp()).toContain('--quote-id <id>');
  });

  it('builds the result envelope shape around the primitive output', () => {
    const envelope = buildSnapshotQuoteEnvelope({
      globalFlags: {
        help: false,
        json: false,
        orgAlias: 'ARM',
        failOn: undefined,
        output: undefined,
        verbose: false
      },
      commandFlags: {
        quoteId: '0Q0xx0000000001AAA'
      },
      primitiveResult: createPrimitiveResult(),
      generatedAt: '2026-04-15T12:00:00.000Z',
      durationMs: 12
    });

    expect(envelope).toMatchObject({
      command: 'snapshot-quote',
      status: 'ok',
      summary: {
        primary_subject: '0Q0xx0000000001AAA',
        primary_lane: 'persisted_snapshot',
        verification_anchor: 'quote:0Q0xx0000000001AAA',
        next_suggested_command: null
      },
      result: {
        quote: quoteRecordFixture,
        field_set: [...QUOTE_SNAPSHOT_FIELDS],
        snapshot_type: 'quote'
      },
      warnings: [],
      errors: [],
      evidence: [],
      meta: {
        org_alias: 'ARM',
        duration_ms: 12
      }
    });
  });

  it('renders text output for both matched and unmatched quote snapshots', () => {
    const okEnvelope = buildSnapshotQuoteEnvelope({
      globalFlags: {
        help: false,
        json: false,
        orgAlias: 'ARM',
        failOn: undefined,
        output: undefined,
        verbose: false
      },
      commandFlags: {
        quoteId: '0Q0xx0000000001AAA'
      },
      primitiveResult: createPrimitiveResult(),
      generatedAt: '2026-04-15T12:00:00.000Z',
      durationMs: 0
    });

    expect(renderSnapshotQuoteText(okEnvelope)).toContain('quote-runtime snapshot-quote');
    expect(renderSnapshotQuoteText(okEnvelope)).toContain('status: ok');
    expect(renderSnapshotQuoteText(okEnvelope)).toContain('Id: 0Q0xx0000000001AAA');
    expect(renderSnapshotQuoteText(okEnvelope)).toContain('GrandTotal: 1400');

    const noMatchEnvelope = buildSnapshotQuoteEnvelope({
      globalFlags: {
        help: false,
        json: false,
        orgAlias: 'ARM',
        failOn: undefined,
        output: undefined,
        verbose: false
      },
      commandFlags: {
        quoteId: '0Q0xx0000000009AAA'
      },
      primitiveResult: createPrimitiveResult({
        status: 'no_match',
        result: {
          quote: null,
          field_set: [...QUOTE_SNAPSHOT_FIELDS],
          snapshot_type: 'quote'
        }
      }),
      generatedAt: '2026-04-15T12:00:00.000Z',
      durationMs: 0
    });

    expect(renderSnapshotQuoteText(noMatchEnvelope)).toContain('status: no_match');
    expect(renderSnapshotQuoteText(noMatchEnvelope)).toContain('quote: (none)');
  });

  it('runs through the command entry and emits the canonical envelope', async () => {
    const stdout: string[] = [];
    const stderr: string[] = [];
    const executeSnapshotQuote = vi.fn(async () => createPrimitiveResult());

    const execution = await runSnapshotQuoteCommand(
      ['--quote-id', '0Q0xx0000000001AAA'],
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
      { executeSnapshotQuote }
    );

    expect(execution.exitCode).toBe(0);
    expect(stderr).toEqual([]);
    expect(executeSnapshotQuote).toHaveBeenCalledWith(
      expect.objectContaining({
        orgAlias: 'ARM',
        quoteId: '0Q0xx0000000001AAA'
      })
    );
    expect(JSON.parse(stdout.join(''))).toMatchObject({
      command: 'snapshot-quote',
      status: 'ok',
      result: {
        snapshot_type: 'quote',
        field_set: [...QUOTE_SNAPSHOT_FIELDS]
      }
    });
  });
});
