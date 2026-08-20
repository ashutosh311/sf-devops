import { Flags, Parser } from '@oclif/core';

import type { GlobalFlags } from '../cli/global-flags';
import { emitJsonOutput, emitTextOutput, type CliIo } from '../cli/output';
import { runEnvelopeCommand, type EnvelopeCommandSpec } from '../cli/run-envelope-command';
import { exitCodeForStatus, makeEnvelope, type JsonValue, type ResultEnvelope } from '../contracts/result-envelope';
import type { RuntimeStatus } from '../contracts/status';
import {
  executeDiscoverProducts,
  type ExecuteDiscoverProductsInput,
  type ProductDiscoveryCandidate,
  type ProductDiscoveryPrimitiveResult
} from '../primitives/product-discovery';
import {
  executeProductCatalogConfig,
  type ExecuteProductCatalogConfigInput,
  type ProductCatalogConfigPrimitiveResult,
  type ProductCatalogConfigResult
} from '../primitives/product-catalog-config';

export const INSPECT_QUOTE_READY_PRODUCT_HELP_TEXT = [
  'quote-runtime inspect-quote-ready-product',
  '',
  'Usage:',
  '  quote-runtime inspect-quote-ready-product --org-alias <alias> --pricebook-id <id> (--product-id <id> | --term <text> ...) [--catalog-id <id>] [--account-id <id>] [--product-selling-model-id <id>] [--include-raw]',
  '',
  'Notes:',
  '  Read-only facade over discover-products and inspect-product-catalog-config.',
  '  Returns quote-readiness facts, templates, and next commands without making a business recommendation.'
].join('\n');

const FLAGS = {
  'pricebook-id': Flags.string({ required: true }),
  'product-id': Flags.string({ required: false }),
  term: Flags.string({ multiple: true, required: false }),
  'catalog-id': Flags.string({ required: false }),
  'account-id': Flags.string({ required: false }),
  'product-selling-model-id': Flags.string({ required: false }),
  'include-raw': Flags.boolean({ allowNo: false })
};

export type QuoteReadyProductReadinessStatus = 'ready' | 'needs_configuration' | 'ambiguous_product' | 'blocked' | 'unsupported';

export type InspectQuoteReadyProductCommandFlags = {
  pricebookId: string;
  productId: string | null;
  terms: string[];
  catalogId: string | null;
  accountId: string | null;
  productSellingModelId: string | null;
  includeRaw: boolean;
};

export type InspectQuoteReadyProductResult = {
  readiness_status: QuoteReadyProductReadinessStatus;
  product_match: {
    input_mode: 'product_id' | 'term';
    terms: string[];
    selected_product_id: string | null;
    selected_candidate: ProductDiscoveryCandidate | null;
    candidates: ProductDiscoveryCandidate[];
    omitted_count: number;
    match_strategy: ProductDiscoveryPrimitiveResult['result']['strategy'] | null;
  };
  selected_product_identity: ProductCatalogConfigResult['product_identity'] | null;
  pricebook_entry_id: string | null;
  required_attributes: ProductCatalogConfigResult['config_summary']['required_attributes'];
  optional_attributes: ProductCatalogConfigResult['config_summary']['optional_attributes'];
  component_groups: ProductCatalogConfigResult['config_summary']['component_groups'];
  default_components: Array<{
    group_name: string;
    product_id: string | null;
    product_name: string;
    product_code: string | null;
    related_component_id: string | null;
  }>;
  required_components: Array<{
    group_name: string;
    product_id: string | null;
    product_name: string;
    product_code: string | null;
    related_component_id: string | null;
  }>;
  quote_intent_line_template: {
    pricebook_entry_id: string | null;
    product_id: string | null;
    quantity: number;
    source: 'salesforce_catalog_facts';
  };
  config_choices_template: {
    attributes: Record<string, string>;
    componentSelections: Record<string, string[]>;
    sources: Record<string, string>;
  } | null;
  next_commands: string[];
  raw_product_details_response?: JsonValue;
};

