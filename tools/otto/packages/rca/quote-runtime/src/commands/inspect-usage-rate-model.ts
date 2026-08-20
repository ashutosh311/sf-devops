import { Flags, Parser } from '@oclif/core';

import type { GlobalFlags } from '../cli/global-flags';
import { emitJsonOutput, emitTextOutput, type CliIo } from '../cli/output';
import { runEnvelopeCommand, type EnvelopeCommandSpec } from '../cli/run-envelope-command';
import { exitCodeForStatus, makeEnvelope, type JsonValue, type ResultEnvelope } from '../contracts/result-envelope';
import {
  executeInspectUsageRateModel,
  type ExecuteInspectUsageRateModelInput,
  type UsageRateModelPrimitiveResult
} from '../primitives/usage-rate-model';

export const INSPECT_USAGE_RATE_MODEL_HELP_TEXT = [
  'quote-runtime inspect-usage-rate-model',
  '',
  'Usage:',
  '  quote-runtime inspect-usage-rate-model --org-alias <alias> [--product-id <id>] [--pricebook-id <id>] [--include-samples] [--sample-limit <n>] [--json] [--fail-on <status>] [--output <path>] [--verbose]',
  '',
  'Notes:',
  '  Performs read-only describe and SOQL checks for Revenue Cloud usage, rate-card, and quote-side usage/rate objects.',
  '  Does not mutate catalog, pricing, decision-table, index, quote, or usage records.'
].join('\n');

const FLAGS = {
  'product-id': Flags.string({ required: false }),
  'pricebook-id': Flags.string({ required: false }),
  'include-samples': Flags.boolean({ allowNo: false }),
  'sample-limit': Flags.integer({ required: false })
};

export type InspectUsageRateModelCommandFlags = {
  productId?: string | null;
  pricebookId?: string | null;
  includeSamples: boolean;
  sampleLimit?: number;
};

export type InspectUsageRateModelCommandDependencies = {
  executeInspectUsageRateModel?: (input: ExecuteInspectUsageRateModelInput) => Promise<UsageRateModelPrimitiveResult>;
};

export function renderInspectUsageRateModelHelp(): string {
  return INSPECT_USAGE_RATE_MODEL_HELP_TEXT;
}

export async function parseInspectUsageRateModelFlags(argv: string[]): Promise<InspectUsageRateModelCommandFlags> {
  const parsed = (await Parser.parse(argv, {
    args: {},
    enableJsonFlag: false,
    flags: FLAGS,
    strict: true
  })) as {
    flags: {
      'product-id'?: string;
      'pricebook-id'?: string;
      'include-samples'?: boolean;
      'sample-limit'?: number;
    };
  };

  return {
    productId: parsed.flags['product-id'] ?? null,
    pricebookId: parsed.flags['pricebook-id'] ?? null,
    includeSamples: parsed.flags['include-samples'] === true,
    sampleLimit: parsed.flags['sample-limit']
  };
}

const INSPECT_USAGE_RATE_MODEL_SPEC: EnvelopeCommandSpec<InspectUsageRateModelCommandDependencies> = {
  commandName: 'inspect-usage-rate-model',
  execute: async ({ argv, globalFlags, startedAt, deps }) => {
    const commandFlags = await parseInspectUsageRateModelFlags(argv);
    const primitive = await (deps.executeInspectUsageRateModel ?? executeInspectUsageRateModel)({
      orgAlias: globalFlags.orgAlias!,
      productId: commandFlags.productId,
      pricebookId: commandFlags.pricebookId,
      includeSamples: commandFlags.includeSamples,
      sampleLimit: commandFlags.sampleLimit
    });
    const availableCount = primitive.result.org_proven.object_coverage.filter((object) => object.available).length;
    const totalCount = primitive.result.org_proven.object_coverage.length;
    return makeEnvelope({
      command: 'inspect-usage-rate-model',
      status: primitive.status,
      summary: {
        primary_subject: commandFlags.productId ?? commandFlags.pricebookId ?? 'usage-rate-model',
        status_reason: `${availableCount}/${totalCount} usage/rate objects available; ${primitive.warnings.length} warning(s).`,
        primary_lane: 'usage_rate_model_discovery',
        next_suggested_command: commandFlags.productId ? 'inspect-product-catalog-config' : 'discover-products'
      },
      result: toJsonRecord(primitive.result),
      warnings: primitive.warnings,
      errors: primitive.errors,
      evidence: primitive.evidence,
      meta: {
        org_alias: globalFlags.orgAlias!,
        generated_at: new Date().toISOString(),
        duration_ms: Math.max(0, Date.now() - startedAt),
        source_files: []
      }
    });
  },
  renderText: renderInspectUsageRateModelText
};

export async function runInspectUsageRateModelCommand(
  argv: string[],
  globalFlags: GlobalFlags,
  io: CliIo,
  dependencies: InspectUsageRateModelCommandDependencies = {}
): Promise<{ envelope: ResultEnvelope; text: string; exitCode: 0 | 1 }> {
  return runEnvelopeCommand(INSPECT_USAGE_RATE_MODEL_SPEC, argv, globalFlags, io, dependencies);
}

export function renderInspectUsageRateModelText(envelope: ResultEnvelope): string {
  const counts = envelope.result.org_proven && typeof envelope.result.org_proven === 'object' && !Array.isArray(envelope.result.org_proven)
    ? (envelope.result.org_proven as Record<string, JsonValue>).counts
    : null;
  const countLines = counts && typeof counts === 'object' && !Array.isArray(counts)
    ? Object.entries(counts)
      .slice(0, 12)
      .map(([objectName, count]) => `  ${objectName}: ${String(count)}`)
    : [];

  return [
    'quote-runtime inspect-usage-rate-model',
    `status: ${envelope.status}`,
    `reason: ${String(envelope.summary.status_reason ?? '')}`,
    `next: ${String(envelope.summary.next_suggested_command ?? '')}`,
    ...(countLines.length > 0 ? ['counts:', ...countLines] : [])
  ].join('\n');
}

function toJsonRecord(value: unknown): Record<string, JsonValue> {
  return JSON.parse(JSON.stringify(value)) as Record<string, JsonValue>;
}

// ---------------------------------------------------------------------------
// CommandSpec (Q3: defineCommand consolidation)
// ---------------------------------------------------------------------------
import { defineCommand, WAVE_GROUP_NAMES } from './spec';

export const INSPECT_USAGE_RATE_MODEL_COMMAND_SPEC = defineCommand({
  name: 'inspect-usage-rate-model',
  wave: 3,
  group_name: WAVE_GROUP_NAMES[3],
  summary: 'Read Revenue Cloud usage/rate object availability, field coverage, counts, and optional samples.',
  ownership: {
        primary_owner: 'config-runtime-bridge',
        secondary_escalation: ['pricing-runtime-debug', 'quote-runtime-mutations'],
        shared_library_dependencies: ['usage_rate_model', 'product_discovery', 'evidence']
  },
  selectorPolicy: {
        required_selectors: [],
        recommended_selectors: [],
        status_reason: 'Usage/rate model inspection can run org-wide; product and pricebook ids optionally narrow catalog-rate and runtime-readiness evidence.'
  },
    quickStart: 'quote-runtime inspect-usage-rate-model --org-alias <alias> --include-samples',
  renderHelp: renderInspectUsageRateModelHelp,
  run: runInspectUsageRateModelCommand
});
