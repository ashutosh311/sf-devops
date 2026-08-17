import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it, vi } from 'vitest';

import {
  buildCreateLifecycleScenarioEnvelope,
  parseCreateLifecycleScenarioFlags,
  renderCreateLifecycleScenarioHelp,
  renderCreateLifecycleScenarioText,
  runCreateLifecycleScenarioCommand,
  type LifecycleReadbackChecklistItem
} from '../../src/commands/create-lifecycle-scenario';
import type { PstPlanPrimitiveResult } from '../../src/primitives/pst-plan';

const fixturesDir = resolve(import.meta.dirname, '../fixtures/scenarios/create-lifecycle-scenario');
const readbackChecklistFixture = JSON.parse(
  readFileSync(resolve(fixturesDir, 'readback-checklist.json'), 'utf8')
) as LifecycleReadbackChecklistItem[];

function createPstPlanPrimitiveResult(overrides: Partial<PstPlanPrimitiveResult> = {}): PstPlanPrimitiveResult {
  return {
    status: 'ok',
    result: {
      mode: 'plan_only',
      operation_family: 'initiate_amendment',
      route: 'POST /services/data/v64.0/actions/standard/initiateAmendment',
      contract_class: 'primary_rest',
      subjects: {
        quote_id: '0Q0xx0000000500AAA',
        line_ids: [],
        asset_ids: ['02ixx0000000001AAA'],
        expected_change: 'create an amendment quote for the existing asset cohort'
      },
      side_effect_scope: 'Creates an amendment scenario and typically yields a new amendment quote anchored to the source quote/assets.',
      payload_summary: {
        intent: 'Lifecycle setup request to create an amendment quote from existing quote or asset state.',
        expected_change: 'create an amendment quote for the existing asset cohort',
        expected_anchor_type: 'new_quote',
        execution_requested: false
      },
      before_capture_plan: {
        capture_stage: 'before',
        verification_anchor_expectation: 'quote:0Q0xx0000000500AAA',
        required_reads: [
          {
            surface: 'Quote',
            required: true,
            selectors: { quote_id: '0Q0xx0000000500AAA' },
            field_set: ['Id', 'Name']
          },
          {
            surface: 'QuoteLineItem',
            required: true,
            selectors: { quote_id: '0Q0xx0000000500AAA', line_ids: [] },
            field_set: ['Id', 'QuoteId']
          }
        ],
        optional_overlays: ['QuoteAction when lifecycle provenance is expected']
      },
      after_capture_plan: {
        capture_stage: 'after',
        expected_anchor_type: 'new_quote',
        required_reads: [
          {
            surface: 'Quote',
            required: true,
            selectors: { quote_id: null },
            field_set: ['Id', 'Name']
          },
          {
            surface: 'QuoteLineItem',
            required: true,
            selectors: { quote_id: null, line_ids: [] },
            field_set: ['Id', 'QuoteId']
          }
        ],
        comparison_expectation: 'Compare the returned lifecycle quote and lines against the baseline capture.'
      },
      verification_branch_hints: [
        {
          branch: 'persisted_verification',
          when: 'Capture source quote before the action and verify the newly created amendment quote after the action.',
          recommended_command: 'snapshot-quote'
        },
        {
          branch: 'lifecycle_overlay',
          when: 'Use QuoteAction overlay when line provenance or source-asset linkage matters.',
          recommended_command: 'overlay-actions'
        },
        {
          branch: 'structure_overlay',
          when: 'Use relationship overlay only if amendment-created structure or carry-forward bundles must be interpreted.',
          recommended_command: 'overlay-relationships'
        },
        {
          branch: 'context_bridge',
          when: 'Escalate to RLM context inspection when persisted amendment quote evidence still leaves cause unclear.',
          recommended_command: 'inspect-rlm-context'
        }
      ]
    },
    warnings: [],
    errors: [],
    evidence: [
      {
        claim: 'pst-plan emitted plan-only lifecycle guidance for the amendment flow.',
        evidence_level: 'repo_proven',
        proof_source: ['pst-plan'],
        limitations: 'Test fixture evidence only.',
        source_refs: []
      }
    ],
    ...overrides
  };
}

