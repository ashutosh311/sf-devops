import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it, vi } from 'vitest';

import {
  buildPstPlanEnvelope,
  parsePstPlanFlags,
  renderPstPlanHelp,
  renderPstPlanText,
  runPstPlanCommand
} from '../../src/commands/pst-plan';
import type { PstPlanPrimitiveResult, PstPlanResult } from '../../src/primitives/pst-plan';

const fixturesDir = resolve(import.meta.dirname, '../fixtures/primitives/pst-plan');
const pstPlacePlanFixture = JSON.parse(
  readFileSync(resolve(fixturesDir, 'pst-place-plan.json'), 'utf8')
) as PstPlanResult;

function createPrimitiveResult(overrides: Partial<PstPlanPrimitiveResult> = {}): PstPlanPrimitiveResult {
  return {
    status: 'ok',
    result: pstPlacePlanFixture,
    warnings: [],
    errors: [],
    evidence: [],
    ...overrides
  };
}

describe('pst-plan command', () => {
  it('renders the locked help text', () => {
    expect(renderPstPlanHelp()).toContain('quote-runtime pst-plan --org-alias <alias> --operation-family <pst_place|initiate_amendment|initiate_renewal|asset_add_to_renewal>');
    expect(renderPstPlanHelp()).toContain('explicitly read-only and plan_only');
    expect(renderPstPlanHelp()).toContain('does not execute PST routes');
  });

  it('normalizes operation-family aliases and repeatable selector ids via shared selector rules', async () => {
    await expect(
      parsePstPlanFlags([
        '--operation-family',
        'initiate_renewal',
        '--quote-id',
        '0Q0xx0000000001AAA',
        '--line-id',
        ' 1QLxx0000000001AAA ',
        '--line-id',
        '1QLxx0000000001AAA',
        '--asset-id',
        ' 02ixx0000000001AAA ',
        '--asset-id',
        '02ixx0000000001AAA',
        '--expected-change',
        ' extend term '
      ])
    ).resolves.toEqual({
      operationFamily: 'initiate_renewal',
      quoteId: '0Q0xx0000000001AAA',
      lineIds: ['1QLxx0000000001AAA'],
      assetIds: ['02ixx0000000001AAA'],
      expectedChange: 'extend term'
    });
  });

  it('rejects non-canonical operation-family aliases for pst-plan', async () => {
    await expect(
      parsePstPlanFlags(['--operation-family', 'renewal'])
    ).rejects.toThrow(/canonical --operation-family value/i);

    await expect(parsePstPlanFlags(['--operation-family', 'pst_place', '--asset-id', '   '])).rejects.toThrow(
      '--asset-id must not be empty when provided.'
    );
  });

  it('builds the canonical result envelope around the plan-only primitive output', () => {
    const envelope = buildPstPlanEnvelope({
      globalFlags: {
        help: false,
        json: false,
        orgAlias: 'ARM',
        failOn: undefined,
        output: undefined,
        verbose: false
      },
      commandFlags: {
        operationFamily: 'pst_place',
        quoteId: '0Q0xx0000000001AAA',
        lineIds: ['0QLxx0000000001AAA'],
        assetIds: [],
        expectedChange: 'reprice the targeted line'
      },
      primitiveResult: createPrimitiveResult(),
      generatedAt: '2026-04-15T12:00:00.000Z',
      durationMs: 12
    });

    expect(envelope).toMatchObject({
      command: 'pst-plan',
      status: 'ok',
      summary: {
        primary_subject: '0Q0xx0000000001AAA',
        status_reason: 'Plan-only PST guidance assembled for pst_place without execution semantics.',
        primary_lane: 'plan_only',
        verification_anchor: '0Q0xx0000000001AAA',
        next_suggested_command: 'snapshot-lines',
        key_counts: {
          line_ids: 1,
          asset_ids: 0,
          verification_branch_hints: 5
        }
      },
      result: pstPlacePlanFixture,
      meta: {
        org_alias: 'ARM',
        duration_ms: 12
      }
    });
  });

  it('returns a null next_suggested_command when the explicit PST verification hint cannot be grounded to a quote snapshot command', () => {
    const envelope = buildPstPlanEnvelope({
      globalFlags: {
        help: false,
        json: false,
        orgAlias: 'ARM',
        failOn: undefined,
        output: undefined,
        verbose: false
      },
      commandFlags: {
        operationFamily: 'pst_place',
        quoteId: null,
        lineIds: [],
        assetIds: [],
        expectedChange: null
      },
      primitiveResult: createPrimitiveResult({
        status: 'warn',
        warnings: ['pst_place planning is strongest with a target quote id because same-quote verification is the default anchor.'],
        result: {
          ...pstPlacePlanFixture,
          subjects: {
            quote_id: null,
            line_ids: [],
            asset_ids: [],
            expected_change: null
          },
          before_capture_plan: {
            ...pstPlacePlanFixture.before_capture_plan,
            verification_anchor_expectation: null
          }
        }
      }),
      generatedAt: '2026-04-15T12:00:00.000Z',
      durationMs: 12
    });

    expect(envelope.summary.next_suggested_command).toBeNull();
  });

  it('renders text output for both ok and warn plan-only guidance', () => {
    const okEnvelope = buildPstPlanEnvelope({
      globalFlags: {
        help: false,
        json: false,
        orgAlias: 'ARM',
        failOn: undefined,
        output: undefined,
        verbose: false
      },
      commandFlags: {
        operationFamily: 'pst_place',
        quoteId: '0Q0xx0000000001AAA',
        lineIds: ['0QLxx0000000001AAA'],
        assetIds: [],
        expectedChange: 'reprice the targeted line'
      },
      primitiveResult: createPrimitiveResult(),
      generatedAt: '2026-04-15T12:00:00.000Z',
      durationMs: 0
    });

    expect(renderPstPlanText(okEnvelope)).toContain('quote-runtime pst-plan');
    expect(renderPstPlanText(okEnvelope)).toContain('mode: plan_only');
    expect(renderPstPlanText(okEnvelope)).toContain('execution requested: false');
    expect(renderPstPlanText(okEnvelope)).toContain('route: /services/data/v66.0/connect/rev/sales-transaction/actions/place');
    expect(renderPstPlanText(okEnvelope)).toContain('verification branch hints:');

    const warnEnvelope = buildPstPlanEnvelope({
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
        quoteId: '0Q0xx0000000001AAA',
        lineIds: [],
        assetIds: [],
        expectedChange: null
      },
      primitiveResult: createPrimitiveResult({
        status: 'warn',
        warnings: ['asset_add_to_renewal planning is broader without asset ids, which are usually the primary durable handles.'],
        result: {
          ...pstPlacePlanFixture,
          operation_family: 'asset_add_to_renewal',
          route: 'POST /services/data/v65.0/connect/revenue-management/assets/actions/renew',
          payload_summary: {
            ...pstPlacePlanFixture.payload_summary,
            expected_change: null,
            expected_anchor_type: 'new_or_existing_renewal_quote'
          },
          subjects: {
            quote_id: '0Q0xx0000000001AAA',
            line_ids: [],
            asset_ids: [],
            expected_change: null
          }
        }
      }),
      generatedAt: '2026-04-15T12:00:00.000Z',
      durationMs: 0
    });

    expect(renderPstPlanText(warnEnvelope)).toContain('status: warn');
    expect(renderPstPlanText(warnEnvelope)).toContain('warnings:');
    expect(renderPstPlanText(warnEnvelope)).toContain('asset_add_to_renewal planning is broader without asset ids');
  });

  it('fails before command execution when required selector or config input is missing', async () => {
    const executePstPlanDependency = vi.fn(async () => createPrimitiveResult());

    await expect(
      runPstPlanCommand(
        ['--quote-id', '0Q0xx0000000001AAA'],
        {
          help: false,
          json: false,
          orgAlias: 'ARM',
          failOn: 'error',
          output: undefined,
          verbose: false
        },
        {
          stdout: { write: () => undefined },
          stderr: { write: () => undefined }
        },
        { executePstPlan: executePstPlanDependency }
      )
    ).rejects.toThrow(/required flag operation-family/i);
    expect(executePstPlanDependency).not.toHaveBeenCalled();

    await expect(
      runPstPlanCommand(
        ['--operation-family', 'pst_place'],
        {
          help: false,
          json: false,
          orgAlias: undefined,
          failOn: 'error',
          output: undefined,
          verbose: false
        },
        {
          stdout: { write: () => undefined },
          stderr: { write: () => undefined }
        },
        { executePstPlan: executePstPlanDependency }
      )
    ).rejects.toThrow('The pst-plan command requires --org-alias <alias>.');
    expect(executePstPlanDependency).not.toHaveBeenCalled();
  });

  it('runs through the command entry and emits the canonical envelope', async () => {
    const stdout: string[] = [];
    const stderr: string[] = [];
    const executePstPlanDependency = vi.fn(async () => createPrimitiveResult());

    const execution = await runPstPlanCommand(
      ['--operation-family', 'pst_place', '--quote-id', '0Q0xx0000000001AAA', '--line-id', '0QLxx0000000001AAA'],
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
      { executePstPlan: executePstPlanDependency }
    );

    expect(execution.exitCode).toBe(0);
    expect(stderr).toEqual([]);
    expect(executePstPlanDependency).toHaveBeenCalledWith(
      expect.objectContaining({
        operationFamily: 'pst_place',
        quoteId: '0Q0xx0000000001AAA',
        lineIds: ['0QLxx0000000001AAA']
      })
    );
    expect(JSON.parse(stdout.join(''))).toMatchObject({
      command: 'pst-plan',
      status: 'ok',
      result: {
        mode: 'plan_only',
        operation_family: 'pst_place',
        route: '/services/data/v66.0/connect/rev/sales-transaction/actions/place'
      }
    });
  });
});
