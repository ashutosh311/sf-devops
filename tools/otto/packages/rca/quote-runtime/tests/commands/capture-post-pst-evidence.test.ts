import { describe, expect, it, vi } from 'vitest';

import {
  buildCapturePostPstEvidenceEnvelope,
  parseCapturePostPstEvidenceFlags,
  renderCapturePostPstEvidenceHelp,
  renderCapturePostPstEvidenceText,
  runCapturePostPstEvidenceCommand
} from '../../src/commands/capture-post-pst-evidence';
import { runQuoteRuntimeCli } from '../../src/bin/quote-runtime';
import type { CapturePostPstEvidencePrimitiveResult } from '../../src/primitives/capture-post-pst-evidence';

function createPrimitiveResult(
  overrides: Partial<CapturePostPstEvidencePrimitiveResult> = {}
): CapturePostPstEvidencePrimitiveResult {
  return {
    status: 'ok',
    result: {
      quote_snapshot: {
        Id: 'Q-001',
        Name: 'Quote 001',
        QuoteNumber: 'QT-001',
        Pricebook2Id: 'PB-1',
        Status: 'Draft',
        CalculationStatus: 'Complete',
        StartDate: '2026-04-21',
        ExpirationDate: null,
        Subtotal: 95,
        TotalPrice: 95,
        TotalTaxAmount: 0,
        TotalPriceWithTax: 95,
        GrandTotal: 95,
        LineItemCount: 2,
        OriginalActionType: null,
        CreatedDate: '2026-04-21T12:00:00.000Z',
        LastModifiedDate: '2026-04-21T12:05:00.000Z'
      },
      line_snapshots: [
        {
          Id: 'L-1',
          QuoteId: 'Q-001',
          LineNumber: 10,
          Product2Id: 'P-1',
          PricebookEntryId: 'PBE-1',
          ParentQuoteLineItemId: null,
          Quantity: 1,
          StartQuantity: 1,
          EndQuantity: 1,
          UnitPrice: 100,
          ListPrice: 100,
          NetUnitPrice: 95,
          NetTotalPrice: 95,
          Subtotal: 95,
          TotalPrice: 95,
          TotalLineAmount: 95,
          TotalAdjustmentAmount: 5,
          SellingModelType: 'OneTime',
          StartDate: '2026-04-21',
          EndDate: null,
          PriceWaterfallIdentifier: 'L-1:40944695130560',
          QuoteActionId: 'QA-1',
          'QuoteAction.Type': 'Amend',
          'QuoteAction.SourceAssetId': 'A-1',
          CreatedDate: '2026-04-21T12:00:00.000Z',
          LastModifiedDate: '2026-04-21T12:05:00.000Z'
        }
      ],
      line_evidence_packets: [
        {
          requested_line_id: 'L-1',
          resolved_line_id: 'L-1',
          capture_status: 'ok',
          line_snapshot: {
            Id: 'L-1',
            QuoteId: 'Q-001',
            LineNumber: 10,
            Product2Id: 'P-1',
            PricebookEntryId: 'PBE-1',
            ParentQuoteLineItemId: null,
            Quantity: 1,
            StartQuantity: 1,
            EndQuantity: 1,
            UnitPrice: 100,
            ListPrice: 100,
            NetUnitPrice: 95,
            NetTotalPrice: 95,
            Subtotal: 95,
            TotalPrice: 95,
            TotalLineAmount: 95,
            TotalAdjustmentAmount: 5,
            SellingModelType: 'OneTime',
            StartDate: '2026-04-21',
            EndDate: null,
            PriceWaterfallIdentifier: 'L-1:40944695130560',
            QuoteActionId: 'QA-1',
            'QuoteAction.Type': 'Amend',
            'QuoteAction.SourceAssetId': 'A-1',
            CreatedDate: '2026-04-21T12:00:00.000Z',
            LastModifiedDate: '2026-04-21T12:05:00.000Z'
          },
          trace_anchor: {
            price_waterfall_identifier: 'L-1:40944695130560',
            waterfall_line_item_id: 'L-1',
            pricing_execution_id: '40944695130560',
            shared_execution_key: 'shared-001'
          },
          execution_correlation: {
            pricing_process_execution: { Id: 'ppe-1' },
            pricing_api_execution: { Id: 'api-1' },
            api_execution_log: {
              fetch_status: 'ok',
              endpoint: '/services/data/v66.0/connect/core-pricing/apiexecutionlogs/api-type-001',
              api_execution_type_key: 'api-type-001',
              raw_payload: [{ procedureName: 'Default Pricing Procedure' }]
            },
            correlation_status: 'ok'
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
            normalized_elements: [],
            raw_payload: { waterfallElements: [] }
          },
          artifact_statuses: {
            line_detail: 'not_requested',
            price_adjustments: 'not_requested'
          },
          warnings: []
        }
      ],
      optional_artifacts: {
        line_details: [],
        price_adjustments: []
      },
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
      recommended_next_commands: ['inspect-rlm-context']
    },
    warnings: [],
    errors: [],
    evidence: [],
    ...overrides
  };
}

