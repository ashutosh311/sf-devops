import { describe, expect, it, vi } from 'vitest';

import {
  buildInspectPricingWaterfallEnvelope,
  parseInspectPricingWaterfallFlags,
  renderInspectPricingWaterfallHelp,
  renderInspectPricingWaterfallText,
  runInspectPricingWaterfallCommand
} from '../../src/commands/inspect-pricing-waterfall';
import { runQuoteRuntimeCli } from '../../src/bin/quote-runtime';
import type { InspectPricingWaterfallPrimitiveResult } from '../../src/primitives/inspect-pricing-waterfall';

function createPrimitiveResult(
  overrides: Partial<InspectPricingWaterfallPrimitiveResult> = {}
): InspectPricingWaterfallPrimitiveResult {
  return {
    status: 'ok',
    result: {
      selector_resolution: {
        quote_id: 'Q-001',
        requested_line_id: 'L-1',
        resolved_line_id: 'L-1',
        price_waterfall_identifier: 'L-1:40944695130560',
        waterfall_line_item_id: 'L-1',
        pricing_execution_id: '40944695130560',
        resolution_mode: 'persisted_price_waterfall_identifier'
      },
      persisted_anchor: {
        quote_id: 'Q-001',
        line_id: 'L-1',
        line_number: 1,
        product_id: 'P-1',
        parent_line_id: null,
        unit_price: 100,
        net_unit_price: 95,
        total_price: 95,
        total_line_amount: 95,
        price_waterfall_identifier: 'L-1:40944695130560',
        quote_action_id: 'QA-1',
        quote_action_type: 'Amend',
        quote_action_source_asset_id: 'ASSET-1',
        created_date: '2026-04-17T12:00:00.000Z',
        last_modified_date: '2026-04-17T12:05:00.000Z'
      },
      correlation: {
        pricing_process_execution: {
          query_status: 'ok',
          execution_type_key: '40944695130560',
          execution_key: 'shared-001',
          record_count: 1,
          records: [{ Id: 'ppe-1' }]
        },
        pricing_line_execution: {
          query_status: 'ok',
          execution_type_key: '40944695130560_L-1',
          execution_key: 'shared-001',
          record_count: 1,
          records: [{ Id: 'ppe-line-1' }]
        },
        pricing_process_family: {
          fetch_status: 'ok',
          path: '/services/data/v66.0/connect/core-pricing/pricing-process-execution/shared-001',
          execution_key: 'shared-001',
          execution_types_present: ['Pricing', 'Pricing_Line'],
          line_membership_confirmed: true,
          raw_payload: { executionId: 'shared-001' }
        },
        pricing_api_execution: {
          query_status: 'ok',
          execution_key: 'shared-001',
          record_count: 1,
          records: [{ Id: 'api-1' }]
        },
        api_execution_log: {
          fetch_status: 'ok',
          endpoint: '/services/data/v66.0/connect/core-pricing/apiexecutionlogs/api-type-001',
          api_execution_type_key: 'api-type-001',
          raw_payload: [{ procedureName: 'Default Pricing Procedure' }]
        },
        shared_execution_key: 'shared-001',
        execution_types_present: ['Pricing', 'Pricing_Line'],
        line_membership_confirmed: true
      },
      waterfall: {
        endpoint: '/services/data/v66.0/connect/core-pricing/waterfall/L-1/40944695130560',
        fetch_status: 'ok',
        summary: {
          element_count: 2,
          formula_count: 1,
          output_targets: ['Subtotal'],
          overwrite_candidates: []
        },
        normalized_elements: [
          {
            sequence: 1,
            name: 'Formula Based Pricing',
            filter_rules: [],
            inputs: [],
            outputs: [{ target: 'Subtotal' }],
            calculation_formula: 'InputUnitPrice * Qty + 17',
            writes: ['Subtotal']
          }
        ],
        raw_payload: { waterfallElements: [{ name: 'Formula Based Pricing' }] }
      },
      recommended_next_commands: ['inspect-rlm-context']
    },
    warnings: [],
    errors: [],
    evidence: [],
    ...overrides
  };
}

