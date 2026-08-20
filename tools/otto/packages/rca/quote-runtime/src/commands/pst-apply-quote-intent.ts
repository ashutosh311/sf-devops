import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';

import { Flags, Parser } from '@oclif/core';

import type { GlobalFlags } from '../cli/global-flags';
import { emitJsonOutput, emitTextOutput, type CliIo } from '../cli/output';
import { runEnvelopeCommand, type EnvelopeCommandSpec } from '../cli/run-envelope-command';
import { exitCodeForStatus, makeEnvelope, type JsonValue, type ResultEnvelope } from '../contracts/result-envelope';
import { invokeSfJson, type InvokeSfJsonOptions, type SfCliJsonResult } from '../integrations/salesforce/sf-cli';
import { buildSoqlSelect, escapeSoqlStringLiteral, quoteSoqlId, quoteSoqlIds } from '../integrations/salesforce/soql';
import {
  buildQuoteGraphRecord,
  buildQuoteLineDeleteGraphRecord,
  buildQuoteLineGraphRecord,
  buildQuoteLineRelationshipDeleteGraphRecord,
  buildQuotePatchGraphRecord,
  executePstGraphMutation,
  type CatalogRatesPref,
  type ExecutePstGraphMutationInput,
  type MutationMode,
  type PstGraphRecord,
  type QuoteHeaderInput,
  type QuoteLineInput,
  type QuoteMutationPrimitiveResult
} from '../primitives/quote-mutations';
import {
  buildUsageRateChildRecords,
  resolveUsageRateSelectors,
  type UsageRateSelectorContext
} from '../primitives/usage-rate-selector-resolution';

export const PST_APPLY_QUOTE_INTENT_HELP_TEXT = [
  'quote-runtime pst-apply-quote-intent',
  '',
  'Usage:',
  '  quote-runtime pst-apply-quote-intent --org-alias <alias> --input <path> [--execute] [--write-artifact <path>]',
  '',
  'Notes:',
  '  Applies a quote-intent file through the PST graph mutation lane. Dry-run is default.',
  '  Supports create, append_lines, patch, and replace_lines target modes.',
  '  replace_lines requires an explicit managed line scope and emits planned deletes before execution.'
].join('\n');

const FLAGS = {
  input: Flags.string({ required: true }),
  execute: Flags.boolean({ allowNo: false }),
  'write-artifact': Flags.string({ required: false })
};

export type PstApplyQuoteIntentTargetMode = 'create' | 'append_lines' | 'patch' | 'replace_lines';
export type PstApplyQuoteIntentLineOperation = 'create' | 'patch' | 'delete';
export type PstApplyQuoteIntentLineScopeMode = 'explicit_line_ids' | 'explicit_product_set' | 'bundle_parent_line_id';

export type PstApplyQuoteIntentCommandFlags = {
  inputPath: string;
  mode: MutationMode;
  writeArtifactPath: string | null;
};

export type PstApplyQuoteIntentPayload = {
  plan_key?: string;
  target: {
    mode: PstApplyQuoteIntentTargetMode;
    quote_id?: string;
    allow_new_quote?: boolean;
    assertions?: {
      quote_number?: string;
      account_id?: string;
      account_name?: string;
      opportunity_id?: string;
      opportunity_name?: string;
      pricebook_id?: string;
    };
    line_scope?: {
      mode: PstApplyQuoteIntentLineScopeMode;
      line_ids?: string[];
      product_codes?: string[];
      bundle_parent_line_id?: string;
    };
  };
  quote?: Partial<QuoteHeaderInput> & {
    quote_account_id?: string;
    opportunity_id?: string;
    pricebook_id?: string;
    start_date?: string;
    expiration_date?: string;
  };
  header?: Partial<QuoteHeaderInput> & {
    quote_account_id?: string;
    opportunity_id?: string;
    pricebook_id?: string;
    start_date?: string;
    expiration_date?: string;
  };
  lines?: PstApplyQuoteIntentLine[];
  pst_plan?: {
    catalog_rates_pref?: CatalogRatesPref;
    catalogRatesPref?: CatalogRatesPref;
    quote_line_attributes?: PstGraphRecord[];
  };
  pricing?: {
    run?: boolean;
  };
  verification?: {
    commands?: string[];
  };
};

