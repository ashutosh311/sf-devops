import { readFileSync } from 'node:fs';

import { Flags, Parser } from '@oclif/core';

import type { GlobalFlags } from '../cli/global-flags';
import { emitJsonOutput, emitTextOutput, type CliIo } from '../cli/output';
import { runEnvelopeCommand, type EnvelopeCommandSpec } from '../cli/run-envelope-command';
import { exitCodeForStatus, makeEnvelope, type ResultEnvelope } from '../contracts/result-envelope';
import {
  executeBuildTestQuote,
  type ExecuteBuildTestQuoteInput,
  type MutationMode,
  type QuoteHeaderInput,
  type QuoteLineInput,
  type QuoteMutationPrimitiveResult
} from '../primitives/quote-mutations';
import { buildMutationStatusReason, mutationResultToJsonRecord, renderMutationText } from './create-quote';

export const BUILD_TEST_QUOTE_HELP_TEXT = [
  'quote-runtime build-test-quote',
  '',
  'Usage:',
  '  quote-runtime build-test-quote --org-alias <alias> --input <path> [--execute]',
  '',
  'Input JSON shape:',
  '  { "quote": { ... }, "lines": [ ... ], "pricing": { "execute": true } }',
  '',
  'Notes:',
  '  build-test-quote validates a structured quote_intent payload and emits one PST graph plan.',
  '  Dry-run is the default. Use --execute for writes.'
].join('\n');

const BUILD_TEST_QUOTE_FLAG_DEFINITIONS = {
  input: Flags.string({ required: true, helpValue: '<path>', summary: 'Path to quote_intent JSON.' }),
  execute: Flags.boolean({ allowNo: false, summary: 'Submit the PST graph request.' })
};

export type BuildTestQuoteCommandFlags = {
  mode: MutationMode;
  inputPath: string;
  quote: QuoteHeaderInput;
  lines: QuoteLineInput[];
  price: boolean;
};

export type BuildTestQuoteCommandDependencies = {
  executeBuildTestQuote?: (input: ExecuteBuildTestQuoteInput) => Promise<QuoteMutationPrimitiveResult>;
};

type BuildTestQuotePayload = {
  account_id?: string;
  opportunity_id?: string;
  pricebook_id?: string;
  quote?: Partial<QuoteHeaderInput> & {
    expiration_date?: string;
    pricebook_id?: string;
    quote_account_id?: string;
    opportunity_id?: string;
    sales_transaction_type_id?: string;
    start_date?: string;
    transaction_type?: string;
  };
  lines?: (Partial<QuoteLineInput> & {
    line_id?: string;
    quote_id?: string;
    pricebook_entry_id?: string;
    product_id?: string;
    unit_price?: number;
    discount_amount?: number;
    start_date?: string;
    end_date?: string;
    start_quantity?: number;
  })[];
  pricing?: {
    execute?: boolean;
  };
};

export function renderBuildTestQuoteHelp(): string {
  return BUILD_TEST_QUOTE_HELP_TEXT;
}

export async function parseBuildTestQuoteFlags(argv: string[]): Promise<BuildTestQuoteCommandFlags> {
  const parsed = (await Parser.parse(argv, {
    args: {},
    enableJsonFlag: false,
    flags: BUILD_TEST_QUOTE_FLAG_DEFINITIONS,
    strict: true
  })) as {
    flags: {
      input: string;
      execute?: boolean;
    };
  };
  const payload = parseBuildTestQuotePayload(readFileSync(parsed.flags.input, 'utf8'));

  return {
    mode: parsed.flags.execute === true ? 'execute' : 'dry_run',
    inputPath: parsed.flags.input,
    quote: normalizeQuotePayload(payload),
    lines: normalizeLinePayloads(payload),
    price: payload.pricing?.execute === true
  };
}

export function buildBuildTestQuoteEnvelope(input: {
  globalFlags: GlobalFlags;
  commandFlags: BuildTestQuoteCommandFlags;
  primitiveResult: QuoteMutationPrimitiveResult;
  generatedAt?: string;
  durationMs?: number;
}): ResultEnvelope {
  if (!input.globalFlags.orgAlias) {
    throw new Error('build-test-quote envelope requires a resolved org alias.');
  }

  return makeEnvelope({
    command: 'build-test-quote',
    status: input.primitiveResult.status,
    summary: {
      primary_subject: input.commandFlags.quote.name,
      status_reason: buildMutationStatusReason('build-test-quote', input.commandFlags.mode, input.primitiveResult),
      primary_lane: 'quote_runtime_mutation',
      verification_anchor: input.commandFlags.quote.name,
      next_suggested_command: 'snapshot-quote'
    },
    result: mutationResultToJsonRecord(input.primitiveResult.result),
    warnings: input.primitiveResult.warnings,
    errors: input.primitiveResult.errors,
    evidence: input.primitiveResult.evidence,
    meta: {
      org_alias: input.globalFlags.orgAlias,
      generated_at: input.generatedAt ?? new Date().toISOString(),
      duration_ms: input.durationMs ?? 0,
      source_files: [input.commandFlags.inputPath]
    }
  });
}