export type InspectQuoteReadyProductPrimitiveInputs = {
  discoveryInputs: ExecuteDiscoverProductsInput[];
  catalogConfigInputs: ExecuteProductCatalogConfigInput[];
};

export type InspectQuoteReadyProductCommandDependencies = {
  executeDiscoverProducts?: (input: ExecuteDiscoverProductsInput) => Promise<ProductDiscoveryPrimitiveResult>;
  executeProductCatalogConfig?: (input: ExecuteProductCatalogConfigInput) => Promise<ProductCatalogConfigPrimitiveResult>;
};

export function renderInspectQuoteReadyProductHelp(): string {
  return INSPECT_QUOTE_READY_PRODUCT_HELP_TEXT;
}

export async function parseInspectQuoteReadyProductFlags(argv: string[]): Promise<InspectQuoteReadyProductCommandFlags> {
  const parsed = (await Parser.parse(argv, {
    args: {},
    enableJsonFlag: false,
    flags: FLAGS,
    strict: true
  })) as {
    flags: {
      'pricebook-id': string;
      'product-id'?: string;
      term?: string[];
      'catalog-id'?: string;
      'account-id'?: string;
      'product-selling-model-id'?: string;
      'include-raw'?: boolean;
    };
  };
  const terms = parsed.flags.term ?? [];
  const productId = parsed.flags['product-id'] ?? null;

  if ((productId ? 1 : 0) + (terms.length > 0 ? 1 : 0) !== 1) {
    throw new Error('inspect-quote-ready-product requires exactly one selector: --product-id <id> or one or more --term <text>.');
  }

  return {
    pricebookId: parsed.flags['pricebook-id'],
    productId,
    terms,
    catalogId: parsed.flags['catalog-id'] ?? null,
    accountId: parsed.flags['account-id'] ?? null,
    productSellingModelId: parsed.flags['product-selling-model-id'] ?? null,
    includeRaw: parsed.flags['include-raw'] === true
  };
}

export function buildInspectQuoteReadyProductEnvelope(input: {
  globalFlags: GlobalFlags;
  commandFlags: InspectQuoteReadyProductCommandFlags;
  discoveryResult: ProductDiscoveryPrimitiveResult | null;
  catalogConfigResult: ProductCatalogConfigPrimitiveResult | null;
  generatedAt?: string;
  durationMs?: number;
}): ResultEnvelope {
  if (!input.globalFlags.orgAlias) {
    throw new Error('inspect-quote-ready-product envelope requires a resolved org alias.');
  }

  const result = buildQuoteReadyProductResult(input.commandFlags, input.discoveryResult, input.catalogConfigResult);
  const status = buildEnvelopeStatus(result.readiness_status, input.discoveryResult, input.catalogConfigResult);
  const errors = [
    ...(input.discoveryResult?.errors ?? []),
    ...(input.catalogConfigResult?.errors ?? [])
  ];
  const warnings = [
    ...(input.discoveryResult?.warnings ?? []),
    ...(input.catalogConfigResult?.warnings ?? [])
  ];
  const evidence = [
    ...(input.discoveryResult?.evidence ?? []),
    ...(input.catalogConfigResult?.evidence ?? [])
  ];

  return makeEnvelope({
    command: 'inspect-quote-ready-product',
    status,
    summary: {
      primary_subject: result.selected_product_identity?.product_id ?? input.commandFlags.productId ?? input.commandFlags.terms.join(' '),
      status_reason: buildStatusReason(result),
      primary_lane: 'configured_quote_discovery',
      verification_anchor: input.commandFlags.pricebookId,
      next_suggested_command: result.next_commands[0] ?? null
    },
    result: toJsonRecord(result),
    warnings,
    errors,
    evidence,
    meta: {
      org_alias: input.globalFlags.orgAlias,
      generated_at: input.generatedAt ?? new Date().toISOString(),
      duration_ms: input.durationMs ?? 0,
      source_files: []
    }
  });
}