export type PstApplyQuoteIntentLine = Partial<QuoteLineInput> & {
  operation?: PstApplyQuoteIntentLineOperation;
  line_id?: string;
  product_id?: string;
  product_code?: string;
  pricebook_entry_id?: string;
  usage?: {
    usage_resource_id?: string;
    usage_resource_code?: string;
    rate_card_id?: string;
    rate_card_entry_id?: string;
    product_selling_model_id?: string;
    expected_rate?: number;
    rating_quantity?: number;
    unit_of_measure_id?: string;
    negotiated_rate?: number | null;
    negotiatedRate?: number | null;
    grants?: Array<{
      quote_line_usage_grant_id?: string;
      quoteLineUsageGrantId?: string;
      product_usage_grant_id?: string;
      productUsageGrantId?: string;
      product_usage_resource_policy_id?: string;
      productUsageResourcePolicyId?: string;
      usage_resource_id?: string;
      usageResourceId?: string;
      grant_type?: string;
      grantType?: string;
      grant_quantity?: number;
      grantQuantity?: number;
      validity_period_term?: number;
      validityPeriodTerm?: number;
      validity_period_unit?: string;
      validityPeriodUnit?: string;
    }>;
  };
  discount_percent?: number;
  discount_amount?: number;
  term?: {
    start_date?: string;
    end_date?: string;
  };
  configuration?: unknown;
};

export type PstApplyQuoteIntentResult = {
  target: {
    mode: PstApplyQuoteIntentTargetMode;
    quote_id: string | null;
    line_scope: PstApplyQuoteIntentPayload['target']['line_scope'] | null;
  };
  plan: {
    plan_key: string | null;
    plan_hash: string;
    mutation_mode: MutationMode;
    catalog_rates_pref: CatalogRatesPref | null;
    record_count: number;
    delete_count: number;
    relationship_delete_count: number;
    line_count: number;
    expected_verification_commands: string[];
    usage_rate_contexts: PstApplyQuoteIntentUsageRateContext[];
  };
  preflight: {
    target_quote_checked: boolean;
    target_assertions: PstApplyQuoteIntentPayload['target']['assertions'] | null;
    scoped_quote_line_ids: string[];
    scoped_relationship_ids: string[];
  };
  mutation: QuoteMutationPrimitiveResult['result'];
};

export type PstApplyQuoteIntentCommandDependencies = {
  executePstGraphMutation?: (input: ExecutePstGraphMutationInput) => Promise<QuoteMutationPrimitiveResult>;
  invokeSfJson?: <T>(options: InvokeSfJsonOptions) => Promise<SfCliJsonResult<T>>;
  writeFile?: (path: string, content: string) => void;
  mkdir?: (path: string) => void;
};

type QuoteQueryRow = {
  Id?: string;
  QuoteNumber?: string;
  QuoteAccountId?: string;
  QuoteAccount?: {
    Name?: string;
  };
  AccountId?: string;
  Account?: {
    Name?: string;
  };
  OpportunityId?: string;
  Opportunity?: {
    Name?: string;
  };
  Pricebook2Id?: string;
};

type QuoteLineScopeRow = {
  Id?: string;
  Product2Id?: string;
  Product2?: {
    ProductCode?: string;
    Name?: string;
  };
  ParentQuoteLineItemId?: string;
};

type QuoteLineRelationshipRow = {
  Id?: string;
};

type PricebookEntryRow = {
  Id?: string;
  Product2Id?: string;
  Product2?: {
    ProductCode?: string;
    Name?: string;
  };
};

export type PstApplyQuoteIntentUsageRateContext = UsageRateSelectorContext;

export function renderPstApplyQuoteIntentHelp(): string {
  return PST_APPLY_QUOTE_INTENT_HELP_TEXT;
}

export async function parsePstApplyQuoteIntentFlags(argv: string[]): Promise<PstApplyQuoteIntentCommandFlags> {
  const parsed = (await Parser.parse(argv, {
    args: {},
    enableJsonFlag: false,
    flags: FLAGS,
    strict: true
  })) as {
    flags: {
      input: string;
      execute?: boolean;
      'write-artifact'?: string;
    };
  };

  return {
    inputPath: parsed.flags.input,
    mode: parsed.flags.execute === true ? 'execute' : 'dry_run',
    writeArtifactPath: parsed.flags['write-artifact'] ?? null
  };
}