describe('capture-post-pst-evidence command', () => {
  it('renders help for the locked command grammar', () => {
    expect(renderCapturePostPstEvidenceHelp()).toContain(
      'quote-runtime capture-post-pst-evidence --org-alias <alias> --quote-id <id> (--line-id <id> ... | --all-lines) [--include-adjustments] [--include-line-detail] [--include-usage-rating] [--json] [--fail-on <status>] [--output <path>] [--verbose]'
    );
    expect(renderCapturePostPstEvidenceHelp()).toContain('does not emit business outcome classification in P1');
  });

  it('parses and deduplicates command flags', async () => {
    await expect(
      parseCapturePostPstEvidenceFlags([
        '--quote-id', ' Q-001 ',
        '--line-id', 'L-1',
        '--line-id', 'L-1',
        '--include-adjustments',
        '--include-line-detail'
      ])
    ).resolves.toEqual({
      quoteId: 'Q-001',
      lineIds: ['L-1'],
      allLines: false,
      includeAdjustments: true,
      includeLineDetail: true,
      includeUsageRating: false
    });
  });

  it('parses whole-quote capture without requiring line ids', async () => {
    await expect(
      parseCapturePostPstEvidenceFlags(['--quote-id', 'Q-001', '--all-lines'])
    ).resolves.toEqual({
      quoteId: 'Q-001',
      lineIds: [],
      allLines: true,
      includeAdjustments: false,
      includeLineDetail: false,
      includeUsageRating: false
    });
  });

  it('builds an envelope from the primitive result', () => {
    const envelope = buildCapturePostPstEvidenceEnvelope({
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
        allLines: false,
        includeAdjustments: false,
        includeLineDetail: false,
        includeUsageRating: false
      },
      primitiveResult: createPrimitiveResult(),
      generatedAt: '2026-04-21T12:00:00.000Z',
      durationMs: 8
    });

    expect(envelope).toMatchObject({
      command: 'capture-post-pst-evidence',
      status: 'ok',
      summary: {
        primary_subject: 'Q-001',
        primary_lane: 'quote_pricing',
        next_suggested_command: 'inspect-rlm-context'
      },
      result: {
        counts: {
          requested_lines: 1,
          ok_packets: 1
        },
        recommended_next_commands: ['inspect-rlm-context']
      },
      meta: {
        org_alias: 'ARM',
        duration_ms: 8,
        source_files: []
      }
    });
  });

  it('renders deterministic text output', () => {
    const envelope = buildCapturePostPstEvidenceEnvelope({
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
        allLines: false,
        includeAdjustments: false,
        includeLineDetail: false,
        includeUsageRating: false
      },
      primitiveResult: createPrimitiveResult(),
      generatedAt: '2026-04-21T12:00:00.000Z',
      durationMs: 0
    });

    const text = renderCapturePostPstEvidenceText(envelope);
    expect(text).toContain('status: ok');
    expect(text).toContain('recommended next commands: inspect-rlm-context');
    expect(text).toContain('capture status: ok');
    expect(text).toContain('correlation status: ok');
  });

  it('runs the command in text mode using dependency injection', async () => {
    const stdout: string[] = [];
    const stderr: string[] = [];
    const executeCapturePostPstEvidence = vi.fn(async () => createPrimitiveResult());

    const execution = await runCapturePostPstEvidenceCommand(
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
      { executeCapturePostPstEvidence }
    );

    expect(execution.exitCode).toBe(0);
    expect(stderr).toEqual([]);
    expect(executeCapturePostPstEvidence).toHaveBeenCalledWith({
      orgAlias: 'ARM',
      quoteId: 'Q-001',
      lineIds: ['L-1'],
      allLines: false,
      includeAdjustments: false,
      includeLineDetail: false,
      includeUsageRating: false
    });
    expect(stdout.join('')).toContain('quote-runtime capture-post-pst-evidence');
  });

  it('runs whole-quote capture with the all-lines selector', async () => {
    const executeCapturePostPstEvidence = vi.fn(async () => createPrimitiveResult());
    await runCapturePostPstEvidenceCommand(
      ['--quote-id', 'Q-001', '--all-lines'],
      { help: false, json: true, orgAlias: 'ARM', failOn: 'error', output: undefined, verbose: false },
      { stdout: { write: () => undefined }, stderr: { write: () => undefined } },
      { executeCapturePostPstEvidence }
    );
    expect(executeCapturePostPstEvidence).toHaveBeenCalledWith(expect.objectContaining({
      quoteId: 'Q-001',
      lineIds: [],
      allLines: true
    }));
  });

  it('runs the command in json mode and preserves partial packet output', async () => {
    const stdout: string[] = [];
    const stderr: string[] = [];

    const execution = await runCapturePostPstEvidenceCommand(
      ['--quote-id', 'Q-001', '--line-id', 'L-1', '--include-line-detail'],
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
        executeCapturePostPstEvidence: vi.fn(async () =>
          createPrimitiveResult({
            status: 'partial',
            result: {
              ...createPrimitiveResult().result,
              line_evidence_packets: [
                {
                  ...createPrimitiveResult().result.line_evidence_packets[0],
                  capture_status: 'partial',
                  artifact_statuses: {
                    line_detail: 'unsupported',
                    price_adjustments: 'not_requested'
                  },
                  warnings: ['QuoteLineDetail could not be captured for line \'L-1\'.']
                }
              ],
              counts: {
                ...createPrimitiveResult().result.counts,
                ok_packets: 0,
                partial_packets: 1
              }
            },
            warnings: ['QuoteLineDetail could not be captured for line \'L-1\'.']
          })
        )
      }
    );

    expect(execution.exitCode).toBe(0);
    expect(stderr).toEqual([]);
    expect(JSON.parse(stdout.join(''))).toMatchObject({
      command: 'capture-post-pst-evidence',
      status: 'partial',
      result: {
        counts: {
          partial_packets: 1
        },
        line_evidence_packets: [
          {
            requested_line_id: 'L-1',
            capture_status: 'partial',
            artifact_statuses: {
              line_detail: 'unsupported'
            }
          }
        ]
      }
    });
  });

  it('rejects missing required selectors through the shared readiness path', async () => {
    await expect(
      runCapturePostPstEvidenceCommand(
        ['--quote-id', 'Q-001'],
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
    ).rejects.toThrow('capture-post-pst-evidence readiness check failed: Provide at least one --line-id <id>.');
  });

  it('rejects all-lines combined with explicit line selectors', async () => {
    await expect(
      runCapturePostPstEvidenceCommand(
        ['--quote-id', 'Q-001', '--all-lines', '--line-id', 'L-1'],
        { help: false, json: false, orgAlias: 'ARM', failOn: 'error', output: undefined, verbose: false },
        { stdout: { write: () => undefined }, stderr: { write: () => undefined } }
      )
    ).rejects.toThrow('Use either --all-lines or one or more --line-id values, not both.');
  });

  it('routes readiness failures through the CLI entrypoint as parse-style exits', async () => {
    const stdout: string[] = [];
    const stderr: string[] = [];

    const exitCode = await runQuoteRuntimeCli(
      ['capture-post-pst-evidence', '--org-alias', 'ARM', '--quote-id', 'Q-001'],
      {
        stdout: { write: (message: string) => void stdout.push(message) },
        stderr: { write: (message: string) => void stderr.push(message) }
      }
    );

    expect(exitCode).toBe(2);
    expect(stdout).toEqual([]);
    expect(stderr.join('')).toContain('capture-post-pst-evidence readiness check failed: Provide at least one --line-id <id>.');
  });
});
