import { Flags, Parser } from '@oclif/core';

import type { GlobalFlags } from '../cli/global-flags';
import { emitJsonOutput, emitTextOutput, type CliIo } from '../cli/output';
import { runEnvelopeCommand, type EnvelopeCommandSpec } from '../cli/run-envelope-command';
import { exitCodeForStatus, makeEnvelope, type JsonValue, type ResultEnvelope } from '../contracts/result-envelope';
import {
  executeProductCatalogIndexDeploy,
  type ExecuteProductCatalogIndexDeployInput,
  type ProductCatalogIndexDeployPrimitiveResult
} from '../primitives/product-catalog-index-deploy';

export const DEPLOY_PRODUCT_CATALOG_INDEX_HELP_TEXT = [
  'quote-runtime deploy-product-catalog-index',
  '',
  'Usage:',
  '  quote-runtime deploy-product-catalog-index --org-alias <alias> [--execute] [--json] [--fail-on <status>] [--output <path>] [--verbose]',
  '',
  'Notes:',
  '  Dry-run is default. The command preflights product catalog index status before any deploy POST.',
  '  --execute submits the documented product catalog index deploy route only; use refresh-decision-tables for DecisionTable refresh.'
].join('\n');

const FLAGS = {
  execute: Flags.boolean({ allowNo: false })
};

export type DeployProductCatalogIndexCommandFlags = {
  mode: 'dry_run' | 'execute';
};

export type DeployProductCatalogIndexCommandDependencies = {
  executeProductCatalogIndexDeploy?: (
    input: ExecuteProductCatalogIndexDeployInput
  ) => Promise<ProductCatalogIndexDeployPrimitiveResult>;
};

export function renderDeployProductCatalogIndexHelp(): string {
  return DEPLOY_PRODUCT_CATALOG_INDEX_HELP_TEXT;
}

export async function parseDeployProductCatalogIndexFlags(argv: string[]): Promise<DeployProductCatalogIndexCommandFlags> {
  const parsed = (await Parser.parse(argv, {
    args: {},
    enableJsonFlag: false,
    flags: FLAGS,
    strict: true
  })) as {
    flags: {
      execute?: boolean;
    };
  };

  return {
    mode: parsed.flags.execute === true ? 'execute' : 'dry_run'
  };
}

const DEPLOY_PRODUCT_CATALOG_INDEX_SPEC: EnvelopeCommandSpec<DeployProductCatalogIndexCommandDependencies> = {
  commandName: 'deploy-product-catalog-index',
  execute: async ({ argv, globalFlags, startedAt, deps }) => {
    const commandFlags = await parseDeployProductCatalogIndexFlags(argv);
    const primitive = await (deps.executeProductCatalogIndexDeploy ?? executeProductCatalogIndexDeploy)({
      orgAlias: globalFlags.orgAlias!,
      mode: commandFlags.mode
    });
    return makeEnvelope({
      command: 'deploy-product-catalog-index',
      status: primitive.status,
      summary: {
        primary_subject: 'product-catalog-index',
        status_reason: buildStatusReason(primitive),
        primary_lane: 'pricing_product_sync_preflight',
        next_suggested_command: primitive.result.expected_verification_commands[0] ?? 'inspect-pricing-product-sync',
        key_counts: {
          executed: primitive.result.execution.executed ? 1 : 0,
          blockers: primitive.result.preflight.blockers.length
        }
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
  renderText: renderDeployProductCatalogIndexText
};

export async function runDeployProductCatalogIndexCommand(
  argv: string[],
  globalFlags: GlobalFlags,
  io: CliIo,
  dependencies: DeployProductCatalogIndexCommandDependencies = {}
): Promise<{ envelope: ResultEnvelope; text: string; exitCode: 0 | 1 }> {
  return runEnvelopeCommand(DEPLOY_PRODUCT_CATALOG_INDEX_SPEC, argv, globalFlags, io, dependencies);
}

export function renderDeployProductCatalogIndexText(envelope: ResultEnvelope): string {
  const result = envelope.result;
  const preflight = readRecord(result.preflight);
  const execution = readRecord(result.execution);
  const commands = Array.isArray(result.expected_verification_commands) ? result.expected_verification_commands : [];
  return [
    'quote-runtime deploy-product-catalog-index',
    `status: ${envelope.status}`,
    `mode: ${String(result.mode ?? 'unknown')}`,
    `route: ${String(result.route ?? '')}`,
    `product index: ${String(preflight?.product_index_status ?? 'unknown')}`,
    `executed: ${String(execution?.executed ?? false)}`,
    `next: ${String(commands[0] ?? 'inspect-pricing-product-sync')}`
  ].join('\n');
}

function buildStatusReason(primitive: ProductCatalogIndexDeployPrimitiveResult): string {
  if (primitive.result.execution.executed) {
    return 'Submitted product catalog index deploy; run the expected verification commands for readback.';
  }
  if (primitive.status === 'ok' || primitive.status === 'warn') {
    return 'Validated product catalog index deploy dry-run; no sync job was submitted.';
  }
  return 'Product catalog index deploy preflight or submission failed.';
}

function toJsonRecord(value: ProductCatalogIndexDeployPrimitiveResult['result']): Record<string, JsonValue> {
  return value as unknown as Record<string, JsonValue>;
}

function readRecord(value: unknown): Record<string, JsonValue> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? value as Record<string, JsonValue>
    : null;
}

// ---------------------------------------------------------------------------
// CommandSpec (Q3: defineCommand consolidation)
// ---------------------------------------------------------------------------
import { defineCommand, WAVE_GROUP_NAMES } from './spec';

export const DEPLOY_PRODUCT_CATALOG_INDEX_COMMAND_SPEC = defineCommand({
  name: 'deploy-product-catalog-index',
  wave: 3,
  group_name: WAVE_GROUP_NAMES[3],
  summary: 'Dry-run or execute the documented product catalog index deploy route with preflight readback.',
  ownership: {
        primary_owner: 'config-runtime-bridge',
        secondary_escalation: ['pricing-runtime-debug', 'quote-runtime-mutations'],
        shared_library_dependencies: ['pricing_product_sync', 'rest', 'evidence']
  },
  selectorPolicy: {
        required_selectors: [],
        recommended_selectors: [],
        status_reason: 'Product catalog index deploy can dry-run org-wide; --execute submits the documented deploy route.'
  },
    quickStart: 'quote-runtime deploy-product-catalog-index --org-alias <alias>',
  renderHelp: renderDeployProductCatalogIndexHelp,
  run: runDeployProductCatalogIndexCommand
});
