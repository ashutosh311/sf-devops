import { Flags, Parser } from '@oclif/core';

import type { GlobalFlags } from '../cli/global-flags';
import { emitJsonOutput, emitTextOutput, type CliIo } from '../cli/output';
import { runEnvelopeCommand, type EnvelopeCommandSpec } from '../cli/run-envelope-command';
import { exitCodeForStatus, makeEnvelope, type JsonValue, type ResultEnvelope } from '../contracts/result-envelope';
import {
  executeInspectPricingWaterfall,
  type ExecuteInspectPricingWaterfallInput,
  type InspectPricingWaterfallPrimitiveResult,
  type InspectPricingWaterfallResult
} from '../primitives/inspect-pricing-waterfall';
import {
  formatCommandReadinessIssues,
  getReadinessIssuesForPolicy,
  type CommandReadinessIssue,
  type CommandSelectorPolicy
} from '../routing/selector-functions';
import { normalizeSelectors } from '../selectors/runtime-selectors';

export const INSPECT_PRICING_WATERFALL_HELP_TEXT = [
  'quote-runtime inspect-pricing-waterfall',
  '',
  'Usage:',
  '  quote-runtime inspect-pricing-waterfall --org-alias <alias> --quote-id <id> --line-id <id> [--json] [--fail-on <status>] [--output <path>] [--verbose]',
  '',
  'Global flags:',
  '  --json',
  '  --org-alias <alias>',
  '  --fail-on <status>',
  '  --output <path>',
  '  --verbose',
  '',
  'Inspect-pricing-waterfall flags:',
  '  --quote-id <id>     Required quote selector for persisted target resolution.',
  '  --line-id <id>      Required single line selector for V1 waterfall inspection.',
  '',
  'Notes:',
  '  inspect-pricing-waterfall is the canonical persisted-first pricing-waterfall command for V1.',
  '  V1 requires exactly one --line-id and does not expose execution-id selectors.',
  '',
  'Example:',
  '  quote-runtime inspect-pricing-waterfall --org-alias <alias> --quote-id <id> --line-id <id>'
].join('\n');

const INSPECT_PRICING_WATERFALL_FLAG_DEFINITIONS = {
  'quote-id': Flags.string({
    required: false,
    helpValue: '<id>',
    summary: 'Required quote selector for persisted target resolution.'
  }),
  'line-id': Flags.string({
    required: false,
    multiple: true,
    helpValue: '<id>',
    summary: 'Required single line selector for V1 waterfall inspection.'
  })
};

export type InspectPricingWaterfallCommandFlags = {
  quoteId?: string;
  lineIds: string[];
};

export type InspectPricingWaterfallExecution = {
  envelope: ResultEnvelope;
  text: string;
  exitCode: 0 | 1;
};

export type BuildInspectPricingWaterfallEnvelopeInput = {
  globalFlags: GlobalFlags;
  commandFlags: InspectPricingWaterfallCommandFlags;
  primitiveResult: InspectPricingWaterfallPrimitiveResult;
  generatedAt?: string;
  durationMs?: number;
};

export type InspectPricingWaterfallCommandDependencies = {
  executeInspectPricingWaterfall?: (
    input: ExecuteInspectPricingWaterfallInput
  ) => Promise<InspectPricingWaterfallPrimitiveResult>;
};

export async function parseInspectPricingWaterfallFlags(argv: string[]): Promise<InspectPricingWaterfallCommandFlags> {
  const parsed = (await Parser.parse(argv, {
    args: {},
    enableJsonFlag: false,
    flags: INSPECT_PRICING_WATERFALL_FLAG_DEFINITIONS,
    strict: true
  })) as {
    flags: {
      'quote-id'?: string;
      'line-id'?: string[];
    };
  };

  const selectors = normalizeSelectors({
    quote_id: parsed.flags['quote-id'],
    line_id: parsed.flags['line-id'] ?? []
  });

  return selectors.quote_id === null
    ? { lineIds: selectors.line_ids }
    : { quoteId: selectors.quote_id, lineIds: selectors.line_ids };
}

export function renderInspectPricingWaterfallHelp(): string {
  return INSPECT_PRICING_WATERFALL_HELP_TEXT;
}

