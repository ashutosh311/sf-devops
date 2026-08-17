import { describe, expect, it, vi } from 'vitest';

import {
  buildClassifyPricingOutcomeEnvelope,
  parseClassifyPricingOutcomeFlags,
  renderClassifyPricingOutcomeHelp,
  renderClassifyPricingOutcomeText,
  runClassifyPricingOutcomeCommand
} from '../../src/commands/classify-pricing-outcome';
import type { ClassifyPricingOutcomePrimitiveResult } from '../../src/primitives/classify-pricing-outcome';

function createPrimitiveResult(
  overrides: Partial<ClassifyPricingOutcomePrimitiveResult> = {}
): ClassifyPricingOutcomePrimitiveResult {
  return {
    status: 'ok',
    result: {
      requested_effect: 'final persisted total should reflect the formula',
      metadata_proof_state: 'verified',
      output_family_under_test: 'net_total_family',
      target_step_hint: 'Formula Based Pricing',
      outcome_class: 'landed_but_overwritten_before_persistence',
      proof_status: 'proven',
      recommended_next_action: 'retarget_downstream_writer',
      classification_basis: {
        runtime_execution_summary: ['Observed 2 runtime writers for the net-total persistence family in the fetched waterfall.'],
        persisted_outcome_summary: ['Persisted net-total-family values read back as NetTotalPrice=95, Subtotal=95, TotalLineAmount=95.'],
        overwrite_summary: ['Later same-family writer ran after the target writer.'],
        unresolved_ambiguities: []
      },
      line_classifications: [
        {
          requested_line_id: 'L-1',
          resolved_line_id: 'L-1',
          transport_capture_status: 'ok',
          outcome_class: 'landed_but_overwritten_before_persistence',
          proof_status: 'proven',
          output_family_under_test: 'net_total_family',
          target_step_hint: 'Formula Based Pricing',
          likely_target_writer: {
            sequence: 1,
            name: 'Formula Based Pricing',
            writes: ['Subtotal'],
            normalized_families: ['net_total_family']
          },
          likely_winning_writer: {
            sequence: 2,
            name: 'Finalize Totals',
            writes: ['Subtotal'],
            normalized_families: ['net_total_family']
          },
          recommended_next_action: 'retarget_downstream_writer',
          classification_basis: {
            runtime_execution_summary: ['Observed 2 runtime writers for the net-total persistence family in the fetched waterfall.'],
            persisted_outcome_summary: ['Persisted net-total-family values read back as NetTotalPrice=95, Subtotal=95, TotalLineAmount=95.'],
            overwrite_summary: ['Later same-family writer ran after the target writer.'],
            unresolved_ambiguities: []
          }
        }
      ],
      evidence_packet: {
        quote_snapshot: { Id: 'Q-001' },
        line_snapshots: [{ Id: 'L-1' }],
        line_evidence_packets: [],
        optional_artifacts: { line_details: [], price_adjustments: [], rate_card_entries: [], rate_adjustments: [], usage_grants: [], usage_policies: [] },
        counts: {
          requested_lines: 1,
          resolved_line_snapshots: 1,
          packets_total: 1,
          ok_packets: 1,
          partial_packets: 0,
          no_match_packets: 0,
          unsupported_packets: 0,
          error_packets: 0,
          line_details_returned: 0,
          price_adjustments_returned: 0,
          rate_card_entries_returned: 0,
          rate_adjustments_returned: 0,
          usage_grants_returned: 0,
          usage_policies_returned: 0
        },
        recommended_next_commands: ['inspect-pricing-waterfall']
      },
      recommended_next_commands: ['inspect-pricing-waterfall', 'inspect-rlm-context']
    },
    warnings: [],
    errors: [],
    evidence: [],
    ...overrides
  };
}