const PST_APPLY_QUOTE_INTENT_SPEC: EnvelopeCommandSpec<PstApplyQuoteIntentCommandDependencies> = {
  commandName: 'pst-apply-quote-intent',
  execute: async ({ argv, globalFlags, startedAt, deps }) => {
    const commandFlags = await parsePstApplyQuoteIntentFlags(argv);
    const payload = parseQuoteIntentPayload(commandFlags.inputPath);
    const plan = await buildPstApplyQuoteIntentPlan({
      orgAlias: globalFlags.orgAlias!,
      payload,
      mutationMode: commandFlags.mode,
      dependencies: deps
    });
    const primitive = await (deps.executePstGraphMutation ?? executePstGraphMutation)({
      orgAlias: globalFlags.orgAlias!,
      mode: commandFlags.mode,
      records: plan.records,
      catalogRatesPref: plan.catalogRatesPref,
      expectedVerificationCommands: plan.expectedVerificationCommands,
      ...(deps.invokeSfJson === undefined ? {} : { invokeSfJson: deps.invokeSfJson })
    });
    const result = buildPstApplyQuoteIntentResult(payload, commandFlags.mode, plan, primitive);
    const envelope = makeEnvelope({
      command: 'pst-apply-quote-intent',
      status: primitive.status,
      summary: {
        primary_subject: payload.target.quote_id ?? payload.quote?.name ?? commandFlags.inputPath,
        status_reason: commandFlags.mode === 'execute' ? 'Submitted quote intent through PST graph mutation.' : 'Validated quote intent PST graph dry-run.',
        primary_lane: 'configured_quote_mutation',
        verification_anchor: payload.target.quote_id ?? payload.target.assertions?.opportunity_id ?? null,
        next_suggested_command: plan.expectedVerificationCommands[0] ?? 'snapshot-quote',
        key_counts: {
          records: plan.records.length,
          deletes: plan.deleteLineIds.length,
          relationship_deletes: plan.deleteRelationshipIds.length,
          lines: payload.lines?.length ?? 0
        }
      },
      result: toJsonRecord(result),
      warnings: buildCommandWarnings(payload, commandFlags.mode, primitive.warnings),
      errors: primitive.errors,
      evidence: primitive.evidence,
      meta: {
        org_alias: globalFlags.orgAlias!,
        generated_at: new Date().toISOString(),
        duration_ms: Math.max(0, Date.now() - startedAt),
        source_files: [commandFlags.inputPath]
      }
    });

    if (commandFlags.writeArtifactPath) {
      writeApplyArtifact(commandFlags.writeArtifactPath, { envelope, payload, records: plan.records }, deps);
    }

    return envelope;
  },
  renderText: renderPstApplyQuoteIntentText
};

export async function runPstApplyQuoteIntentCommand(
  argv: string[],
  globalFlags: GlobalFlags,
  io: CliIo,
  dependencies: PstApplyQuoteIntentCommandDependencies = {}
): Promise<{ envelope: ResultEnvelope; text: string; exitCode: 0 | 1 }> {
  return runEnvelopeCommand(PST_APPLY_QUOTE_INTENT_SPEC, argv, globalFlags, io, dependencies);
}

export async function buildPstApplyQuoteIntentPlan(input: {
  orgAlias: string;
  payload: PstApplyQuoteIntentPayload;
  mutationMode: MutationMode;
  dependencies?: PstApplyQuoteIntentCommandDependencies;
}): Promise<{
  records: PstGraphRecord[];
  expectedVerificationCommands: string[];
  usageRateContexts: PstApplyQuoteIntentUsageRateContext[];
  catalogRatesPref: CatalogRatesPref | null;
  planHash: string;
  targetQuoteChecked: boolean;
  deleteLineIds: string[];
  deleteRelationshipIds: string[];
}> {
  validatePayloadShape(input.payload);
  validateDestructiveScope(input.payload);
  const resolvedPayload = await resolveProductReferences(input.orgAlias, input.payload, input.dependencies);
  const usageRateContexts = await resolveUsageRateSelectors({
    orgAlias: input.orgAlias,
    lines: resolvedPayload.lines ?? [],
    dependencies: input.dependencies
  });
  const catalogRatesPref = resolveCatalogRatesPref(resolvedPayload);
  await verifyTargetAssertions(input.orgAlias, resolvedPayload, input.dependencies);
  const deleteLineIds = await resolveScopedDeletes(input.orgAlias, resolvedPayload, input.dependencies);
  const deleteRelationshipIds = await resolveRelationshipDeletes(input.orgAlias, deleteLineIds, input.dependencies);
  const records = [
    ...deleteRelationshipIds.map((relationshipId, index) => buildQuoteLineRelationshipDeleteGraphRecord(relationshipId, index)),
    ...deleteLineIds.map((lineId, index) => buildQuoteLineDeleteGraphRecord(lineId, index)),
    ...buildQuoteAndLineRecords(resolvedPayload)
  ];
  const expectedVerificationCommands = buildExpectedVerificationCommands(resolvedPayload);

  return {
    records,
    expectedVerificationCommands,
    usageRateContexts,
    catalogRatesPref,
    planHash: hashJson({
      payload: resolvedPayload,
      records,
      usageRateContexts,
      catalogRatesPref,
      expectedVerificationCommands,
      mutationMode: input.mutationMode
    }),
    targetQuoteChecked: input.payload.target.mode !== 'create' || input.payload.target.assertions !== undefined,
    deleteLineIds,
    deleteRelationshipIds
  };
}