export function buildInspectPricingWaterfallEnvelope(input: BuildInspectPricingWaterfallEnvelopeInput): ResultEnvelope {
  if (!input.globalFlags.orgAlias) {
    throw new Error('inspect-pricing-waterfall envelope requires a resolved org alias.');
  }

  const result = inspectPricingWaterfallResultToJsonRecord(input.primitiveResult.result);
  const resolvedLineId = input.primitiveResult.result.selector_resolution.resolved_line_id;

  return makeEnvelope({
    command: 'inspect-pricing-waterfall',
    status: input.primitiveResult.status,
    summary: {
      primary_subject: input.commandFlags.quoteId ?? 'inspect-pricing-waterfall',
      status_reason: buildInspectPricingWaterfallStatusReason(input.commandFlags, input.primitiveResult),
      primary_lane: 'quote_pricing',
      verification_anchor:
        input.commandFlags.quoteId && resolvedLineId
          ? `quote:${input.commandFlags.quoteId}:line:${resolvedLineId}`
          : input.commandFlags.quoteId
            ? `quote:${input.commandFlags.quoteId}`
            : 'inspect-pricing-waterfall',
      next_suggested_command: input.primitiveResult.result.recommended_next_commands[0] ?? null,
      key_counts: {
        waterfall_elements: input.primitiveResult.result.waterfall.summary.element_count,
        waterfall_formulas: input.primitiveResult.result.waterfall.summary.formula_count,
        api_execution_logs: input.primitiveResult.result.correlation.api_execution_log.fetch_status === 'ok' ? 1 : 0,
        recommended_next_commands: input.primitiveResult.result.recommended_next_commands.length
      }
    } satisfies Record<string, JsonValue>,
    result,
    warnings: input.primitiveResult.warnings,
    errors: input.primitiveResult.errors,
    evidence: input.primitiveResult.evidence,
    meta: {
      org_alias: input.globalFlags.orgAlias,
      generated_at: input.generatedAt ?? new Date().toISOString(),
      duration_ms: input.durationMs ?? 0,
      source_files: []
    }
  });
}

export function renderInspectPricingWaterfallText(envelope: ResultEnvelope): string {
  const result = envelope.result as unknown as InspectPricingWaterfallResult;
  const lines = [
    'quote-runtime inspect-pricing-waterfall',
    `status: ${envelope.status}`,
    `org alias: ${envelope.meta.org_alias}`,
    `quote id: ${result.selector_resolution.quote_id}`,
    `requested line id: ${result.selector_resolution.requested_line_id}`,
    `resolved line id: ${String(result.selector_resolution.resolved_line_id ?? '(none)')}`,
    `price waterfall identifier: ${String(result.selector_resolution.price_waterfall_identifier ?? '(none)')}`,
    `pricing execution id: ${String(result.selector_resolution.pricing_execution_id ?? '(none)')}`,
    `shared execution key: ${String(result.correlation.shared_execution_key ?? '(none)')}`,
    `API execution type key: ${String(result.correlation.api_execution_log.api_execution_type_key ?? '(none)')}`,
    `API execution log fetch: ${result.correlation.api_execution_log.fetch_status}`,
    `line membership confirmed: ${formatScalar(result.correlation.line_membership_confirmed)}`,
    `waterfall fetch: ${result.waterfall.fetch_status}`,
    `waterfall summary: elements=${result.waterfall.summary.element_count} formulas=${result.waterfall.summary.formula_count}`,
    `waterfall outputs: ${formatList(result.waterfall.summary.output_targets)}`,
    `recommended next commands: ${formatList(result.recommended_next_commands)}`
  ];

  if (result.persisted_anchor !== null) {
    lines.push('');
    lines.push('persisted anchor:');
    for (const [fieldName, value] of Object.entries(result.persisted_anchor)) {
      lines.push(`${fieldName}: ${formatScalar(value)}`);
    }
  }

  if (result.waterfall.normalized_elements.length > 0) {
    lines.push('');
    lines.push('waterfall elements:');
    for (const element of result.waterfall.normalized_elements) {
      lines.push(`- [${element.sequence}] ${element.name ?? '(unnamed)'}`);
      lines.push(`  writes: ${formatList(element.writes)}`);
      lines.push(`  formula: ${element.calculation_formula ?? '(none)'}`);
    }
  }

  if (envelope.warnings.length > 0) {
    lines.push('');
    lines.push('Warnings:');
    for (const warning of envelope.warnings) {
      lines.push(`- ${warning}`);
    }
  }

  if (envelope.errors.length > 0) {
    lines.push('');
    lines.push('Errors:');
    for (const error of envelope.errors) {
      lines.push(`- ${error}`);
    }
  }

  lines.push('');
  return lines.join('\n');
}

const INSPECT_PRICING_WATERFALL_SPEC: EnvelopeCommandSpec<InspectPricingWaterfallCommandDependencies> = {
  commandName: 'inspect-pricing-waterfall',
  execute: async ({ argv, globalFlags, startedAt, deps }) => {
    const commandFlags = await parseInspectPricingWaterfallFlags(argv);
    const readinessIssues = getInspectPricingWaterfallReadinessIssues(commandFlags);

    if (readinessIssues.length > 0) {
      throw new Error(formatCommandReadinessIssues('inspect-pricing-waterfall', readinessIssues));
    }

    const runPrimitive = deps.executeInspectPricingWaterfall ?? executeInspectPricingWaterfall;
    const primitiveResult = await runPrimitive({
      orgAlias: globalFlags.orgAlias!,
      quoteId: commandFlags.quoteId ?? '',
      lineIds: commandFlags.lineIds
    });

    return buildInspectPricingWaterfallEnvelope({
      globalFlags,
      commandFlags,
      primitiveResult,
      durationMs: Math.max(0, Date.now() - startedAt)
    });
  },
  renderText: renderInspectPricingWaterfallText
};

