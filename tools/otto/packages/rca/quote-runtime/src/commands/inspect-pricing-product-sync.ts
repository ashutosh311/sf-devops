import { Flags, Parser } from '@oclif/core';

import type { GlobalFlags } from '../cli/global-flags';
import { emitJsonOutput, emitTextOutput, type CliIo } from '../cli/output';
import { runEnvelopeCommand, type EnvelopeCommandSpec } from '../cli/run-envelope-command';
import { exitCodeForStatus, makeEnvelope, type JsonValue, type ResultEnvelope } from '../contracts/result-envelope';
import {
  executeInspectPricingProductSync,
  type ExecuteInspectPricingProductSyncInput,
  type PricingProductSyncPrimitiveResult
} from '../primitives/pricing-product-sync';

export const INSPECT_PRICING_PRODUCT_SYNC_HELP_TEXT = [
  'quote-runtime inspect-pricing-product-sync',
  '',
  'Usage:',
  '  quote-runtime inspect-pricing-product-sync --org-alias <alias> [--include-index-logs] [--sample-limit <n>] [--json] [--fail-on <status>] [--output <path>] [--verbose]',
  '',
  'Notes:',
  '  Performs read-only product catalog index status/settings and DecisionTable sync-status inspection.',
  '  Does not execute product index deploy, pricing data sync, decision-table refresh, or quote mutation.'
].join('\n');

const FLAGS = {
  'include-index-logs': Flags.boolean({ allowNo: false }),
  'sample-limit': Flags.integer({ required: false })
};

export type InspectPricingProductSyncCommandFlags = {
  includeIndexLogs: boolean;
  sampleLimit?: number;
};

export type InspectPricingProductSyncCommandDependencies = {
  executeInspectPricingProductSync?: (
    input: ExecuteInspectPricingProductSyncInput
  ) => Promise<PricingProductSyncPrimitiveResult>;
};

export function renderInspectPricingProductSyncHelp(): string {
  return INSPECT_PRICING_PRODUCT_SYNC_HELP_TEXT;
}

export async function parseInspectPricingProductSyncFlags(
  argv: string[]
): Promise<InspectPricingProductSyncCommandFlags> {
  const parsed = (await Parser.parse(argv, {
    args: {},
    enableJsonFlag: false,
    flags: FLAGS,
    strict: true
  })) as {
    flags: {
      'include-index-logs'?: boolean;
      'sample-limit'?: number;
    };
  };

  return {
    includeIndexLogs: parsed.flags['include-index-logs'] === true,
    sampleLimit: parsed.flags['sample-limit']
  };
}

const INSPECT_PRICING_PRODUCT_SYNC_SPEC: EnvelopeCommandSpec<InspectPricingProductSyncCommandDependencies> = {
  commandName: 'inspect-pricing-product-sync',
  execute: async ({ argv, globalFlags, startedAt, deps }) => {
    const commandFlags = await parseInspectPricingProductSyncFlags(argv);
    const primitive = await (deps.executeInspectPricingProductSync ?? executeInspectPricingProductSync)({
      orgAlias: globalFlags.orgAlias!,
      includeIndexLogs: commandFlags.includeIndexLogs,
      sampleLimit: commandFlags.sampleLimit
    });
    return makeEnvelope({
      command: 'inspect-pricing-product-sync',
      status: primitive.status,
      summary: {
        primary_subject: 'pricing-product-sync',
        status_reason: buildStatusReason(primitive),
        primary_lane: 'pricing_product_sync_preflight',
        next_suggested_command: 'inspect-usage-rate-model'
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
  renderText: renderInspectPricingProductSyncText
};

export async function runInspectPricingProductSyncCommand(
  argv: string[],
  globalFlags: GlobalFlags,
  io: CliIo,
  dependencies: InspectPricingProductSyncCommandDependencies = {}
): Promise<{ envelope: ResultEnvelope; text: string; exitCode: 0 | 1 }> {
  return runEnvelopeCommand(INSPECT_PRICING_PRODUCT_SYNC_SPEC, argv, globalFlags, io, dependencies);
}

export function renderInspectPricingProductSyncText(envelope: ResultEnvelope): string {
  const orgProven = readRecord(envelope.result.org_proven);
  const productIndex = readRecord(orgProven?.product_catalog_index);
  const decisionTables = readRecord(orgProven?.decision_tables);
  const guardrails = Array.isArray(envelope.result.guardrails) ? envelope.result.guardrails : [];

  return [
    'quote-runtime inspect-pricing-product-sync',
    `status: ${envelope.status}`,
    `reason: ${String(envelope.summary.status_reason ?? '')}`,
    `product index: ${String(productIndex?.latest_index_status ?? 'unknown')} (${String(productIndex?.latest_index_record_count ?? 'unknown')} records)`,
    `decision tables sampled: ${String(decisionTables?.sampled_count ?? 'unknown')}`,
    'execution: not available from this command',
    ...(guardrails.length > 0 ? ['guardrails:', ...guardrails.map((guardrail) => `  ${String(guardrail)}`)] : [])
  ].join('\n');
}

function buildStatusReason(primitive: PricingProductSyncPrimitiveResult): string {
  const productIndex = primitive.result.org_proven.product_catalog_index;
  const decisionTables = primitive.result.org_proven.decision_tables;
  return [
    `product index ${productIndex.status}`,
    `decision tables ${decisionTables.status}`,
    `${primitive.result.unknown.blockers.length} execution blocker(s)`
  ].join('; ');
}

function readRecord(value: unknown): Record<string, JsonValue> | null {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, JsonValue>) : null;
}

function toJsonRecord(value: unknown): Record<string, JsonValue> {
  return JSON.parse(JSON.stringify(value)) as Record<string, JsonValue>;
}

// ---------------------------------------------------------------------------
// CommandSpec (Q3: defineCommand consolidation)
// ---------------------------------------------------------------------------
import { defineCommand, WAVE_GROUP_NAMES } from './spec';

export const INSPECT_PRICING_PRODUCT_SYNC_COMMAND_SPEC = defineCommand({
  name: 'inspect-pricing-product-sync',
  wave: 3,
  group_name: WAVE_GROUP_NAMES[3],
  summary: 'Read product index and DecisionTable sync readiness without executing refresh or deploy jobs.',
  ownership: {
        primary_owner: 'config-runtime-bridge',
        secondary_escalation: ['pricing-runtime-debug', 'quote-runtime-mutations'],
        shared_library_dependencies: ['pricing_product_sync', 'evidence']
  },
  selectorPolicy: {
        required_selectors: [],
        recommended_selectors: [],
        status_reason: 'Pricing/product sync preflight can run org-wide and never executes refresh or deploy jobs.'
  },
    quickStart: 'quote-runtime inspect-pricing-product-sync --org-alias <alias>',
  renderHelp: renderInspectPricingProductSyncHelp,
  run: runInspectPricingProductSyncCommand
});