async function resolveProductReferences(
  orgAlias: string,
  payload: PstApplyQuoteIntentPayload,
  dependencies?: PstApplyQuoteIntentCommandDependencies
): Promise<PstApplyQuoteIntentPayload> {
  const lines = payload.lines ?? [];
  const unresolvedProductCodes = uniqueStrings(
    lines
      .filter((line) => (line.operation ?? 'create') === 'create')
      .filter((line) => line.product_code && !line.pricebook_entry_id && !line.pricebookEntryId)
      .map((line) => line.product_code)
  );

  if (unresolvedProductCodes.length === 0) {
    return payload;
  }

  const quote = payload.quote ?? payload.header;
  const pricebookId = quote?.pricebook2Id ?? quote?.pricebook_id ?? payload.target.assertions?.pricebook_id ?? null;
  if (!pricebookId) {
    throw new Error('Lines that use product_code without pricebook_entry_id require quote.pricebook_id, quote.pricebook2Id, or target.assertions.pricebook_id.');
  }

  const soql = buildSoqlSelect({
    objectName: 'PricebookEntry',
    fields: ['Id', 'Product2Id', 'Product2.ProductCode', 'Product2.Name'],
    where: `Pricebook2Id = ${quoteSoqlId(pricebookId)} AND IsActive = true AND Product2.ProductCode IN (${quoteSoqlStrings(unresolvedProductCodes)})`
  });
  const pricebookEntries = await runQuery<PricebookEntryRow>(orgAlias, soql, dependencies);
  const entryByCode = new Map(
    pricebookEntries
      .filter((entry) => entry.Product2?.ProductCode)
      .map((entry) => [entry.Product2?.ProductCode as string, entry])
  );
  const missingCodes = unresolvedProductCodes.filter((code) => !entryByCode.has(code));
  if (missingCodes.length > 0) {
    throw new Error(`No active PricebookEntry found for product code(s) in pricebook ${pricebookId}: ${missingCodes.join(', ')}.`);
  }

  return {
    ...payload,
    lines: lines.map((line) => {
      if ((line.operation ?? 'create') !== 'create' || !line.product_code || line.pricebook_entry_id || line.pricebookEntryId) {
        return line;
      }

      const entry = entryByCode.get(line.product_code);
      return {
        ...line,
        pricebook_entry_id: entry?.Id ?? line.pricebook_entry_id,
        product_id: entry?.Product2Id ?? line.product_id
      };
    })
  };
}

function buildQuoteAndLineRecords(payload: PstApplyQuoteIntentPayload): PstGraphRecord[] {
  const records: PstGraphRecord[] = [];
  const targetMode = payload.target.mode;

  if (targetMode === 'create') {
    records.push(buildQuoteGraphRecord(normalizeQuote(payload)));
  } else if (payload.target.quote_id) {
    records.push(buildQuotePatchGraphRecord(payload.target.quote_id));
  }

  const defaultQuoteId = targetMode === 'create' ? '@{quote1.id}' : payload.target.quote_id ?? null;
  const nonDeletedLines = (payload.lines ?? []).filter((line) => line.operation !== 'delete');
  records.push(
    ...nonDeletedLines.map((line, index) => buildQuoteLineGraphRecord(normalizeLine(line), defaultQuoteId, index))
  );
  records.push(
    ...buildUsageRateChildRecords(nonDeletedLines)
  );
  records.push(
    ...(payload.lines ?? [])
      .filter((line) => line.operation === 'delete')
      .map((line, index) => {
        const lineId = line.lineId ?? line.line_id;
        if (!lineId) {
          throw new Error('Line operation delete requires line_id.');
        }
        return buildQuoteLineDeleteGraphRecord(lineId, index);
      })
  );
  records.push(...(payload.pst_plan?.quote_line_attributes ?? []));

  return records;
}