export async function runInspectPricingWaterfallCommand(
  argv: string[],
  globalFlags: GlobalFlags,
  io: CliIo,
  dependencies: InspectPricingWaterfallCommandDependencies = {}
): Promise<InspectPricingWaterfallExecution> {
  return runEnvelopeCommand(INSPECT_PRICING_WATERFALL_SPEC, argv, globalFlags, io, dependencies);
}

function getInspectPricingWaterfallReadinessIssues(
  commandFlags: InspectPricingWaterfallCommandFlags
): CommandReadinessIssue[] {
  return getReadinessIssuesForPolicy(
    INSPECT_PRICING_WATERFALL_SELECTOR_POLICY,
    normalizeSelectors({
      quote_id: commandFlags.quoteId,
      line_id: commandFlags.lineIds
    })
  );
}

function buildInspectPricingWaterfallStatusReason(
  commandFlags: InspectPricingWaterfallCommandFlags,
  primitiveResult: InspectPricingWaterfallPrimitiveResult
): string {
  const requestedLineId = commandFlags.lineIds[0] ?? '(missing)';
  const quoteId = commandFlags.quoteId ?? '(missing quote id)';

  switch (primitiveResult.status) {
    case 'ok':
      return `Resolved line '${requestedLineId}' on quote '${quoteId}' and fetched the core-pricing waterfall.`;
    case 'partial':
      return primitiveResult.result.waterfall.fetch_status === 'ok'
        ? `Fetched the core-pricing waterfall for line '${requestedLineId}', but correlation evidence remained incomplete.`
        : `Resolved line '${requestedLineId}' on quote '${quoteId}', but waterfall inspection stayed partial.`;
    case 'no_match':
      return `No persisted quote line matched '${requestedLineId}' on quote '${quoteId}'.`;
    case 'unsupported':
      return primitiveResult.errors[0] ?? `Core-pricing waterfall inspection is unsupported for line '${requestedLineId}'.`;
    case 'error':
      return primitiveResult.errors[0] ?? `Core-pricing waterfall inspection failed for line '${requestedLineId}'.`;
  }
}

function inspectPricingWaterfallResultToJsonRecord(result: InspectPricingWaterfallResult): Record<string, JsonValue> {
  return {
    selector_resolution: result.selector_resolution as unknown as JsonValue,
    persisted_anchor: result.persisted_anchor as unknown as JsonValue,
    correlation: result.correlation as unknown as JsonValue,
    waterfall: result.waterfall as unknown as JsonValue,
    recommended_next_commands: [...result.recommended_next_commands]
  };
}

function formatList(values: readonly string[]): string {
  return values.length === 0 ? '(none)' : values.join(', ');
}

function formatScalar(value: JsonValue | boolean | null): string {
  if (value === null) {
    return 'null';
  }
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
    return String(value);
  }
  return JSON.stringify(value);
}

// ---------------------------------------------------------------------------
// CommandSpec (Q3: defineCommand consolidation)
// ---------------------------------------------------------------------------
import { defineCommand, WAVE_GROUP_NAMES } from './spec';

// Extracted so getInspectPricingWaterfallReadinessIssues can use it directly
// (via getReadinessIssuesForPolicy) without consulting the derived map.
const INSPECT_PRICING_WATERFALL_SELECTOR_POLICY: CommandSelectorPolicy = {
  required_selectors: ['quote_id', 'line_ids'],
  recommended_selectors: [],
  selector_constraints: [
    {
      key: 'line_ids_exactly_one',
      selector: 'line_ids',
      kind: 'exactly_one',
      message: 'Provide exactly one unique --line-id <id> in V1.'
    }
  ],
  status_reason: 'Pricing-waterfall inspection requires a quote id and exactly one target line id in V1.'
};

export const INSPECT_PRICING_WATERFALL_COMMAND_SPEC = defineCommand({
  name: 'inspect-pricing-waterfall',
  wave: 3,
  group_name: WAVE_GROUP_NAMES[3],
  summary: 'Inspect the persisted-first pricing waterfall for one quote line without exposing execution-id selectors.',
  ownership: {
        primary_owner: 'pricing-runtime-debug',
        secondary_escalation: ['runtime-context-inspection', 'config-runtime-bridge'],
        shared_library_dependencies: ['snapshot_lines', 'selectors', 'evidence']
  },
  selectorPolicy: INSPECT_PRICING_WATERFALL_SELECTOR_POLICY,
    quickStart: 'quote-runtime inspect-pricing-waterfall --org-alias <alias> --quote-id <id> --line-id <id>',
  renderHelp: renderInspectPricingWaterfallHelp,
  run: runInspectPricingWaterfallCommand
});
