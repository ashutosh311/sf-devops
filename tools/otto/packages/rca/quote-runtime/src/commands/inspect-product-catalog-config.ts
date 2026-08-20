import { Flags, Parser } from '@oclif/core';

import type { GlobalFlags } from '../cli/global-flags';
import { emitJsonOutput, emitTextOutput, type CliIo } from '../cli/output';
import { runEnvelopeCommand, type EnvelopeCommandSpec } from '../cli/run-envelope-command';
import { exitCodeForStatus, makeEnvelope, type ResultEnvelope } from '../contracts/result-envelope';
import {
  executeProductCatalogConfig,
  type ExecuteProductCatalogConfigInput,
  type ProductCatalogConfigPrimitiveResult,
  type ProductCatalogConfigResult
} from '../primitives/product-catalog-config';

export const INSPECT_PRODUCT_CATALOG_CONFIG_HELP_TEXT = [
  'quote-runtime inspect-product-catalog-config',
  '',
  'Usage:',
  '  quote-runtime inspect-product-catalog-config --org-alias <alias> --product-id <id> --pricebook-id <id> [--catalog-id <id>] [--account-id <id>] [--product-selling-model-id <id>] [--attribute-name <name>] [--component-group <name>] [--include-raw]',
  '',
  'Global flags:',
  '  --json',
  '  --org-alias <alias>',
  '  --fail-on <status>',
  '  --output <path>',
  '  --verbose',
  '',
  'Inspect-product-catalog-config flags:',
  '  --product-id <id>                 Required Product2 id.',
  '  --pricebook-id <id>               Required Pricebook2 id.',
  '  --catalog-id <id>                 Optional catalog context.',
  '  --account-id <id>                 Optional account context.',
  '  --product-selling-model-id <id>   Optional selling model context.',
  '  --attribute-name <name>           Focus returned attributes by name/code.',
  '  --component-group <name>          Focus returned component groups by name/code.',
  '  --include-raw                     Include raw Product Details response.',
  '',
  'Notes:',
  '  Product Details API is the primary source. SOQL is used only to supplement compact pricebook/component facts.',
  '  This command does not require a quote id or quote line id.'
].join('\n');

const INSPECT_PRODUCT_CATALOG_CONFIG_FLAG_DEFINITIONS = {
  'product-id': Flags.string({ required: true, helpValue: '<id>', summary: 'Product2 id.' }),
  'pricebook-id': Flags.string({ required: true, helpValue: '<id>', summary: 'Pricebook2 id.' }),
  'catalog-id': Flags.string({ required: false, helpValue: '<id>', summary: 'Catalog id.' }),
  'account-id': Flags.string({ required: false, helpValue: '<id>', summary: 'Account id.' }),
  'product-selling-model-id': Flags.string({ required: false, helpValue: '<id>', summary: 'Product selling model id.' }),
  'attribute-name': Flags.string({ required: false, helpValue: '<name>', summary: 'Attribute focus filter.' }),
  'component-group': Flags.string({ required: false, helpValue: '<name>', summary: 'Component group focus filter.' }),
  'include-raw': Flags.boolean({ allowNo: false, summary: 'Include raw Product Details response.' })
};

export type InspectProductCatalogConfigCommandFlags = {
  productId: string;
  pricebookId: string;
  catalogId: string | null;
  accountId: string | null;
  productSellingModelId: string | null;
  attributeName: string | null;
  componentGroup: string | null;
  includeRaw: boolean;
};

export type InspectProductCatalogConfigExecution = {
  envelope: ResultEnvelope;
  text: string;
  exitCode: 0 | 1;
};

export type InspectProductCatalogConfigCommandDependencies = {
  executeProductCatalogConfig?: (input: ExecuteProductCatalogConfigInput) => Promise<ProductCatalogConfigPrimitiveResult>;
};

export async function parseInspectProductCatalogConfigFlags(argv: string[]): Promise<InspectProductCatalogConfigCommandFlags> {
  const parsed = (await Parser.parse(argv, {
    args: {},
    enableJsonFlag: false,
    flags: INSPECT_PRODUCT_CATALOG_CONFIG_FLAG_DEFINITIONS,
    strict: true
  })) as {
    flags: {
      'product-id': string;
      'pricebook-id': string;
      'catalog-id'?: string;
      'account-id'?: string;
      'product-selling-model-id'?: string;
      'attribute-name'?: string;
      'component-group'?: string;
      'include-raw'?: boolean;
    };
  };

  return {
    productId: parsed.flags['product-id'],
    pricebookId: parsed.flags['pricebook-id'],
    catalogId: parsed.flags['catalog-id'] ?? null,
    accountId: parsed.flags['account-id'] ?? null,
    productSellingModelId: parsed.flags['product-selling-model-id'] ?? null,
    attributeName: parsed.flags['attribute-name'] ?? null,
    componentGroup: parsed.flags['component-group'] ?? null,
    includeRaw: parsed.flags['include-raw'] === true
  };
}

export function renderInspectProductCatalogConfigHelp(): string {
  return INSPECT_PRODUCT_CATALOG_CONFIG_HELP_TEXT;
}