async function verifyTargetAssertions(
  orgAlias: string,
  payload: PstApplyQuoteIntentPayload,
  dependencies?: PstApplyQuoteIntentCommandDependencies
): Promise<void> {
  if (payload.target.mode === 'create' && !payload.target.assertions) {
    return;
  }

  if (payload.target.mode === 'create' && payload.target.quote_id && payload.target.allow_new_quote !== true) {
    throw new Error('target.mode=create must not include target.quote_id unless target.allow_new_quote is true.');
  }

  if (payload.target.mode !== 'create' && !payload.target.quote_id) {
    throw new Error(`${payload.target.mode} requires target.quote_id.`);
  }

  if (!payload.target.quote_id) {
    return;
  }

  const soql = buildSoqlSelect({
    objectName: 'Quote',
    fields: [
      'Id',
      'QuoteNumber',
      'QuoteAccountId',
      'QuoteAccount.Name',
      'AccountId',
      'Account.Name',
      'OpportunityId',
      'Opportunity.Name',
      'Pricebook2Id'
    ],
    where: `Id = ${quoteSoqlId(payload.target.quote_id)}`,
    limit: 1
  });
  const rows = await runQuery<QuoteQueryRow>(orgAlias, soql, dependencies);
  const quote = rows[0];
  if (!quote) {
    throw new Error(`Target quote ${payload.target.quote_id} was not found.`);
  }

  const assertions = payload.target.assertions ?? {};
  assertTarget('quote_number', assertions.quote_number, quote.QuoteNumber);
  assertTarget('account_id', assertions.account_id, quote.QuoteAccountId ?? quote.AccountId);
  assertTarget('account_name', assertions.account_name, quote.QuoteAccount?.Name ?? quote.Account?.Name);
  assertTarget('opportunity_id', assertions.opportunity_id, quote.OpportunityId);
  assertTarget('opportunity_name', assertions.opportunity_name, quote.Opportunity?.Name);
  assertTarget('pricebook_id', assertions.pricebook_id, quote.Pricebook2Id);
}

async function resolveScopedDeletes(
  orgAlias: string,
  payload: PstApplyQuoteIntentPayload,
  dependencies?: PstApplyQuoteIntentCommandDependencies
): Promise<string[]> {
  if (payload.target.mode !== 'replace_lines') {
    return [];
  }

  const scope = payload.target.line_scope;
  if (!scope) {
    throw new Error('replace_lines requires target.line_scope so existing seller-curated lines are not deleted implicitly.');
  }

  if (scope.mode === 'explicit_line_ids') {
    const lineIds = scope.line_ids ?? [];
    if (lineIds.length === 0) {
      throw new Error('replace_lines explicit_line_ids scope requires at least one line id.');
    }
    return uniqueStrings(lineIds);
  }

  if (!payload.target.quote_id) {
    throw new Error(`replace_lines ${scope.mode} scope requires target.quote_id.`);
  }

  if (scope.mode === 'explicit_product_set') {
    const productCodes = scope.product_codes ?? [];
    if (productCodes.length === 0) {
      throw new Error('replace_lines explicit_product_set scope requires at least one product code.');
    }

    const soql = buildSoqlSelect({
      objectName: 'QuoteLineItem',
      fields: ['Id', 'Product2Id', 'Product2.ProductCode', 'Product2.Name', 'ParentQuoteLineItemId'],
      where: `QuoteId = ${quoteSoqlId(payload.target.quote_id)} AND Product2.ProductCode IN (${quoteSoqlStrings(productCodes)})`
    });
    return uniqueStrings((await runQuery<QuoteLineScopeRow>(orgAlias, soql, dependencies)).map((line) => line.Id));
  }

  if (!scope.bundle_parent_line_id) {
    throw new Error('replace_lines bundle_parent_line_id scope requires target.line_scope.bundle_parent_line_id.');
  }

  const soql = buildSoqlSelect({
    objectName: 'QuoteLineItem',
    fields: ['Id', 'Product2Id', 'Product2.ProductCode', 'Product2.Name', 'ParentQuoteLineItemId'],
    where: `QuoteId = ${quoteSoqlId(payload.target.quote_id)} AND (Id = ${quoteSoqlId(scope.bundle_parent_line_id)} OR ParentQuoteLineItemId = ${quoteSoqlId(scope.bundle_parent_line_id)})`
  });
  return uniqueStrings((await runQuery<QuoteLineScopeRow>(orgAlias, soql, dependencies)).map((line) => line.Id));
}