describe('create-lifecycle-scenario command', () => {
  it('renders the locked help text, requires lifecycle operation-family, and rejects pst_place', async () => {
    expect(renderCreateLifecycleScenarioHelp()).toContain(
      'quote-runtime create-lifecycle-scenario --org-alias <alias> --operation-family <initiate_amendment|initiate_renewal|asset_add_to_renewal>'
    );
    expect(renderCreateLifecycleScenarioHelp()).toContain('prepares the lifecycle scenario plan and readback checklist only');
    await expect(parseCreateLifecycleScenarioFlags([])).rejects.toThrow('Missing required flag operation-family');
    await expect(parseCreateLifecycleScenarioFlags(['--operation-family', 'pst_place'])).rejects.toThrow(
      'The create-lifecycle-scenario command requires a lifecycle --operation-family value: initiate_amendment, initiate_renewal, or asset_add_to_renewal.'
    );
  });

  it('builds a plan_only lifecycle scenario envelope with the locked readback checklist output', () => {
    const envelope = buildCreateLifecycleScenarioEnvelope({
      globalFlags: {
        help: false,
        json: false,
        orgAlias: 'ARM',
        failOn: undefined,
        output: undefined,
        verbose: false
      },
      commandFlags: {
        operationFamily: 'initiate_amendment',
        assetIds: ['02ixx0000000001AAA'],
        quoteId: '0Q0xx0000000500AAA',
        expectedChange: 'create an amendment quote for the existing asset cohort'
      },
      pstPlan: createPstPlanPrimitiveResult(),
      generatedAt: '2026-04-15T12:00:00.000Z',
      durationMs: 9
    });

    expect(envelope).toMatchObject({
      command: 'create-lifecycle-scenario',
      status: 'ok',
      summary: {
        primary_subject: 'initiate_amendment on quote 0Q0xx0000000500AAA (1 asset id(s))',
        primary_lane: 'plan_only',
        verification_anchor: 'Use the returned output quote id as the persisted verification anchor after execution.',
        next_suggested_command: 'snapshot-quote'
      },
      result: {
        mode: 'plan_only',
        operation_family: 'initiate_amendment',
        route: 'POST /services/data/v64.0/actions/standard/initiateAmendment',
        planned_payload_summary: {
          expected_anchor_type: 'new_quote',
          execution_requested: false
        },
        verification_plan: {
          readback_checklist: readbackChecklistFixture
        },
        recommended_next_commands: [
          'snapshot-quote',
          'snapshot-lines',
          'verify-lifecycle-provenance',
          'overlay-relationships'
        ]
      },
      meta: {
        org_alias: 'ARM',
        duration_ms: 9
      }
    });

    expect(renderCreateLifecycleScenarioText(envelope)).toContain('mode: plan_only');
    expect(renderCreateLifecycleScenarioText(envelope)).toContain('readback checklist:');
    expect(renderCreateLifecycleScenarioText(envelope)).toContain(
      '[conditional] verify-lifecycle-provenance: Confirm QuoteAction-backed lifecycle provenance separately when source-asset or amendment lineage matters.'
    );
  });

  it('preserves plan_only posture and broad-anchor warnings from pst-plan', () => {
    const envelope = buildCreateLifecycleScenarioEnvelope({
      globalFlags: {
        help: false,
        json: false,
        orgAlias: 'ARM',
        failOn: undefined,
        output: undefined,
        verbose: false
      },
      commandFlags: {
        operationFamily: 'asset_add_to_renewal',
        assetIds: [],
        quoteId: null,
        expectedChange: null
      },
      pstPlan: createPstPlanPrimitiveResult({
        status: 'warn',
        warnings: ['No source quote id or asset ids were supplied, so the lifecycle scenario starts with a broad verification anchor.'],
        result: {
          ...createPstPlanPrimitiveResult().result,
          operation_family: 'asset_add_to_renewal',
          route: 'POST /services/data/v65.0/connect/revenue-management/assets/actions/renew',
          subjects: {
            quote_id: null,
            line_ids: [],
            asset_ids: [],
            expected_change: null
          },
          payload_summary: {
            intent: 'Asset-to-renewal setup request anchored on renewal-eligible asset ids.',
            expected_change: null,
            expected_anchor_type: 'new_or_existing_renewal_quote',
            execution_requested: false
          },
          before_capture_plan: {
            capture_stage: 'before',
            verification_anchor_expectation: null,
            required_reads: [],
            optional_overlays: ['QuoteAction when lifecycle provenance is expected']
          },
          after_capture_plan: {
            capture_stage: 'after',
            expected_anchor_type: 'new_or_existing_renewal_quote',
            required_reads: [],
            comparison_expectation: 'Compare the resulting renewal quote when one is returned.'
          }
        }
      }),
      generatedAt: '2026-04-15T12:00:00.000Z',
      durationMs: 0
    });

    expect(envelope.status).toBe('warn');
    expect(envelope.result.mode).toBe('plan_only');
    expect(envelope.summary.status_reason).toBe(
      'Plan-only lifecycle scenario guidance assembled for asset_add_to_renewal, but verification anchors remain broad until execution returns a quote-centric handle.'
    );
    expect(envelope.warnings).toEqual([
      'No source quote id or asset ids were supplied, so the lifecycle scenario starts with a broad verification anchor.'
    ]);
  });

  it('runs through the command entrypoint by composing pst-plan only', async () => {
    const stdout: string[] = [];
    const stderr: string[] = [];
    const executePstPlan = vi.fn(async () => createPstPlanPrimitiveResult());

    const execution = await runCreateLifecycleScenarioCommand(
      [
        '--operation-family',
        'initiate_amendment',
        '--quote-id',
        '0Q0xx0000000500AAA',
        '--asset-id',
        '02ixx0000000001AAA',
        '--asset-id',
        '02ixx0000000001AAA',
        '--expected-change',
        'create an amendment quote for the existing asset cohort'
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
      { executePstPlan }
    );

    expect(execution.exitCode).toBe(0);
    expect(stderr).toEqual([]);
    expect(executePstPlan).toHaveBeenCalledWith({
      operationFamily: 'initiate_amendment',
      quoteId: '0Q0xx0000000500AAA',
      lineIds: [],
      assetIds: ['02ixx0000000001AAA'],
      expectedChange: 'create an amendment quote for the existing asset cohort'
    });
    expect(JSON.parse(stdout.join(''))).toMatchObject({
      command: 'create-lifecycle-scenario',
      status: 'ok',
      result: {
        mode: 'plan_only',
        recommended_next_commands: [
          'snapshot-quote',
          'snapshot-lines',
          'verify-lifecycle-provenance',
          'overlay-relationships'
        ]
      }
    });
  });
});