export function buildInspectProductCatalogConfigEnvelope(input: {
  globalFlags: GlobalFlags;
  commandFlags: InspectProductCatalogConfigCommandFlags;
  primitiveResult: ProductCatalogConfigPrimitiveResult;
  generatedAt?: string;
  durationMs?: number;
}): ResultEnvelope {
  if (!input.globalFlags.orgAlias) {
    throw new Error('inspect-product-catalog-config envelope requires a resolved org alias.');
  }

  return makeEnvelope({
    command: 'inspect-product-catalog-config',
    status: input.primitiveResult.status,
    summary: {
      primary_subject: input.commandFlags.productId,
      status_reason: buildInspectProductCatalogConfigStatusReason(input.primitiveResult),
      primary_lane: 'configured_quote_discovery',
      verification_anchor: input.commandFlags.pricebookId,
      next_suggested_command: 'plan-product-config'
    },
    result: input.primitiveResult.result as unknown as Record<string, never>,
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

export function renderInspectProductCatalogConfigText(envelope: ResultEnvelope): string {
  const result = envelope.result as unknown as ProductCatalogConfigResult;
  const requiredAttributeCount = result.config_summary.required_attributes.length;
  const optionalAttributeCount = result.config_summary.optional_attributes.length;
  const componentGroupCount = result.config_summary.component_groups.length;
  const lines = [
    'quote-runtime inspect-product-catalog-config',
    `status: ${envelope.status}`,
    `org alias: ${envelope.meta.org_alias}`,
    `product: ${result.product_identity.product_name ?? '(unknown)'} (${result.product_identity.product_id})`,
    `pricebook entry: ${result.product_identity.pricebook_entry_id ?? '(none)'}`,
    `required attributes: ${requiredAttributeCount}`,
    `optional attributes: ${optionalAttributeCount}`,
    `component groups: ${componentGroupCount}`,
    `pre-quote runtime validation: ${String(result.config_summary.runtime_validation_available_pre_quote)}`,
    'next: plan-product-config'
  ];

  for (const attribute of result.config_summary.required_attributes) {
    lines.push(`- required attribute: ${attribute.name} values=${attribute.values.length}`);
  }

  for (const group of result.config_summary.component_groups) {
    lines.push(`- component group: ${group.name} children=${group.child_options.length} min=${group.min_cardinality ?? '(unknown)'} max=${group.max_cardinality ?? '(unknown)'}`);
  }

  if (envelope.warnings.length > 0) {
    lines.push('warnings:');
    lines.push(...envelope.warnings.map((warning) => `- ${warning}`));
  }

  if (envelope.errors.length > 0) {
    lines.push('errors:');
    lines.push(...envelope.errors.map((error) => `- ${error}`));
  }

  lines.push('');
  return lines.join('\n');
}

const INSPECT_PRODUCT_CATALOG_CONFIG_SPEC: EnvelopeCommandSpec<InspectProductCatalogConfigCommandDependencies> = {
  commandName: 'inspect-product-catalog-config',
  execute: async ({ argv, globalFlags, startedAt, deps }) => {
    const commandFlags = await parseInspectProductCatalogConfigFlags(argv);
    const runPrimitive = deps.executeProductCatalogConfig ?? executeProductCatalogConfig;
    const primitiveResult = await runPrimitive({
      orgAlias: globalFlags.orgAlias!,
      productId: commandFlags.productId,
      pricebookId: commandFlags.pricebookId,
      catalogId: commandFlags.catalogId,
      accountId: commandFlags.accountId,
      productSellingModelId: commandFlags.productSellingModelId,
      attributeName: commandFlags.attributeName,
      componentGroup: commandFlags.componentGroup,
      includeRaw: commandFlags.includeRaw
    });

    return buildInspectProductCatalogConfigEnvelope({
      globalFlags,
      commandFlags,
      primitiveResult,
      durationMs: Math.max(0, Date.now() - startedAt)
    });
  },
  renderText: renderInspectProductCatalogConfigText
};

export async function runInspectProductCatalogConfigCommand(
  argv: string[],
  globalFlags: GlobalFlags,
  io: CliIo,
  dependencies: InspectProductCatalogConfigCommandDependencies = {}
): Promise<InspectProductCatalogConfigExecution> {
  return runEnvelopeCommand(INSPECT_PRODUCT_CATALOG_CONFIG_SPEC, argv, globalFlags, io, dependencies);
}

function buildInspectProductCatalogConfigStatusReason(primitiveResult: ProductCatalogConfigPrimitiveResult): string {
  if (primitiveResult.status === 'ok') {
    return 'Inspected product catalog configuration shape.';
  }
  if (primitiveResult.status === 'partial') {
    return 'Inspected Product Details response with incomplete SOQL supplementation.';
  }
  return primitiveResult.errors[0] ?? `inspect-product-catalog-config finished with status ${primitiveResult.status}.`;
}

// ---------------------------------------------------------------------------
// CommandSpec (Q3: defineCommand consolidation)
// ---------------------------------------------------------------------------
import { defineCommand, WAVE_GROUP_NAMES } from './spec';

export const INSPECT_PRODUCT_CATALOG_CONFIG_COMMAND_SPEC = defineCommand({
  name: 'inspect-product-catalog-config',
  wave: 3,
  group_name: WAVE_GROUP_NAMES[3],
  summary: 'Inspect product details, required attributes, and component options before quote creation.',
  ownership: {
        primary_owner: 'config-runtime-bridge',
        secondary_escalation: ['quote-runtime-mutations'],
        shared_library_dependencies: ['product_catalog_config', 'evidence']
  },
  selectorPolicy: {
        required_selectors: [],
        recommended_selectors: [],
        status_reason: 'Product catalog config inspection requires product and pricebook ids at command parse time.'
  },
    quickStart: 'quote-runtime inspect-product-catalog-config --org-alias <alias> --product-id <id> --pricebook-id <id>',
  renderHelp: renderInspectProductCatalogConfigHelp,
  run: runInspectProductCatalogConfigCommand
});
