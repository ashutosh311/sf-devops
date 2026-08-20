import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it, vi } from 'vitest';

import {
  buildInspectRlmContextEnvelope,
  renderInspectRlmContextHelp,
  renderInspectRlmContextText,
  runInspectRlmContextCommand
} from '../../src/commands/inspect-rlm-context';
import type { InspectRlmContextPrimitiveResult } from '../../src/primitives/inspect-rlm-context';

const fixturesDir = resolve(import.meta.dirname, '../fixtures/primitives/inspect-rlm-context');
const summaryFixture = JSON.parse(
  readFileSync(resolve(fixturesDir, 'rlm-sales-transaction-context-summary.json'), 'utf8')
) as Record<string, unknown>;

function createPrimitiveResult(overrides: Partial<InspectRlmContextPrimitiveResult> = {}): InspectRlmContextPrimitiveResult {
  return {
    status: 'ok',
    status_detail: 'fixture_loaded',
    result: {
      ...(summaryFixture as InspectRlmContextPrimitiveResult['result']),
      context_artifact: {
        ...((summaryFixture.context_artifact ?? {}) as Record<string, unknown>),
        last_modified: '2026-04-15T12:00:00.000Z'
      }
    },
    warnings: [],
    errors: [],
    evidence: [],
    source_files: [resolve(fixturesDir, 'rlm-sales-transaction-context-summary.json')],
    ...overrides
  };
}

describe('inspect-rlm-context command', () => {
  it('renders help for the locked command grammar', () => {
    expect(renderInspectRlmContextHelp()).toContain(
      'quote-runtime inspect-rlm-context --org-alias <alias> [--quote-id <id>] [--line-id <id> ...]'
    );
    expect(renderInspectRlmContextHelp()).toContain('does not emit a full XML or raw metadata dump');
  });

  it('builds the envelope around the exact normalized summary shape without raw metadata dump fields', () => {
    const envelope = buildInspectRlmContextEnvelope({
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
      durationMs: 7
    });

    expect(envelope).toMatchObject({
      command: 'inspect-rlm-context',
      status: 'ok',
      summary: {
        primary_subject: '0Q0xx0000000001AAA',
        primary_lane: 'context_bridge',
        verification_anchor: 'context:RLM_SalesTransactionContext',
        next_suggested_command: 'snapshot-lines'
      },
      result: {
        context_artifact: {
          name: 'RLM_SalesTransactionContext',
          source: 'fixture'
        },
        relevant_mappings: expect.any(Array),
        bridge_summary: expect.any(Object),
        open_questions: expect.any(Array)
      },
      meta: {
        org_alias: 'ARM',
        duration_ms: 7,
        source_files: [resolve(fixturesDir, 'rlm-sales-transaction-context-summary.json')]
      }
    });
    expect(Object.keys(envelope.result)).toEqual([
      'context_artifact',
      'relevant_mappings',
      'bridge_summary',
      'open_questions'
    ]);
    expect(JSON.stringify(envelope.result)).not.toContain('raw_metadata');
    expect(JSON.stringify(envelope.result)).not.toContain('<ContextDefinition');
  });

  it('renders summary-first text output without a raw metadata dump', () => {
    const envelope = buildInspectRlmContextEnvelope({
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

    const text = renderInspectRlmContextText(envelope, {
      quoteId: '0Q0xx0000000001AAA',
      lineIds: ['0QLxx0000000001AAA']
    });

    expect(text).toContain('quote-runtime inspect-rlm-context');
    expect(text).toContain('status: ok');
    expect(text).toContain('quote scope hint: 0Q0xx0000000001AAA');
    expect(text).toContain('line scope hints: 0QLxx0000000001AAA');
    expect(text).toContain('mapping summaries:');
    expect(text).toContain('QuoteEntitiesMapping -> SalesTransaction -> Quote');
    expect(text).not.toContain('<ContextDefinition');
    expect(text).not.toContain('contextDefinition-meta.xml');
  });

  it('runs through the command entry and emits the canonical envelope', async () => {
    const stdout: string[] = [];
    const stderr: string[] = [];
    const executeInspectRlmContext = vi.fn(async () => createPrimitiveResult());

    const execution = await runInspectRlmContextCommand(
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
      { executeInspectRlmContext }
    );

    expect(execution.exitCode).toBe(0);
    expect(stderr).toEqual([]);
    expect(executeInspectRlmContext).toHaveBeenCalledWith(
      expect.objectContaining({
        orgAlias: 'ARM',
        quoteId: '0Q0xx0000000001AAA',
        lineIds: ['0QLxx0000000001AAA']
      })
    );

    const parsed = JSON.parse(stdout.join('')) as Record<string, unknown>;
    expect(parsed).toMatchObject({
      command: 'inspect-rlm-context',
      status: 'ok',
      result: {
        context_artifact: {
          name: 'RLM_SalesTransactionContext',
          source: 'fixture'
        }
      }
    });
    expect(Object.keys(parsed.result as Record<string, unknown>)).toEqual([
      'context_artifact',
      'relevant_mappings',
      'bridge_summary',
      'open_questions'
    ]);
  });

  it('preserves unsupported status when the primary artifact cannot be read', () => {
    const envelope = buildInspectRlmContextEnvelope({
      globalFlags: {
        help: false,
        json: false,
        orgAlias: 'ARM',
        failOn: undefined,
        output: undefined,
        verbose: false
      },
      commandFlags: {
        quoteId: undefined,
        lineIds: []
      },
      primitiveResult: createPrimitiveResult({
        status: 'unsupported',
        status_detail: 'primary_artifact_unreadable',
        errors: ['Unable to read primary RLM context artifact at /fixture/path.json: missing'],
        result: {
          context_artifact: {
            name: 'RLM_SalesTransactionContext',
            source: 'fixture'
          },
          relevant_mappings: [],
          bridge_summary: {
            primary_bridge: '',
            quote_header_mapping: '',
            quote_line_mapping: '',
            lifecycle_mapping: '',
            waterfall_mapping: '',
            limitations: ['Primary RLM context summary artifact is unavailable.']
          },
          open_questions: []
        }
      }),
      generatedAt: '2026-04-15T12:00:00.000Z',
      durationMs: 0
    });

    expect(envelope.status).toBe('unsupported');
    expect(envelope.summary.status_reason).toBe('Unable to read primary RLM context artifact at /fixture/path.json: missing');
  });
});