async function resolveRelationshipDeletes(
  orgAlias: string,
  lineIds: string[],
  dependencies?: PstApplyQuoteIntentCommandDependencies
): Promise<string[]> {
  if (lineIds.length === 0) {
    return [];
  }

  const soql = buildSoqlSelect({
    objectName: 'QuoteLineRelationship',
    fields: ['Id'],
    where: `MainQuoteLineId IN (${quoteSoqlIds(lineIds)}) OR AssociatedQuoteLineId IN (${quoteSoqlIds(lineIds)})`
  });
  return uniqueStrings((await runQuery<QuoteLineRelationshipRow>(orgAlias, soql, dependencies)).map((relationship) => relationship.Id));
}

async function runQuery<T>(
  orgAlias: string,
  soql: string,
  dependencies?: PstApplyQuoteIntentCommandDependencies
): Promise<T[]> {
  const executeSfJson = dependencies?.invokeSfJson ?? invokeSfJson;
  const result = await executeSfJson<{ records?: T[] }>({
    args: ['data', 'query', '--target-org', orgAlias, '--query', soql, '--json'],
    orgAlias
  });

  if (result.ok === false) {
    throw new Error(result.message);
  }

  return Array.isArray(result.data.records) ? result.data.records : [];
}

function normalizeQuote(payload: PstApplyQuoteIntentPayload): QuoteHeaderInput {
  const quote = payload.quote ?? payload.header;
  if (!quote?.name) {
    throw new Error('create mode requires quote.name.');
  }

  return {
    name: quote.name,
    quoteAccountId: quote.quoteAccountId ?? quote.quote_account_id ?? null,
    opportunityId: quote.opportunityId ?? quote.opportunity_id ?? null,
    pricebook2Id: quote.pricebook2Id ?? quote.pricebook_id ?? null,
    status: quote.status ?? null,
    startDate: quote.startDate ?? quote.start_date ?? null,
    expirationDate: quote.expirationDate ?? quote.expiration_date ?? null,
    salesTransactionTypeId: quote.salesTransactionTypeId ?? null,
    transactionType: quote.transactionType ?? null,
    extraFields: quote.extraFields
  };
}

function normalizeLine(line: PstApplyQuoteIntentLine): QuoteLineInput {
  return {
    lineId: line.lineId ?? line.line_id ?? null,
    pricebookEntryId: line.pricebookEntryId ?? line.pricebook_entry_id ?? null,
    product2Id: line.product2Id ?? line.product_id ?? null,
    quantity: line.quantity ?? 1,
    unitPrice: line.unitPrice ?? null,
    discount: line.discount ?? line.discount_percent ?? null,
    discountAmount: line.discountAmount ?? line.discount_amount ?? null,
    startDate: line.startDate ?? line.term?.start_date ?? null,
    endDate: line.endDate ?? line.term?.end_date ?? null,
    startQuantity: line.startQuantity ?? null,
    quoteActionId: line.quoteActionId ?? null,
    extraFields: line.extraFields
  };
}