describe('inspect-pricing-waterfall command', () => {
  it('renders help for the locked command grammar', () => {
    expect(renderInspectPricingWaterfallHelp()).toContain(
      'quote-runtime inspect-pricing-waterfall --org-alias <alias> --quote-id <id> --line-id <id> [--json] [--fail-on <status>] [--output <path>] [--verbose]'
    );
    expect(renderInspectPricingWaterfallHelp()).toContain('V1 requires exactly one --line-id and does not expose execution-id selectors.');
  });

  it('parses the command flags through shared selector normalization', async () => {
    await expect(
      parseInspectPricingWaterfallFlags(['--quote-id', ' Q-001 ', '--line-id', 'L-1', '--line-id', 'L-1'])
    ).resolves.toEqual({
      quoteId: 'Q-001',
      lineIds: ['L-1']
    });
  });

  it('builds a real envelope from the primitive result', () => {
    const envelope = buildInspectPricingWaterfallEnvelope({
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
        lineIds: ['L-1']
      },
      primitiveResult: createPrimitiveResult(),
      generatedAt: '2026-04-17T12:00:00.000Z',
      durationMs: 5
    });

    expect(envelope).toMatchObject({
      command: 'inspect-pricing-waterfall',
      status: 'ok',
      summary: {
        primary_subject: 'Q-001',
        primary_lane: 'quote_pricing',
        verification_anchor: 'quote:Q-001:line:L-1',
        next_suggested_command: 'inspect-rlm-context'
      },
      result: {
        selector_resolution: {
          quote_id: 'Q-001',
          requested_line_id: 'L-1',
          resolved_line_id: 'L-1',
          pricing_execution_id: '40944695130560'
        },
        waterfall: {
          fetch_status: 'ok'
        },
        recommended_next_commands: ['inspect-rlm-context']
      },
      warnings: [],
      errors: [],
      meta: {
        org_alias: 'ARM',
        duration_ms: 5,
        source_files: []
      }
    });
  });

  it('renders deterministic text output for a successful waterfall inspection', () => {
    const envelope = buildInspectPricingWaterfallEnvelope({
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
        lineIds: ['L-1']
      },
      primitiveResult: createPrimitiveResult(),
      generatedAt: '2026-04-17T12:00:00.000Z',
      durationMs: 0
    });

    const text = renderInspectPricingWaterfallText(envelope);

    expect(text).toContain('status: ok');
    expect(text).toContain('price waterfall identifier: L-1:40944695130560');
    expect(text).toContain('shared execution key: shared-001');
    expect(text).toContain('waterfall fetch: ok');
    expect(text).toContain('recommended next commands: inspect-rlm-context');
  });

  it('runs the real command in text mode using dependency injection', async () => {
    const stdout: string[] = [];
    const stderr: string[] = [];
    const executeInspectPricingWaterfall = vi.fn(async () => createPrimitiveResult());

    const execution = await runInspectPricingWaterfallCommand(
      ['--quote-id', 'Q-001', '--line-id', 'L-1'],
      {
        help: false,
        json: false,
        orgAlias: 'ARM',
        failOn: 'error',
        output: undefined,
        verbose: false
      },
      {
        stdout: { write: (message: string) => void stdout.push(message) },
        stderr: { write: (message: string) => void stderr.push(message) }
      },
      { executeInspectPricingWaterfall }
    );

    expect(execution.exitCode).toBe(0);
    expect(stderr).toEqual([]);
    expect(executeInspectPricingWaterfall).toHaveBeenCalledWith({
      orgAlias: 'ARM',
      quoteId: 'Q-001',
      lineIds: ['L-1']
    });
    expect(stdout.join('')).toContain('waterfall fetch: ok');
  });

  it('runs the command in json mode and emits the primitive-backed envelope', async () => {
    const stdout: string[] = [];
    const stderr: string[] = [];

    const execution = await runInspectPricingWaterfallCommand(
      ['--quote-id', 'Q-001', '--line-id', 'L-1', '--line-id', 'L-1'],
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
        executeInspectPricingWaterfall: vi.fn(async () => createPrimitiveResult({ status: 'partial' }))
      }
    );

    expect(execution.exitCode).toBe(0);
    expect(stderr).toEqual([]);
    expect(JSON.parse(stdout.join(''))).toMatchObject({
      command: 'inspect-pricing-waterfall',
      status: 'partial',
      result: {
        selector_resolution: {
          quote_id: 'Q-001',
          requested_line_id: 'L-1'
        },
        waterfall: {
          fetch_status: 'ok'
        }
      }
    });
  });

  it('runs the command in json mode and emits malformed identifier errors from the primitive', async () => {
    const stdout: string[] = [];
    const stderr: string[] = [];

    const execution = await runInspectPricingWaterfallCommand(
      ['--quote-id', 'Q-001', '--line-id', 'L-1'],
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
        executeInspectPricingWaterfall: vi.fn(async () =>
          createPrimitiveResult({
            status: 'error',
            result: {
              ...createPrimitiveResult().result,
              selector_resolution: {
                ...createPrimitiveResult().result.selector_resolution,
                price_waterfall_identifier: 'L-1',
                pricing_execution_id: null
              },
              recommended_next_commands: ['snapshot-lines']
            },
            errors: [
              "PriceWaterfallIdentifier 'L-1' did not match the expected <lineItemId>:<pricingExecutionId> format."
            ]
          })
        )
      }
    );

    expect(execution.exitCode).toBe(1);
    expect(stderr).toEqual([]);
    expect(JSON.parse(stdout.join(''))).toMatchObject({
      command: 'inspect-pricing-waterfall',
      status: 'error',
      summary: {
        status_reason: "PriceWaterfallIdentifier 'L-1' did not match the expected <lineItemId>:<pricingExecutionId> format."
      },
      result: {
        selector_resolution: {
          requested_line_id: 'L-1',
          price_waterfall_identifier: 'L-1',
          pricing_execution_id: null
        },
        recommended_next_commands: ['snapshot-lines']
      },
      errors: [
        "PriceWaterfallIdentifier 'L-1' did not match the expected <lineItemId>:<pricingExecutionId> format."
      ]
    });
  });

  it('rejects more than one unique line id through the shared readiness path', async () => {
    await expect(
      runInspectPricingWaterfallCommand(
        ['--quote-id', 'Q-001', '--line-id', 'L-1', '--line-id', 'L-2'],
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
        }
      )
    ).rejects.toThrow('inspect-pricing-waterfall readiness check failed: Provide exactly one unique --line-id <id> in V1.');
  });

  it('routes readiness failures through the CLI entrypoint as parse-style exits', async () => {
    const stdout: string[] = [];
    const stderr: string[] = [];

    const exitCode = await runQuoteRuntimeCli(
      ['inspect-pricing-waterfall', '--org-alias', 'ARM', '--quote-id', 'Q-001', '--line-id', 'L-1', '--line-id', 'L-2'],
      {
        stdout: { write: (message: string) => void stdout.push(message) },
        stderr: { write: (message: string) => void stderr.push(message) }
      }
    );

    expect(exitCode).toBe(2);
    expect(stdout).toEqual([]);
    expect(stderr.join('')).toContain('inspect-pricing-waterfall readiness check failed: Provide exactly one unique --line-id <id> in V1.');
  });
});