describe('classify-pricing-outcome command', () => {
  it('renders the locked help text', () => {
    expect(renderClassifyPricingOutcomeHelp()).toContain(
      'quote-runtime classify-pricing-outcome --org-alias <alias> --quote-id <id> --line-id <id> ... --expected-change <text> [--metadata-proof <verified|not_verified>] [--output-family <text>] [--target-step <text>] [--include-adjustments] [--include-line-detail] [--include-usage-rating] [--json] [--fail-on <status>] [--output <path>] [--verbose]'
    );
    expect(renderClassifyPricingOutcomeHelp()).toContain('keeps transport status separate from business outcome_class');
  });

  it('parses and deduplicates flags', async () => {
    await expect(
      parseClassifyPricingOutcomeFlags([
        '--quote-id', ' Q-001 ',
        '--line-id', 'L-1',
        '--line-id', 'L-1',
        '--expected-change', ' final total should change ',
        '--output-family', ' Subtotal ',
        '--target-step', ' Formula Based Pricing ',
        '--include-usage-rating'
      ])
    ).resolves.toEqual({
      quoteId: 'Q-001',
      lineIds: ['L-1'],
      expectedChange: 'final total should change',
      metadataProofState: 'not_verified',
      outputFamily: 'Subtotal',
      targetStep: 'Formula Based Pricing',
      includeAdjustments: false,
      includeLineDetail: false,
      includeUsageRating: true
    });
  });

  it('builds an envelope that preserves transport status separately from outcome_class', () => {
    const envelope = buildClassifyPricingOutcomeEnvelope({
      globalFlags: {
        help: false,
        json: false,
        orgAlias: 'ARM',
        failOn: undefined,
        output: undefined,
        verbose: false
      },
      commandFlags: {
        quoteId: 'Q-001',
        lineIds: ['L-1'],
        expectedChange: 'final persisted total should reflect the formula',
        metadataProofState: 'verified',
        outputFamily: 'Subtotal',
        targetStep: 'Formula Based Pricing',
        includeAdjustments: false,
        includeLineDetail: false,
        includeUsageRating: false
      },
      primitiveResult: createPrimitiveResult(),
      generatedAt: '2026-04-21T12:00:00.000Z',
      durationMs: 7
    });

    expect(envelope).toMatchObject({
      command: 'classify-pricing-outcome',
      status: 'ok',
      summary: {
        primary_subject: 'Q-001',
        primary_lane: 'quote_pricing',
        next_suggested_command: 'inspect-pricing-waterfall',
        key_counts: {
          outcome_class: 'landed_but_overwritten_before_persistence',
          proof_status: 'proven'
        }
      },
      result: {
        metadata_proof_state: 'verified',
        outcome_class: 'landed_but_overwritten_before_persistence',
        proof_status: 'proven',
        recommended_next_action: 'retarget_downstream_writer'
      },
      meta: {
        org_alias: 'ARM',
        duration_ms: 7
      }
    });
  });

  it('renders deterministic text output', () => {
    const envelope = buildClassifyPricingOutcomeEnvelope({
      globalFlags: {
        help: false,
        json: false,
        orgAlias: 'ARM',
        failOn: undefined,
        output: undefined,
        verbose: false
      },
      commandFlags: {
        quoteId: 'Q-001',
        lineIds: ['L-1'],
        expectedChange: 'final persisted total should reflect the formula',
        metadataProofState: 'verified',
        outputFamily: 'Subtotal',
        targetStep: 'Formula Based Pricing',
        includeAdjustments: false,
        includeLineDetail: false,
        includeUsageRating: false
      },
      primitiveResult: createPrimitiveResult(),
      generatedAt: '2026-04-21T12:00:00.000Z',
      durationMs: 0
    });

    const text = renderClassifyPricingOutcomeText(envelope);
    expect(text).toContain('status: ok');
    expect(text).toContain('metadata proof state: verified');
    expect(text).toContain('outcome class: landed_but_overwritten_before_persistence');
    expect(text).toContain('proof status: proven');
    expect(text).toContain('recommended next action: retarget_downstream_writer');
  });

  it('runs in json mode using dependency injection', async () => {
    const stdout: string[] = [];
    const stderr: string[] = [];
    const executeClassifyPricingOutcome = vi.fn(async () => createPrimitiveResult({ status: 'partial' }));

    const execution = await runClassifyPricingOutcomeCommand(
      ['--quote-id', 'Q-001', '--line-id', 'L-1', '--expected-change', 'final total should change'],
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
      { executeClassifyPricingOutcome }
    );

    expect(execution.exitCode).toBe(0);
    expect(stderr).toEqual([]);
    expect(executeClassifyPricingOutcome).toHaveBeenCalledWith({
      orgAlias: 'ARM',
      quoteId: 'Q-001',
      lineIds: ['L-1'],
      expectedChange: 'final total should change',
      metadataProofState: 'not_verified',
      includeAdjustments: false,
      includeLineDetail: false,
      includeUsageRating: false
    });
    const json = JSON.parse(stdout.join('')) as { status: string; result: Record<string, unknown> };
    expect(json.status).toBe('partial');
    expect(json.result.outcome_class).toBe('landed_but_overwritten_before_persistence');
  });
});
