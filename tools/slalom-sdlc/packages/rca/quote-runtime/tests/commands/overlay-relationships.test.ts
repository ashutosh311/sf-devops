import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it, vi } from 'vitest';

import {
  buildOverlayRelationshipsEnvelope,
  parseOverlayRelationshipsFlags,
  renderOverlayRelationshipsHelp,
  renderOverlayRelationshipsText,
  runOverlayRelationshipsCommand
} from '../../src/commands/overlay-relationships';
import type { OverlayRelationshipsPrimitiveResult } from '../../src/primitives/overlay-relationships';

const fixturesDir = resolve(import.meta.dirname, '../fixtures/primitives/overlay-relationships');
const relationshipRowsFixture = JSON.parse(
  readFileSync(resolve(fixturesDir, 'relationship-rows.json'), 'utf8')
) as Record<string, unknown>[];

function createPrimitiveResult(
  overrides: Partial<OverlayRelationshipsPrimitiveResult> = {}
): OverlayRelationshipsPrimitiveResult {
  return {
    status: 'ok',
    status_detail: 'relationships_found',
    result: {
      quote_id: '0Q0xx0000000001AAA',
      relationship_rows: relationshipRowsFixture as never,
      bundle_summary: {
        targeted_line_count: 3,
        relationship_count: 2,
        matched_line_ids: ['0QLxx0000000001AAA', '0QLxx0000000002AAA', '0QLxx0000000003AAA'],
        missing_line_ids: [],
        distinct_main_line_count: 1,
        distinct_associated_line_count: 2,
        root_line_count: 1,
        main_roles: ['Bundle'],
        associated_roles: ['Component', 'Option']
      },
      pricing_inclusion_summary: {
        included_in_bundle_price_count: 1,
        other_pricing_count: 1,
        unknown_pricing_count: 0,
        price_inclusive_true_count: 1,
        price_inclusive_false_count: 1,
        price_inclusive_unknown_count: 0,
        associated_pricing_values: ['IncludedInBundlePrice', 'ListPrice']
      }
    },
    warnings: [],
    errors: [],
    evidence: [],
    queries: {
      quote: 'SELECT Id FROM Quote',
      relationships: 'SELECT Id FROM QuoteLineRelationship'
    },
    ...overrides
  };
}

describe('overlay-relationships command', () => {
  it('renders the locked help text', () => {
    expect(renderOverlayRelationshipsHelp()).toContain(
      'quote-runtime overlay-relationships --org-alias <alias> --quote-id <id> [--line-id <id> ...]'
    );
    expect(renderOverlayRelationshipsHelp()).toContain('structure and bundle semantics, not lifecycle provenance');
  });

  it('builds the result envelope shape around the primitive output', () => {
    const envelope = buildOverlayRelationshipsEnvelope({
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
      command: 'overlay-relationships',
      status: 'ok',
      summary: {
        primary_subject: '0Q0xx0000000001AAA',
        primary_lane: 'persisted_overlay',
        verification_anchor: 'quote:0Q0xx0000000001AAA',
        next_suggested_command: null
      },
      result: {
        quote_id: '0Q0xx0000000001AAA',
        relationship_rows: relationshipRowsFixture,
        bundle_summary: {
          relationship_count: 2
        },
        pricing_inclusion_summary: {
          included_in_bundle_price_count: 1
        }
      },
      meta: {
        org_alias: 'ARM',
        duration_ms: 12
      }
    });
    expect(envelope.summary.status_reason).toBe(
      'Retrieved structural QuoteLineRelationship overlay for 0Q0xx0000000001AAA.'
    );
  });

  it('normalizes duplicate line ids and rejects blank line ids per shared selector rules', async () => {
    await expect(
      parseOverlayRelationshipsFlags([
        '--quote-id',
        '0Q0xx0000000001AAA',
        '--line-id',
        ' 0QLxx0000000002AAA ',
        '--line-id',
        '0QLxx0000000001AAA',
        '--line-id',
        '0QLxx0000000002AAA'
      ])
    ).resolves.toEqual({
      quoteId: '0Q0xx0000000001AAA',
      lineIds: ['0QLxx0000000002AAA', '0QLxx0000000001AAA']
    });

    await expect(
      parseOverlayRelationshipsFlags(['--quote-id', '0Q0xx0000000001AAA', '--line-id', '   '])
    ).rejects.toThrow('--line-id must not be empty when provided.');
  });

  it('renders text output for both matched and unmatched relationship overlays', () => {
    const okEnvelope = buildOverlayRelationshipsEnvelope({
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

    expect(renderOverlayRelationshipsText(okEnvelope)).toContain('quote-runtime overlay-relationships');
    expect(renderOverlayRelationshipsText(okEnvelope)).toContain('status: ok');
    expect(renderOverlayRelationshipsText(okEnvelope)).toContain('relationship count: 2');
    expect(renderOverlayRelationshipsText(okEnvelope)).toContain('pricing=IncludedInBundlePrice inclusive=true');

    const noMatchEnvelope = buildOverlayRelationshipsEnvelope({
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
        lineIds: ['0QLxx0000000099AAA']
      },
      primitiveResult: createPrimitiveResult({
        status: 'no_match',
        status_detail: 'empty_overlay_selector_miss',
        result: {
          quote_id: '0Q0xx0000000001AAA',
          relationship_rows: [],
          bundle_summary: {
            targeted_line_count: 1,
            relationship_count: 0,
            matched_line_ids: [],
            missing_line_ids: ['0QLxx0000000099AAA'],
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
        }
      }),
      generatedAt: '2026-04-15T12:00:00.000Z',
      durationMs: 0
    });

    expect(renderOverlayRelationshipsText(noMatchEnvelope)).toContain('status: no_match');
    expect(renderOverlayRelationshipsText(noMatchEnvelope)).toContain('relationship rows: (none)');
    expect(renderOverlayRelationshipsText(noMatchEnvelope)).toContain('missing line ids: 0QLxx0000000099AAA');

    const emptyOverlayEnvelope = buildOverlayRelationshipsEnvelope({
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
        status_detail: 'empty_overlay',
        result: {
          quote_id: '0Q0xx0000000001AAA',
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
        }
      }),
      generatedAt: '2026-04-15T12:00:00.000Z',
      durationMs: 0
    });

    expect(emptyOverlayEnvelope.summary.status_reason).toBe(
      'No structural QuoteLineRelationship rows matched 0Q0xx0000000001AAA; structural bundle semantics remained empty and no lifecycle provenance was inferred.'
    );
  });

  it('runs through the command entry and emits the canonical envelope', async () => {
    const stdout: string[] = [];
    const stderr: string[] = [];
    const executeOverlayRelationships = vi.fn(async () => createPrimitiveResult());

    const execution = await runOverlayRelationshipsCommand(
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
      { executeOverlayRelationships }
    );

    expect(execution.exitCode).toBe(0);
    expect(stderr).toEqual([]);
    expect(executeOverlayRelationships).toHaveBeenCalledWith(
      expect.objectContaining({
        orgAlias: 'ARM',
        quoteId: '0Q0xx0000000001AAA',
        lineIds: ['0QLxx0000000001AAA']
      })
    );
    expect(JSON.parse(stdout.join(''))).toMatchObject({
      command: 'overlay-relationships',
      status: 'ok',
      result: {
        quote_id: '0Q0xx0000000001AAA',
        bundle_summary: {
          relationship_count: 2
        },
        pricing_inclusion_summary: {
          included_in_bundle_price_count: 1
        }
      }
    });
  });
});