function validatePayloadShape(payload: PstApplyQuoteIntentPayload): void {
  if (!payload.target?.mode) {
    throw new Error('quote intent requires target.mode.');
  }

  if (!['create', 'append_lines', 'patch', 'replace_lines'].includes(payload.target.mode)) {
    throw new Error(`Unsupported target.mode: ${payload.target.mode}`);
  }

  if (payload.target.mode !== 'create' && !payload.target.quote_id) {
    throw new Error(`${payload.target.mode} requires target.quote_id.`);
  }

  if ((payload.lines ?? []).some((line) => line.configuration !== undefined) && !payload.pst_plan?.quote_line_attributes) {
    throw new Error('Raw line.configuration choices require PST-ready pst_plan.quote_line_attributes from plan-product-config before mutation.');
  }

  const catalogRatesPref = payload.pst_plan?.catalog_rates_pref ?? payload.pst_plan?.catalogRatesPref;
  if (catalogRatesPref !== undefined && catalogRatesPref !== 'Fetch' && catalogRatesPref !== 'Skip') {
    throw new Error(`Unsupported pst_plan.catalog_rates_pref: ${catalogRatesPref}`);
  }

  for (const [lineIndex, line] of (payload.lines ?? []).entries()) {
    const grants = line.usage?.grants ?? [];
    for (const [grantIndex, grant] of grants.entries()) {
      const isPatch = Boolean(grant.quote_line_usage_grant_id ?? grant.quoteLineUsageGrantId);
      if (!isPatch && !(grant.product_usage_grant_id ?? grant.productUsageGrantId)) {
        throw new Error(`Line ${lineIndex + 1} usage grant ${grantIndex + 1} requires product_usage_grant_id.`);
      }
      if (!isPatch && !(grant.usage_resource_id ?? grant.usageResourceId ?? line.usage?.usage_resource_id)) {
        throw new Error(`Line ${lineIndex + 1} usage grant ${grantIndex + 1} requires usage_resource_id or line.usage.usage_resource_id.`);
      }
    }
  }
}

function validateDestructiveScope(payload: PstApplyQuoteIntentPayload): void {
  if (payload.target.mode !== 'replace_lines') {
    return;
  }

  if (!payload.target.line_scope) {
    throw new Error('replace_lines requires target.line_scope so existing seller-curated lines are not deleted implicitly.');
  }
}

function buildExpectedVerificationCommands(payload: PstApplyQuoteIntentPayload): string[] {
  const commands = new Set<string>(payload.verification?.commands ?? []);
  const hasUsageLines = (payload.lines ?? []).some((line) => line.usage !== undefined);
  commands.add('snapshot-quote');
  commands.add('snapshot-lines');
  commands.add('overlay-relationships');
  if (hasUsageLines) {
    commands.add('inspect-usage-rate-model');
    commands.add('inspect-pricing-product-sync');
    commands.add('refresh-decision-tables --decision-table-api-name <pricing/rating DecisionTable API name>');
  }
  if (payload.pricing?.run === true) {
    commands.add('price-quote');
    commands.add('capture-post-pst-evidence');
    commands.add('classify-pricing-outcome');
  }
  return [...commands];
}

function resolveCatalogRatesPref(payload: PstApplyQuoteIntentPayload): CatalogRatesPref | null {
  return payload.pst_plan?.catalog_rates_pref ?? payload.pst_plan?.catalogRatesPref ?? null;
}

function buildPstApplyQuoteIntentResult(
  payload: PstApplyQuoteIntentPayload,
  mutationMode: MutationMode,
  plan: Awaited<ReturnType<typeof buildPstApplyQuoteIntentPlan>>,
  primitive: QuoteMutationPrimitiveResult
): PstApplyQuoteIntentResult {
  return {
    target: {
      mode: payload.target.mode,
      quote_id: payload.target.quote_id ?? null,
      line_scope: payload.target.line_scope ?? null
    },
    plan: {
      plan_key: payload.plan_key ?? null,
      plan_hash: plan.planHash,
      mutation_mode: mutationMode,
      catalog_rates_pref: plan.catalogRatesPref,
      record_count: plan.records.length,
      delete_count: plan.deleteLineIds.length,
      relationship_delete_count: plan.deleteRelationshipIds.length,
      line_count: payload.lines?.length ?? 0,
      expected_verification_commands: plan.expectedVerificationCommands,
      usage_rate_contexts: plan.usageRateContexts
    },
    preflight: {
      target_quote_checked: plan.targetQuoteChecked,
      target_assertions: payload.target.assertions ?? null,
      scoped_quote_line_ids: plan.deleteLineIds,
      scoped_relationship_ids: plan.deleteRelationshipIds
    },
    mutation: primitive.result
  };
}

