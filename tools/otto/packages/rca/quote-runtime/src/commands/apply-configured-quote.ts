import { readFileSync } from 'node:fs';

import { Flags, Parser } from '@oclif/core';

import type { GlobalFlags } from '../cli/global-flags';
import { emitJsonOutput, emitTextOutput, type CliIo } from '../cli/output';
import { runEnvelopeCommand, type EnvelopeCommandSpec } from '../cli/run-envelope-command';
import { exitCodeForStatus, makeEnvelope, type JsonValue, type ResultEnvelope } from '../contracts/result-envelope';
import {
  buildQuoteGraphRecord,
  buildQuoteLineGraphRecord,
  executePstGraphMutation,
  type ExecutePstGraphMutationInput,
  type MutationMode,
  type PstGraphRecord,
  type QuoteHeaderInput,
  type QuoteLineInput,
  type QuoteMutationPrimitiveResult
} from '../primitives/quote-mutations';

export const APPLY_CONFIGURED_QUOTE_HELP_TEXT = [
  'quote-runtime apply-configured-quote',
  '',
  'Usage:',
  '  quote-runtime apply-configured-quote --org-alias <alias> --quote-intent <path> --config-plan <path> [--execute]',
  '',
  'Notes:',
  '  Builds a PST graph from approved quote intent and deterministic product-config plan. Dry-run is default.',
  '  This command creates a new configured quote. Use pst-apply-quote-intent for existing-quote patch or replace workflows.'
].join('\n');

const CREATES_NEW_QUOTE_WARNING = 'apply-configured-quote creates a new configured quote. Do not use it to patch an existing target quote; use pst-apply-quote-intent when existing-quote mutation is required.';

const FLAGS = {
  'quote-intent': Flags.string({ required: true }),
  'config-plan': Flags.string({ required: true }),
  execute: Flags.boolean({ allowNo: false })
};

export type ApplyConfiguredQuoteCommandDependencies = {
  executePstGraphMutation?: (input: ExecutePstGraphMutationInput) => Promise<QuoteMutationPrimitiveResult>;
};

type QuoteIntentPayload = {
  account_id?: string;
  opportunity_id?: string;
  pricebook_id?: string;
  quote?: Partial<QuoteHeaderInput> & {
    quote_account_id?: string;
    opportunity_id?: string;
    pricebook_id?: string;
    start_date?: string;
    expiration_date?: string;
  };
  lines?: (Partial<QuoteLineInput> & {
    product_id?: string;
    pricebook_entry_id?: string;
  })[];
};

type ConfigPlanPayload = {
  pst_plan?: {
    quote_line_attributes?: PstGraphRecord[];
  };
};

export function renderApplyConfiguredQuoteHelp(): string {
  return APPLY_CONFIGURED_QUOTE_HELP_TEXT;
}

export async function parseApplyConfiguredQuoteFlags(argv: string[]): Promise<{
  quoteIntentPath: string;
  configPlanPath: string;
  mode: MutationMode;
}> {
  const parsed = (await Parser.parse(argv, {
    args: {},
    enableJsonFlag: false,
    flags: FLAGS,
    strict: true
  })) as {
    flags: {
      'quote-intent': string;
      'config-plan': string;
      execute?: boolean;
    };
  };
  return {
    quoteIntentPath: parsed.flags['quote-intent'],
    configPlanPath: parsed.flags['config-plan'],
    mode: parsed.flags.execute === true ? 'execute' : 'dry_run'
  };
}

const APPLY_CONFIGURED_QUOTE_SPEC: EnvelopeCommandSpec<ApplyConfiguredQuoteCommandDependencies> = {
  commandName: 'apply-configured-quote',
  execute: async ({ argv, globalFlags, startedAt, deps }) => {
    const commandFlags = await parseApplyConfiguredQuoteFlags(argv);
    const records = buildConfiguredQuoteRecords(
      parseQuoteIntent(commandFlags.quoteIntentPath),
      parseConfigPlan(commandFlags.configPlanPath)
    );
    const primitive = await (deps.executePstGraphMutation ?? executePstGraphMutation)({
      orgAlias: globalFlags.orgAlias!,
      mode: commandFlags.mode,
      records,
      expectedVerificationCommands: ['validate-product-config', 'snapshot-quote', 'snapshot-lines', 'overlay-relationships', 'price-quote']
    });
    return makeEnvelope({
      command: 'apply-configured-quote',
      status: primitive.status,
      summary: {
        primary_subject: commandFlags.quoteIntentPath,
        status_reason: commandFlags.mode === 'execute' ? 'Submitted configured quote PST graph.' : 'Validated configured quote PST graph dry-run.',
        primary_lane: 'configured_quote_mutation',
        next_suggested_command: 'validate-product-config'
      },
      result: toJsonRecord(primitive.result),
      warnings: [CREATES_NEW_QUOTE_WARNING, ...primitive.warnings],
      errors: primitive.errors,
      evidence: primitive.evidence,
      meta: {
        org_alias: globalFlags.orgAlias!,
        generated_at: new Date().toISOString(),
        duration_ms: Math.max(0, Date.now() - startedAt),
        source_files: [commandFlags.quoteIntentPath, commandFlags.configPlanPath]
      }
    });
  },
  renderText: (envelope) =>
    `quote-runtime apply-configured-quote\nstatus: ${envelope.status}\nreason: ${String(envelope.summary.status_reason ?? '')}`
};

