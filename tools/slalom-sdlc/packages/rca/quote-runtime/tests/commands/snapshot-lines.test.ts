import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it, vi } from 'vitest';

import {
  buildSnapshotLinesEnvelope,
  renderSnapshotLinesHelp,
  renderSnapshotLinesText,
  runSnapshotLinesCommand
} from '../../src/commands/snapshot-lines';
import { QUOTE_LINE_ITEM_SNAPSHOT_FIELDS } from '../../src/contracts/query-fields';
import type { SnapshotLineRecord, SnapshotLinesPrimitiveResult } from '../../src/primitives/snapshot-lines';

const fixturesDir = resolve(import.meta.dirname, '../fixtures/primitives/snapshot-lines');
const lineRecordsFixture = JSON.parse(readFileSync(resolve(fixturesDir, 'line-records.json'), 'utf8')) as SnapshotLineRecord[];

function createPrimitiveResult(overrides: Partial<SnapshotLinesPrimitiveResult> = {}): SnapshotLinesPrimitiveResult {
  return {
    status: 'ok',
    result: {
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
    },
    warnings: [],
    errors: [],
    evidence: [],
    query: 'SELECT Id FROM QuoteLineItem',
    ...overrides
  };
}

describe('snapshot-lines command', () => {
  it('renders the locked help text', () => {
    expect(renderSnapshotLinesHelp()).toContain('quote-runtime snapshot-lines --org-alias <alias> --quote-id <id> [--line-id <id> ...]');
    expect(renderSnapshotLinesHelp()).toContain('--line-id <id> (repeatable)');
  });

  it('builds the result envelope shape around the primitive output', () => {
    const envelope = buildSnapshotLinesEnvelope({
      globalFlags: {
        help: false,
        json: false,
        orgAlias: 'ARM',
        failOn: undefined,
        output: undefined,
        verbose: false
      },
      commandFlags: {
        quoteId: '0Q0xx0000000001AAA',
        lineIds: []
      },
      primitiveResult: createPrimitiveResult(),
      generatedAt: '2026-04-15T12:00:00.000Z',
      durationMs: 18
    });

    expect(envelope).toMatchObject({
      command: 'snapshot-lines',
      status: 'ok',
      summary: {
        primary_subject: '0Q0xx0000000001AAA',
        primary_lane: 'persisted_snapshot',
        verification_anchor: 'quote:0Q0xx0000000001AAA',
        next_suggested_command: null,
        key_counts: {
          returned_lines: 3,
          requested_lines: 0,
          missing_lines: 0,
          available_lines: 3
        }
      },
      result: {
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
      },
      warnings: [],
      errors: [],
      evidence: [],
      meta: {
        org_alias: 'ARM',
        duration_ms: 18
      }
    });
  });

  it('renders text output for matched, partial, and no-match line snapshots', () => {
    const okEnvelope = buildSnapshotLinesEnvelope({
      globalFlags: {
        help: false,
        json: false,
        orgAlias: 'ARM',
        failOn: undefined,
        output: undefined,
        verbose: false
      },
      commandFlags: {
        quoteId: '0Q0xx0000000001AAA',
        lineIds: []
      },
      primitiveResult: createPrimitiveResult(),
      generatedAt: '2026-04-15T12:00:00.000Z',
      durationMs: 0
    });

    expect(renderSnapshotLinesText(okEnvelope)).toContain('quote-runtime snapshot-lines');
    expect(renderSnapshotLinesText(okEnvelope)).toContain('status: ok');
    expect(renderSnapshotLinesText(okEnvelope)).toContain('counts: returned=3 requested=0 available_on_quote=3 missing=0');
    expect(renderSnapshotLinesText(okEnvelope)).toContain('Id: 0QLxx0000000001AAA');
    expect(renderSnapshotLinesText(okEnvelope)).toContain('QuoteAction.Type: Amend');

    const partialEnvelope = buildSnapshotLinesEnvelope({
      globalFlags: {
        help: false,
        json: false,
        orgAlias: 'ARM',
        failOn: undefined,
        output: undefined,
        verbose: false
      },
      commandFlags: {
        quoteId: '0Q0xx0000000001AAA',
        lineIds: ['0QLxx0000000002AAA', '0QLxx0000000999AAA']
      },
      primitiveResult: createPrimitiveResult({
        status: 'partial',
        result: {
          ...createPrimitiveResult().result,
          lines: [lineRecordsFixture[1]],
          counts: {
            returned: 1,
            requested: 2,
            available_on_quote: 3,
            missing: 1
          },
          selection: {
            mode: 'line_id_filter',
            requested_line_ids: ['0QLxx0000000002AAA', '0QLxx0000000999AAA'],
            missing_line_ids: ['0QLxx0000000999AAA']
          }
        },
        warnings: ["Requested line ids not found on quote '0Q0xx0000000001AAA': 0QLxx0000000999AAA."]
      }),
      generatedAt: '2026-04-15T12:00:00.000Z',
      durationMs: 0
    });

    expect(renderSnapshotLinesText(partialEnvelope)).toContain('status: partial');
    expect(renderSnapshotLinesText(partialEnvelope)).toContain('selection: line_id_filter');
    expect(renderSnapshotLinesText(partialEnvelope)).toContain('missing line ids: 0QLxx0000000999AAA');

    const noMatchEnvelope = buildSnapshotLinesEnvelope({
      globalFlags: {
        help: false,
        json: false,
        orgAlias: 'ARM',
        failOn: undefined,
        output: undefined,
        verbose: false
      },
      commandFlags: {
        quoteId: '0Q0xx0000000001AAA',
        lineIds: ['0QLxx0000000998AAA']
      },
      primitiveResult: createPrimitiveResult({
        status: 'no_match',
        result: {
          ...createPrimitiveResult().result,
          lines: [],
          counts: {
            returned: 0,
            requested: 1,
            available_on_quote: 3,
            missing: 1
          },
          selection: {
            mode: 'line_id_filter',
            requested_line_ids: ['0QLxx0000000998AAA'],
            missing_line_ids: ['0QLxx0000000998AAA']
          }
        }
      }),
      generatedAt: '2026-04-15T12:00:00.000Z',
      durationMs: 0
    });

    expect(renderSnapshotLinesText(noMatchEnvelope)).toContain('status: no_match');
    expect(renderSnapshotLinesText(noMatchEnvelope)).toContain('lines: (none)');
  });

  it('classifies empty default all-lines output as ok in the envelope summary', () => {
    const envelope = buildSnapshotLinesEnvelope({
      globalFlags: {
        help: false,
        json: false,
        orgAlias: 'ARM',
        failOn: undefined,
        output: undefined,
        verbose: false
      },
      commandFlags: {
        quoteId: '0Q0xx0000000001AAA',
        lineIds: []
      },
      primitiveResult: createPrimitiveResult({
        status: 'ok',
        result: {
          ...createPrimitiveResult().result,
          lines: [],
          counts: {
            returned: 0,
            requested: 0,
            available_on_quote: 0,
            missing: 0
          },
          selection: {
            mode: 'all_lines',
            requested_line_ids: [],
            missing_line_ids: []
          }
        }
      }),
      generatedAt: '2026-04-15T12:00:00.000Z',
      durationMs: 0
    });

    expect(envelope.status).toBe('ok');
    expect(envelope.summary.status_reason).toBe('Retrieved 0 persisted quote lines for 0Q0xx0000000001AAA.');
    expect(renderSnapshotLinesText(envelope)).toContain('status: ok');
    expect(renderSnapshotLinesText(envelope)).toContain('lines: (none)');
  });

  it('runs through the command entry, deduplicates repeated line ids, and emits the canonical envelope', async () => {
    const stdout: string[] = [];
    const stderr: string[] = [];
    const executeSnapshotLines = vi.fn(async () => createPrimitiveResult());

    const execution = await runSnapshotLinesCommand(
      ['--quote-id', '0Q0xx0000000001AAA', '--line-id', '0QLxx0000000002AAA', '--line-id', '0QLxx0000000001AAA', '--line-id', '0QLxx0000000002AAA'],
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
      { executeSnapshotLines }
    );

    expect(execution.exitCode).toBe(0);
    expect(stderr).toEqual([]);
    expect(executeSnapshotLines).toHaveBeenCalledWith(
      expect.objectContaining({
        orgAlias: 'ARM',
        quoteId: '0Q0xx0000000001AAA',
        lineIds: ['0QLxx0000000002AAA', '0QLxx0000000001AAA']
      })
    );
    expect(JSON.parse(stdout.join(''))).toMatchObject({
      command: 'snapshot-lines',
      status: 'ok',
      result: {
        field_set: [...QUOTE_LINE_ITEM_SNAPSHOT_FIELDS],
        counts: {
          returned: 3,
          requested: 0,
          available_on_quote: 3,
          missing: 0
        }
      }
    });
  });
});