function buildCommandWarnings(
  payload: PstApplyQuoteIntentPayload,
  mode: MutationMode,
  primitiveWarnings: string[]
): string[] {
  const warnings = [...primitiveWarnings];

  if (payload.target.mode === 'replace_lines') {
    warnings.unshift('replace_lines deletes only the explicit managed scope resolved in preflight. It fails before execution when scope is missing.');
  }

  if (payload.pricing?.run === true && mode === 'dry_run') {
    warnings.push('pricing.run was requested but dry-run did not mutate or reprice. Execute, then use the expected verification commands.');
  }

  return warnings;
}

function renderPstApplyQuoteIntentText(envelope: ResultEnvelope): string {
  const result = envelope.result as unknown as PstApplyQuoteIntentResult;
  const lines = [
    'quote-runtime pst-apply-quote-intent',
    `status: ${envelope.status}`,
    `target mode: ${result.target.mode}`,
    `quote id: ${result.target.quote_id ?? '(new quote)'}`,
    `plan hash: ${result.plan.plan_hash}`,
    `records: ${result.plan.record_count}`,
    `deletes: ${result.plan.delete_count}`,
    `relationship deletes: ${result.plan.relationship_delete_count}`,
    `next: ${result.plan.expected_verification_commands[0] ?? '(none)'}`
  ];

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

function parseQuoteIntentPayload(path: string): PstApplyQuoteIntentPayload {
  const parsed = JSON.parse(readFileSync(path, 'utf8')) as unknown;
  if (isRecord(parsed) && isRecord(parsed.quote_intent)) {
    return parsed.quote_intent as PstApplyQuoteIntentPayload;
  }
  return parsed as PstApplyQuoteIntentPayload;
}

function writeApplyArtifact(
  path: string,
  payload: unknown,
  dependencies: PstApplyQuoteIntentCommandDependencies
): void {
  (dependencies.mkdir ?? ((dirPath: string) => mkdirSync(dirPath, { recursive: true })))(dirname(path));
  (dependencies.writeFile ?? ((filePath: string, content: string) => writeFileSync(filePath, content, 'utf8')))(
    path,
    `${JSON.stringify(payload, null, 2)}\n`
  );
}

function assertTarget(label: string, expected: string | undefined, actual: string | undefined): void {
  if (expected && expected !== actual) {
    throw new Error(`Target assertion failed for ${label}: expected ${expected}, got ${actual ?? 'null'}.`);
  }
}

function hashJson(value: unknown): string {
  return createHash('sha256').update(JSON.stringify(sortJson(value))).digest('hex');
}

function sortJson(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map((item) => sortJson(item));
  }

  if (typeof value === 'object' && value !== null) {
    return Object.fromEntries(Object.entries(value).sort(([left], [right]) => left.localeCompare(right)).map(([key, child]) => [key, sortJson(child)]));
  }

  return value;
}

function quoteSoqlStrings(values: string[]): string {
  return values.map((value) => `'${escapeSoqlStringLiteral(value)}'`).join(', ');
}

function uniqueStrings(values: Array<string | null | undefined>): string[] {
  return [...new Set(values.filter((value): value is string => typeof value === 'string' && value.length > 0))];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function toJsonRecord(value: unknown): Record<string, JsonValue> {
  return JSON.parse(JSON.stringify(value)) as Record<string, JsonValue>;
}

// ---------------------------------------------------------------------------
// CommandSpec (Q3: defineCommand consolidation)
// ---------------------------------------------------------------------------
import { defineCommand, WAVE_GROUP_NAMES } from './spec';

export const PST_APPLY_QUOTE_INTENT_COMMAND_SPEC = defineCommand({
  name: 'pst-apply-quote-intent',
  wave: 3,
  group_name: WAVE_GROUP_NAMES[3],
  summary: 'Apply a scoped quote-intent file through the PST graph lane with dry-run, idempotency hash, and replace-line safeguards.',
  ownership: {
        primary_owner: 'quote-runtime-mutations',
        secondary_escalation: ['config-runtime-bridge', 'pricing-runtime-debug'],
        shared_library_dependencies: ['quote_mutations', 'selectors', 'evidence']
  },
  selectorPolicy: {
        required_selectors: [],
        recommended_selectors: [],
        status_reason: 'PST quote-intent apply reads target, line scope, and quote changes from one structured input file.'
  },
    quickStart: 'quote-runtime pst-apply-quote-intent --org-alias <alias> --input quote-intent.json',
  renderHelp: renderPstApplyQuoteIntentHelp,
  run: runPstApplyQuoteIntentCommand
});