export function renderInspectQuoteReadyProductText(envelope: ResultEnvelope): string {
  const result = envelope.result as unknown as InspectQuoteReadyProductResult;
  const lines = [
    'quote-runtime inspect-quote-ready-product',
    `status: ${envelope.status}`,
    `readiness: ${result.readiness_status}`,
    `product: ${result.selected_product_identity?.product_name ?? result.product_match.selected_product_id ?? '(unresolved)'}`,
    `pricebook entry: ${result.pricebook_entry_id ?? '(none)'}`,
    `required attributes: ${result.required_attributes.length}`,
    `component groups: ${result.component_groups.length}`,
    `next: ${result.next_commands[0] ?? '(none)'}`
  ];

  if (result.product_match.candidates.length > 1) {
    lines.push('candidates:');
    lines.push(...result.product_match.candidates.map((candidate) => `- ${candidate.name} (${candidate.product_id}) pbe=${candidate.pricebook_entry_id ?? '(none)'}`));
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

const INSPECT_QUOTE_READY_PRODUCT_SPEC: EnvelopeCommandSpec<InspectQuoteReadyProductCommandDependencies> = {
  commandName: 'inspect-quote-ready-product',
  execute: async ({ argv, globalFlags, startedAt, deps }) => {
    const commandFlags = await parseInspectQuoteReadyProductFlags(argv);
    const runDiscovery = deps.executeDiscoverProducts ?? executeDiscoverProducts;
    const runCatalogConfig = deps.executeProductCatalogConfig ?? executeProductCatalogConfig;
    const discoveryResult = commandFlags.productId
      ? null
      : await runDiscovery({
        orgAlias: globalFlags.orgAlias!,
        pricebookId: commandFlags.pricebookId,
        terms: commandFlags.terms,
        catalogId: commandFlags.catalogId,
        accountId: commandFlags.accountId
      });
    const selectedProductId = commandFlags.productId ?? selectUnambiguousCandidate(discoveryResult)?.product_id ?? null;
    const catalogConfigResult = selectedProductId
      ? await runCatalogConfig({
        orgAlias: globalFlags.orgAlias!,
        productId: selectedProductId,
        pricebookId: commandFlags.pricebookId,
        catalogId: commandFlags.catalogId,
        accountId: commandFlags.accountId,
        productSellingModelId: commandFlags.productSellingModelId,
        includeRaw: commandFlags.includeRaw
      })
      : null;

    return buildInspectQuoteReadyProductEnvelope({
      globalFlags,
      commandFlags,
      discoveryResult,
      catalogConfigResult,
      durationMs: Math.max(0, Date.now() - startedAt)
    });
  },
  renderText: renderInspectQuoteReadyProductText
};

export async function runInspectQuoteReadyProductCommand(
  argv: string[],
  globalFlags: GlobalFlags,
  io: CliIo,
  dependencies: InspectQuoteReadyProductCommandDependencies = {}
): Promise<{ envelope: ResultEnvelope; text: string; exitCode: 0 | 1 }> {
  return runEnvelopeCommand(INSPECT_QUOTE_READY_PRODUCT_SPEC, argv, globalFlags, io, dependencies);
}

function buildQuoteReadyProductResult(
  commandFlags: InspectQuoteReadyProductCommandFlags,
  discoveryResult: ProductDiscoveryPrimitiveResult | null,
  catalogConfigResult: ProductCatalogConfigPrimitiveResult | null
): InspectQuoteReadyProductResult {
  const selectedCandidate = selectUnambiguousCandidate(discoveryResult);
  const catalog = catalogConfigResult?.result ?? null;
  const selectedProductId = commandFlags.productId ?? selectedCandidate?.product_id ?? null;
  const readiness = buildReadinessStatus(commandFlags, discoveryResult, catalogConfigResult);
  const componentGroups = catalog?.config_summary.component_groups ?? [];
  const requiredAttributes = catalog?.config_summary.required_attributes ?? [];

  return {
    readiness_status: readiness,
    product_match: {
      input_mode: commandFlags.productId ? 'product_id' : 'term',
      terms: commandFlags.terms,
      selected_product_id: selectedProductId,
      selected_candidate: selectedCandidate,
      candidates: discoveryResult?.result.candidates ?? [],
      omitted_count: discoveryResult?.result.omitted_count ?? 0,
      match_strategy: discoveryResult?.result.strategy ?? null
    },
    selected_product_identity: catalog?.product_identity ?? null,
    pricebook_entry_id: catalog?.product_identity.pricebook_entry_id ?? selectedCandidate?.pricebook_entry_id ?? null,
    required_attributes: requiredAttributes,
    optional_attributes: catalog?.config_summary.optional_attributes ?? [],
    component_groups: componentGroups,
    default_components: componentGroups.flatMap((group) =>
      group.child_options.filter((option) => option.default).map((option) => componentFact(group.name, option))
    ),
    required_components: componentGroups.flatMap((group) =>
      group.child_options.filter((option) => option.required).map((option) => componentFact(group.name, option))
    ),
    quote_intent_line_template: {
      pricebook_entry_id: catalog?.product_identity.pricebook_entry_id ?? selectedCandidate?.pricebook_entry_id ?? null,
      product_id: catalog?.product_identity.product_id ?? selectedProductId,
      quantity: 1,
      source: 'salesforce_catalog_facts'
    },
    config_choices_template: requiredAttributes.length > 0 || componentGroups.some((group) => (group.min_cardinality ?? 0) > 0)
      ? buildConfigChoicesTemplate(catalogConfigResult?.result ?? null)
      : null,
    next_commands: buildNextCommands(readiness, Boolean(catalog), commandFlags),
    ...(commandFlags.includeRaw && catalog?.raw_product_details_response !== undefined
      ? { raw_product_details_response: catalog.raw_product_details_response }
      : {})
  };
}

function buildReadinessStatus(
  commandFlags: InspectQuoteReadyProductCommandFlags,
  discoveryResult: ProductDiscoveryPrimitiveResult | null,
  catalogConfigResult: ProductCatalogConfigPrimitiveResult | null
): QuoteReadyProductReadinessStatus {
  if (discoveryResult?.status === 'unsupported' || catalogConfigResult?.status === 'unsupported') {
    return 'unsupported';
  }
  if (discoveryResult?.status === 'error' || catalogConfigResult?.status === 'error') {
    return 'blocked';
  }
  if (!commandFlags.productId && discoveryResult) {
    const usableCandidates = discoveryResult.result.candidates.filter((candidate) => candidate.usable);
    if (usableCandidates.length !== 1) {
      return usableCandidates.length > 1 ? 'ambiguous_product' : 'blocked';
    }
  }
  if (!catalogConfigResult) {
    return 'blocked';
  }
  if (
    catalogConfigResult.result.config_summary.required_attributes.length > 0 ||
    catalogConfigResult.result.config_summary.component_groups.some((group) => (group.min_cardinality ?? 0) > 0)
  ) {
    return 'needs_configuration';
  }
  return 'ready';
}

function buildEnvelopeStatus(
  readiness: QuoteReadyProductReadinessStatus,
  discoveryResult: ProductDiscoveryPrimitiveResult | null,
  catalogConfigResult: ProductCatalogConfigPrimitiveResult | null
): RuntimeStatus {
  if (readiness === 'unsupported') {
    return 'unsupported';
  }
  if (readiness === 'blocked') {
    return discoveryResult?.status === 'no_match' ? 'no_match' : 'error';
  }
  if (catalogConfigResult?.status === 'partial') {
    return 'partial';
  }
  return 'ok';
}

function buildStatusReason(result: InspectQuoteReadyProductResult): string {
  if (result.readiness_status === 'ambiguous_product') {
    return `Found ${result.product_match.candidates.length} product candidates; choose one product id before quote planning.`;
  }
  if (result.readiness_status === 'blocked') {
    return 'Product readiness is blocked before quote planning.';
  }
  if (result.readiness_status === 'unsupported') {
    return 'Product readiness inspection is unsupported in the current org/session.';
  }
  if (result.readiness_status === 'needs_configuration') {
    return 'Product can be quoted after explicit configuration choices are selected.';
  }
  return 'Product has enough catalog facts for a quote intent line template.';
}

function buildNextCommands(
  readiness: QuoteReadyProductReadinessStatus,
  hasCatalogConfig: boolean,
  commandFlags: InspectQuoteReadyProductCommandFlags
): string[] {
  if (readiness === 'ambiguous_product') {
    return [`inspect-quote-ready-product --org-alias <alias> --pricebook-id ${commandFlags.pricebookId} --product-id <candidate-product-id>`];
  }
  if (!hasCatalogConfig) {
    return [`discover-products --org-alias <alias> --pricebook-id ${commandFlags.pricebookId} --term <text>`];
  }
  if (readiness === 'needs_configuration') {
    return [
      'plan-product-config --org-alias <alias> --product-config product-config.json --choices choices.json',
      'apply-configured-quote --org-alias <alias> --quote-intent quote-intent.json --config-plan config-plan.json'
    ];
  }
  return [
    commandFlags.productId
      ? `build-test-quote --org-alias <alias> --input quote-intent.json # product_id=${commandFlags.productId}`
      : 'build-test-quote --org-alias <alias> --input quote-intent.json'
  ];
}

function buildConfigChoicesTemplate(catalog: ProductCatalogConfigResult | null): InspectQuoteReadyProductResult['config_choices_template'] {
  if (!catalog) {
    return null;
  }
  return {
    attributes: Object.fromEntries(catalog.config_summary.required_attributes.map((attribute) => [attribute.name, '<choose allowed value>'])),
    componentSelections: Object.fromEntries(
      catalog.config_summary.component_groups
        .filter((group) => (group.min_cardinality ?? 0) > 0)
        .map((group) => [group.name, ['<choose component product name or id>']])
    ),
    sources: {}
  };
}

function selectUnambiguousCandidate(discoveryResult: ProductDiscoveryPrimitiveResult | null): ProductDiscoveryCandidate | null {
  const usableCandidates = discoveryResult?.result.candidates.filter((candidate) => candidate.usable) ?? [];
  return usableCandidates.length === 1 ? usableCandidates[0] ?? null : null;
}

function componentFact(groupName: string, option: ProductCatalogConfigResult['config_summary']['component_groups'][number]['child_options'][number]): InspectQuoteReadyProductResult['default_components'][number] {
  return {
    group_name: groupName,
    product_id: option.product_id,
    product_name: option.product_name,
    product_code: option.product_code,
    related_component_id: option.related_component_id
  };
}

function toJsonRecord(value: unknown): Record<string, JsonValue> {
  return JSON.parse(JSON.stringify(value)) as Record<string, JsonValue>;
}

// ---------------------------------------------------------------------------
// CommandSpec (Q3: defineCommand consolidation)
// ---------------------------------------------------------------------------
import { defineCommand, WAVE_GROUP_NAMES } from './spec';

export const INSPECT_QUOTE_READY_PRODUCT_COMMAND_SPEC = defineCommand({
  name: 'inspect-quote-ready-product',
  wave: 3,
  group_name: WAVE_GROUP_NAMES[3],
  summary: 'Resolve quote-ready product facts and configuration templates from a product id or seller term.',
  ownership: {
        primary_owner: 'config-runtime-bridge',
        secondary_escalation: ['quote-runtime-mutations'],
        shared_library_dependencies: ['product_discovery', 'product_catalog_config', 'evidence']
  },
  selectorPolicy: {
        required_selectors: [],
        recommended_selectors: [],
        status_reason: 'Quote-ready product inspection requires a pricebook id plus either product id or product terms at command parse time.'
  },
    quickStart: 'quote-runtime inspect-quote-ready-product --org-alias <alias> --pricebook-id <id> --term "DR suite"',
  renderHelp: renderInspectQuoteReadyProductHelp,
  run: runInspectQuoteReadyProductCommand
});