export async function runApplyConfiguredQuoteCommand(
  argv: string[],
  globalFlags: GlobalFlags,
  io: CliIo,
  dependencies: ApplyConfiguredQuoteCommandDependencies = {}
): Promise<{ envelope: ResultEnvelope; text: string; exitCode: 0 | 1 }> {
  return runEnvelopeCommand(APPLY_CONFIGURED_QUOTE_SPEC, argv, globalFlags, io, dependencies);
}

export function buildConfiguredQuoteRecords(quoteIntent: QuoteIntentPayload, configPlan: ConfigPlanPayload): PstGraphRecord[] {
  const quote = normalizeQuote(quoteIntent);
  const lines = (quoteIntent.lines ?? []).map((line, index) => buildQuoteLineGraphRecord(normalizeLine(line), '@{quote1.id}', index));
  return [
    buildQuoteGraphRecord(quote),
    ...lines,
    ...(configPlan.pst_plan?.quote_line_attributes ?? [])
  ];
}

function parseQuoteIntent(path: string): QuoteIntentPayload {
  return JSON.parse(readFileSync(path, 'utf8')) as QuoteIntentPayload;
}

function parseConfigPlan(path: string): ConfigPlanPayload {
  return normalizeConfigPlanArtifact(JSON.parse(readFileSync(path, 'utf8')));
}

function normalizeQuote(payload: QuoteIntentPayload): QuoteHeaderInput {
  if (!payload.quote?.name) {
    throw new Error('quote-intent requires quote.name.');
  }
  return {
    name: payload.quote.name,
    quoteAccountId: payload.quote.quoteAccountId ?? payload.quote.quote_account_id ?? payload.account_id ?? null,
    opportunityId: payload.quote.opportunityId ?? payload.quote.opportunity_id ?? payload.opportunity_id ?? null,
    pricebook2Id: payload.quote.pricebook2Id ?? payload.quote.pricebook_id ?? payload.pricebook_id ?? null,
    status: payload.quote.status ?? null,
    startDate: payload.quote.startDate ?? payload.quote.start_date ?? null,
    expirationDate: payload.quote.expirationDate ?? payload.quote.expiration_date ?? null,
    salesTransactionTypeId: payload.quote.salesTransactionTypeId ?? null,
    transactionType: payload.quote.transactionType ?? null,
    extraFields: payload.quote.extraFields
  };
}

function normalizeLine(line: Partial<QuoteLineInput> & { product_id?: string; pricebook_entry_id?: string }): QuoteLineInput {
  return {
    pricebookEntryId: line.pricebookEntryId ?? line.pricebook_entry_id ?? null,
    product2Id: line.product2Id ?? line.product_id ?? null,
    quantity: line.quantity ?? 1,
    unitPrice: line.unitPrice ?? null,
    discount: line.discount ?? null,
    discountAmount: line.discountAmount ?? null,
    startDate: line.startDate ?? null,
    endDate: line.endDate ?? null,
    startQuantity: line.startQuantity ?? null,
    quoteActionId: line.quoteActionId ?? null,
    extraFields: line.extraFields
  };
}

function toJsonRecord(value: unknown): Record<string, JsonValue> {
  return JSON.parse(JSON.stringify(value)) as Record<string, JsonValue>;
}

function normalizeConfigPlanArtifact(value: unknown): ConfigPlanPayload {
  if (isRecord(value) && isConfigPlanPayload(value)) {
    return value;
  }
  if (isRecord(value) && isRecord(value.result) && isConfigPlanPayload(value.result)) {
    return value.result;
  }
  throw new Error('config-plan must be a config plan object or a quote-runtime plan-product-config envelope.');
}

function isConfigPlanPayload(value: Record<string, unknown>): value is ConfigPlanPayload {
  return isRecord(value.pst_plan) && Array.isArray(value.pst_plan.quote_line_attributes);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

// ---------------------------------------------------------------------------
// CommandSpec (Q3: defineCommand consolidation)
// ---------------------------------------------------------------------------
import { defineCommand, WAVE_GROUP_NAMES } from './spec';

export const APPLY_CONFIGURED_QUOTE_COMMAND_SPEC = defineCommand({
  name: 'apply-configured-quote',
  wave: 3,
  group_name: WAVE_GROUP_NAMES[3],
  summary: 'Build and optionally execute a configured quote PST graph from approved plan files.',
  ownership: {
        primary_owner: 'quote-runtime-mutations',
        secondary_escalation: ['config-runtime-bridge', 'pricing-runtime-debug'],
        shared_library_dependencies: ['quote_mutations', 'evidence']
  },
  selectorPolicy: {
        required_selectors: [],
        recommended_selectors: [],
        status_reason: 'Configured quote apply reads approved quote intent and config plan files.'
  },
    quickStart: 'quote-runtime apply-configured-quote --org-alias <alias> --quote-intent quote-intent.json --config-plan config-plan.json',
  renderHelp: renderApplyConfiguredQuoteHelp,
  run: runApplyConfiguredQuoteCommand
});