const BUILD_TEST_QUOTE_SPEC: EnvelopeCommandSpec<BuildTestQuoteCommandDependencies> = {
  commandName: 'build-test-quote',
  execute: async ({ argv, globalFlags, startedAt, deps }) => {
    const commandFlags = await parseBuildTestQuoteFlags(argv);
    const runPrimitive = deps.executeBuildTestQuote ?? executeBuildTestQuote;
    const primitiveResult = await runPrimitive({
      orgAlias: globalFlags.orgAlias!,
      mode: commandFlags.mode,
      quote: commandFlags.quote,
      lines: commandFlags.lines,
      price: commandFlags.price
    });
    return buildBuildTestQuoteEnvelope({
      globalFlags,
      commandFlags,
      primitiveResult,
      durationMs: Math.max(0, Date.now() - startedAt)
    });
  },
  renderText: (envelope) => renderMutationText('quote-runtime build-test-quote', envelope)
};

export async function runBuildTestQuoteCommand(
  argv: string[],
  globalFlags: GlobalFlags,
  io: CliIo,
  dependencies: BuildTestQuoteCommandDependencies = {}
): Promise<{ envelope: ResultEnvelope; text: string; exitCode: 0 | 1 }> {
  return runEnvelopeCommand(BUILD_TEST_QUOTE_SPEC, argv, globalFlags, io, dependencies);
}

function parseBuildTestQuotePayload(contents: string): BuildTestQuotePayload {
  const parsed = JSON.parse(contents) as unknown;
  if (!isRecord(parsed)) {
    throw new Error('build-test-quote input must be a JSON object.');
  }
  return parsed as BuildTestQuotePayload;
}

function normalizeQuotePayload(payload: BuildTestQuotePayload): QuoteHeaderInput {
  if (!payload.quote?.name) {
    throw new Error('build-test-quote input requires quote.name.');
  }
  return {
    name: payload.quote.name,
    quoteAccountId: payload.quote.quoteAccountId ?? payload.quote.quote_account_id ?? payload.account_id ?? null,
    opportunityId: payload.quote.opportunityId ?? payload.quote.opportunity_id ?? payload.opportunity_id ?? null,
    pricebook2Id: payload.quote.pricebook2Id ?? payload.quote.pricebook_id ?? payload.pricebook_id ?? null,
    status: payload.quote.status ?? null,
    startDate: payload.quote.startDate ?? payload.quote.start_date ?? null,
    expirationDate: payload.quote.expirationDate ?? payload.quote.expiration_date ?? null,
    salesTransactionTypeId: payload.quote.salesTransactionTypeId ?? payload.quote.sales_transaction_type_id ?? null,
    transactionType: payload.quote.transactionType ?? payload.quote.transaction_type ?? null,
    extraFields: payload.quote.extraFields
  };
}

function normalizeLinePayloads(payload: BuildTestQuotePayload): QuoteLineInput[] {
  return (payload.lines ?? []).map((line) => ({
    lineId: line.lineId ?? line.line_id ?? null,
    quoteId: line.quoteId ?? line.quote_id ?? null,
    pricebookEntryId: line.pricebookEntryId ?? line.pricebook_entry_id ?? null,
    product2Id: line.product2Id ?? line.product_id ?? null,
    quantity: line.quantity ?? null,
    unitPrice: line.unitPrice ?? line.unit_price ?? null,
    discount: line.discount ?? null,
    discountAmount: line.discountAmount ?? line.discount_amount ?? null,
    startDate: line.startDate ?? line.start_date ?? null,
    endDate: line.endDate ?? line.end_date ?? null,
    startQuantity: line.startQuantity ?? line.start_quantity ?? null,
    quoteActionId: line.quoteActionId ?? null,
    extraFields: line.extraFields
  }));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

// ---------------------------------------------------------------------------
// CommandSpec (Q3: defineCommand consolidation)
// ---------------------------------------------------------------------------
import { defineCommand, WAVE_GROUP_NAMES } from './spec';

export const BUILD_TEST_QUOTE_COMMAND_SPEC = defineCommand({
  name: 'build-test-quote',
  wave: 3,
  group_name: WAVE_GROUP_NAMES[3],
  summary: 'Build a controlled test quote from a structured quote_intent payload.',
  ownership: {
        primary_owner: 'quote-runtime-mutations',
        secondary_escalation: ['pricing-runtime-debug'],
        shared_library_dependencies: ['quote_mutations', 'selectors', 'evidence']
  },
  selectorPolicy: {
        required_selectors: [],
        recommended_selectors: [],
        status_reason: 'Build-test-quote reads selectors from a structured quote_intent input payload.'
  },
    quickStart: 'quote-runtime build-test-quote --org-alias <alias> --input quote-intent.json',
  renderHelp: renderBuildTestQuoteHelp,
  run: runBuildTestQuoteCommand
});
