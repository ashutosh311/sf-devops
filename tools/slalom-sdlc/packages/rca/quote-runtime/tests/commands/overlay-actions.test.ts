import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it, vi } from 'vitest';

import {
  buildOverlayActionsEnvelope,
  renderOverlayActionsHelp,
  renderOverlayActionsText,
  runOverlayActionsCommand
} from '../../src/commands/overlay-actions';
import { QUOTE_ACTION_OVERLAY_FIELDS } from '../../src/contracts/query-fields';
import type { OverlayActionsPrimitiveResult } from '../../src/primitives/overlay-actions';

const fixturesDir = resolve(import.meta.dirname, '../fixtures/primitives/overlay-actions');
const actionRowsFixture = JSON.parse(readFileSync(resolve(fixturesDir, 'action-rows.json'), 'utf8')) as Array<Record<string, unknown>>;

function createPrimitiveResult(overrides: Partial<OverlayActionsPrimitiveResult> = {}): OverlayActionsPrimitiveResult {
  return {
    status: 'ok',
    status_detail: 'actions_found',
    result: {
      quote_id: '0Q0xx0000000001AAA',
      field_set: [...QUOTE_ACTION_OVERLAY_FIELDS],
      action_rows: actionRowsFixture,
      line_action_links: [
        {
          line_id: '0QLxx0000000001AAA',
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
    },
    warnings: [],
    errors: [],
    evidence: [],
    queries: ['SELECT Id FROM Quote'],
    ...overrides
  };
}

describe('overlay-actions command', () => {
  it('renders help for the locked command grammar', () => {
    expect(renderOverlayActionsHelp()).toContain('quote-runtime overlay-actions --org-alias <alias> --quote-id <id> [--line-id <id> ...]');
    expect(renderOverlayActionsHelp()).toContain('--line-id <id>');
  });

  it('builds the result envelope around lifecycle provenance output only', () => {
    const envelope = buildOverlayActionsEnvelope({
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
        lineIds: ['0QLxx0000000001AAA']
      },
      primitiveResult: createPrimitiveResult(),
      generatedAt: '2026-04-15T12:00:00.000Z',
      durationMs: 12
    });

    expect(envelope).toMatchObject({
      command: 'overlay-actions',
      status: 'ok',
      summary: {
        primary_subject: '0Q0xx0000000001AAA',
        primary_lane: 'lifecycle_provenance',
        verification_anchor: 'quote:0Q0xx0000000001AAA',
        next_suggested_command: null
      },
      result: {
        quote_id: '0Q0xx0000000001AAA',
        field_set: [...QUOTE_ACTION_OVERLAY_FIELDS],
        action_rows: actionRowsFixture,
        line_action_links: [
          {
            line_id: '0QLxx0000000001AAA',
            quote_action_id: '7oca50000JAnrYLAQZ'
          }
        ],
        provenance_summary: {
          action_types: ['Amend'],
          linked_line_count: 1,
          action_row_count: 1
        }
      },
      meta: {
        org_alias: 'ARM',
        duration_ms: 12
      }
    });
  });

  it('uses primitive status detail to preserve no_match status_reason fidelity', () => {
    const quoteAbsentEnvelope = buildOverlayActionsEnvelope({
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
        lineIds: ['0QLxx0000000001AAA']
      },
      primitiveResult: createPrimitiveResult({
        status: 'no_match',
        status_detail: 'quote_absent',
        result: {
          quote_id: '0Q0xx0000000001AAA',
          field_set: [...QUOTE_ACTION_OVERLAY_FIELDS],
          action_rows: [],
          line_action_links: [],
          provenance_summary: {}
        }
      }),
      generatedAt: '2026-04-15T12:00:00.000Z',
      durationMs: 0
    });

    expect(quoteAbsentEnvelope.summary.status_reason).toBe('No persisted Quote row matched 0Q0xx0000000001AAA.');

    const selectorMissEnvelope = buildOverlayActionsEnvelope({
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
        status: 'no_match',
        status_detail: 'line_selector_miss',
        result: {
          quote_id: '0Q0xx0000000001AAA',
          field_set: [...QUOTE_ACTION_OVERLAY_FIELDS],
          action_rows: [],
          line_action_links: [],
          provenance_summary: {}
        }
      }),
      generatedAt: '2026-04-15T12:00:00.000Z',
      durationMs: 0
    });

    expect(selectorMissEnvelope.summary.status_reason).toBe('No requested quote lines matched 0Q0xx0000000001AAA.');
  });

  it('renders text output including line narrowing and empty summaries', () => {
    const okEnvelope = buildOverlayActionsEnvelope({
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
        lineIds: ['0QLxx0000000001AAA']
      },
      primitiveResult: createPrimitiveResult(),
      generatedAt: '2026-04-15T12:00:00.000Z',
      durationMs: 0
    });

    expect(renderOverlayActionsText(okEnvelope)).toContain('quote-runtime overlay-actions');
    expect(renderOverlayActionsText(okEnvelope)).toContain('status: ok');
    expect(renderOverlayActionsText(okEnvelope)).toContain('line ids: 0QLxx0000000001AAA');
    expect(renderOverlayActionsText(okEnvelope)).toContain('action rows: 1');
    expect(renderOverlayActionsText(okEnvelope)).toContain('type=Amend');

    const emptyEnvelope = buildOverlayActionsEnvelope({
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
        status_detail: 'empty_overlay',
        result: {
          quote_id: '0Q0xx0000000001AAA',
          field_set: [...QUOTE_ACTION_OVERLAY_FIELDS],
          action_rows: [],
          line_action_links: [],
          provenance_summary: {}
        }
      }),
      generatedAt: '2026-04-15T12:00:00.000Z',
      durationMs: 0
    });

    expect(renderOverlayActionsText(emptyEnvelope)).toContain('action rows: 0');
    expect(renderOverlayActionsText(emptyEnvelope)).toContain('provenance summary: (empty)');
  });

  it('runs through the command entry and emits the canonical envelope', async () => {
    const stdout: string[] = [];
    const stderr: string[] = [];
    const executeOverlayActions = vi.fn(async () => createPrimitiveResult());

    const execution = await runOverlayActionsCommand(
      ['--quote-id', '0Q0xx0000000001AAA', '--line-id', '0QLxx0000000001AAA', '--line-id', '0QLxx0000000001AAA'],
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
        quoteId: '0Q0xx0000000001AAA',
        lineIds: ['0QLxx0000000001AAA']
      })
    );
    expect(JSON.parse(stdout.join(''))).toMatchObject({
      command: 'overlay-actions',
      status: 'ok',
      result: {
        quote_id: '0Q0xx0000000001AAA',
        field_set: [...QUOTE_ACTION_OVERLAY_FIELDS]
      }
    });
  });
});
