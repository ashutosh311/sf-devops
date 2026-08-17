import { Flags, Parser } from '@oclif/core';

import type { GlobalFlags } from '../cli/global-flags';
import { emitJsonOutput, emitTextOutput, type CliIo } from '../cli/output';
import { runEnvelopeCommand, type EnvelopeCommandSpec } from '../cli/run-envelope-command';
import { exitCodeForStatus, makeEnvelope, type ResultEnvelope } from '../contracts/result-envelope';
import {
  executeUpsertQuoteLines,
  type ExecuteUpsertQuoteLinesInput,
  type MutationMode,
  type QuoteLineInput,
  type QuoteMutationPrimitiveResult
} from '../primitives/quote-mutations';
import {
  buildMutationStatusReason,
  mutationResultToJsonRecord,
  parseFieldAssignments,
  renderMutationText
} from './create-quote';

export const UPSERT_QUOTE_LINES_HELP_TEXT = [
  'quote-runtime upsert-quote-lines',
  '',
  'Usage:',
  '  quote-runtime upsert-quote-lines --org-alias <alias> --quote-id <id> [--line-id <id>] --pricebook-entry-id <id> --product-id <id> --quantity <number> [--execute]',
  '',
  'Notes:',
  '  Omit --line-id to POST a new QuoteLineItem. Provide --line-id to PATCH an existing line.',
  '  Dry-run is the default. Use --execute for writes.'
].join('\n');

const UPSERT_QUOTE_LINES_FLAG_DEFINITIONS = {
  'quote-id': Flags.string({ required: true, helpValue: '<id>', summary: 'Target QuoteId.' }),
  'line-id': Flags.string({ required: false, helpValue: '<id>', summary: 'Existing QuoteLineItem id for PATCH.' }),
  'pricebook-entry-id': Flags.string({ required: false, helpValue: '<id>', summary: 'PricebookEntryId for line POST.' }),
  'product-id': Flags.string({ required: false, helpValue: '<id>', summary: 'Product2Id for line POST.' }),
  quantity: Flags.string({ required: false, helpValue: '<number>', summary: 'Quote line quantity.' }),
  'unit-price': Flags.string({ required: false, helpValue: '<number>', summary: 'Optional UnitPrice.' }),
  discount: Flags.string({ required: false, helpValue: '<number>', summary: 'Optional Discount percent.' }),
  'discount-amount': Flags.string({ required: false, helpValue: '<number>', summary: 'Optional DiscountAmount.' }),
  'start-date': Flags.string({ required: false, helpValue: '<date>', summary: 'Optional StartDate.' }),
  'end-date': Flags.string({ required: false, helpValue: '<date>', summary: 'Optional EndDate.' }),
  'start-quantity': Flags.string({ required: false, helpValue: '<number>', summary: 'Optional StartQuantity.' }),
  field: Flags.string({ multiple: true, helpValue: '<Name=value>', summary: 'Additional metadata-gated QuoteLineItem field.' }),
  execute: Flags.boolean({ allowNo: false, summary: 'Submit the PST graph request.' })
};

export type UpsertQuoteLinesCommandFlags = {
  mode: MutationMode;
  quoteId: string;
  line: QuoteLineInput;
};

export type UpsertQuoteLinesCommandDependencies = {
  executeUpsertQuoteLines?: (input: ExecuteUpsertQuoteLinesInput) => Promise<QuoteMutationPrimitiveResult>;
};

export function renderUpsertQuoteLinesHelp(): string {
  return UPSERT_QUOTE_LINES_HELP_TEXT;
}

export async function parseUpsertQuoteLinesFlags(argv: string[]): Promise<UpsertQuoteLinesCommandFlags> {
  const parsed = (await Parser.parse(argv, {
    args: {},
    enableJsonFlag: false,
    flags: UPSERT_QUOTE_LINES_FLAG_DEFINITIONS,
    strict: true
  })) as {
    flags: {
      'quote-id': string;
      'line-id'?: string;
      'pricebook-entry-id'?: string;
      'product-id'?: string;
      quantity?: string;
      'unit-price'?: string;
      discount?: string;
      'discount-amount'?: string;
      'start-date'?: string;
      'end-date'?: string;
      'start-quantity'?: string;
      field?: string[];
      execute?: boolean;
    };
  };

  return {
    mode: parsed.flags.execute === true ? 'execute' : 'dry_run',
    quoteId: parsed.flags['quote-id'],
    line: {
      lineId: parsed.flags['line-id'] ?? null,
      pricebookEntryId: parsed.flags['pricebook-entry-id'] ?? null,
      product2Id: parsed.flags['product-id'] ?? null,
      quantity: parseOptionalNumber(parsed.flags.quantity, 'quantity'),
      unitPrice: parseOptionalNumber(parsed.flags['unit-price'], 'unit-price'),
      discount: parseOptionalNumber(parsed.flags.discount, 'discount'),
      discountAmount: parseOptionalNumber(parsed.flags['discount-amount'], 'discount-amount'),
      startDate: parsed.flags['start-date'] ?? null,
      endDate: parsed.flags['end-date'] ?? null,
      startQuantity: parseOptionalNumber(parsed.flags['start-quantity'], 'start-quantity'),
      extraFields: parseFieldAssignments(parsed.flags.field ?? [])
    }
  };
}

export function buildUpsertQuoteLinesEnvelope(input: {
  globalFlags: GlobalFlags;
  commandFlags: UpsertQuoteLinesCommandFlags;
  primitiveResult: QuoteMutationPrimitiveResult;
  generatedAt?: string;
  durationMs?: number;
}): ResultEnvelope {
  if (!input.globalFlags.orgAlias) {
    throw new Error('upsert-quote-lines envelope requires a resolved org alias.');
  }

  return makeEnvelope({
    command: 'upsert-quote-lines',
    status: input.primitiveResult.status,
    summary: {
      primary_subject: input.commandFlags.quoteId,
      status_reason: buildMutationStatusReason('upsert-quote-lines', input.commandFlags.mode, input.primitiveResult),
      primary_lane: 'quote_runtime_mutation',
      verification_anchor: `quote:${input.commandFlags.quoteId}`,
      next_suggested_command: 'snapshot-lines'
    },
    result: mutationResultToJsonRecord(input.primitiveResult.result),
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

const UPSERT_QUOTE_LINES_SPEC: EnvelopeCommandSpec<UpsertQuoteLinesCommandDependencies> = {
  commandName: 'upsert-quote-lines',
  execute: async ({ argv, globalFlags, startedAt, deps }) => {
    const commandFlags = await parseUpsertQuoteLinesFlags(argv);
    const runPrimitive = deps.executeUpsertQuoteLines ?? executeUpsertQuoteLines;
    const primitiveResult = await runPrimitive({
      orgAlias: globalFlags.orgAlias!,
      mode: commandFlags.mode,
      quoteId: commandFlags.quoteId,
      lines: [commandFlags.line]
    });
    return buildUpsertQuoteLinesEnvelope({
      globalFlags,
      commandFlags,
      primitiveResult,
      durationMs: Math.max(0, Date.now() - startedAt)
    });
  },
  renderText: (envelope) => renderMutationText('quote-runtime upsert-quote-lines', envelope)
};

export async function runUpsertQuoteLinesCommand(
  argv: string[],
  globalFlags: GlobalFlags,
  io: CliIo,
  dependencies: UpsertQuoteLinesCommandDependencies = {}
): Promise<{ envelope: ResultEnvelope; text: string; exitCode: 0 | 1 }> {
  return runEnvelopeCommand(UPSERT_QUOTE_LINES_SPEC, argv, globalFlags, io, dependencies);
}

function parseOptionalNumber(value: string | undefined, name: string): number | null {
  if (value === undefined) {
    return null;
  }

  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    throw new Error(`--${name} must be a number.`);
  }
  return parsed;
}

// ---------------------------------------------------------------------------
// CommandSpec (Q3: defineCommand consolidation)
// ---------------------------------------------------------------------------
import { defineCommand, WAVE_GROUP_NAMES } from './spec';

export const UPSERT_QUOTE_LINES_COMMAND_SPEC = defineCommand({
  name: 'upsert-quote-lines',
  wave: 3,
  group_name: WAVE_GROUP_NAMES[3],
  summary: 'POST new QuoteLineItem rows or PATCH existing quote lines through the PST graph mutation lane.',
  ownership: {
        primary_owner: 'quote-runtime-mutations',
        secondary_escalation: ['pricing-runtime-debug'],
        shared_library_dependencies: ['quote_mutations', 'selectors', 'evidence']
  },
  selectorPolicy: {
        required_selectors: ['quote_id'],
        recommended_selectors: ['line_ids'],
        status_reason: 'Quote line POST/PATCH requires a target quote id; line ids switch the command from POST to PATCH.'
  },
    quickStart: 'quote-runtime upsert-quote-lines --org-alias <alias> --quote-id <id> --pricebook-entry-id <id> --product-id <id> --quantity <number>',
  renderHelp: renderUpsertQuoteLinesHelp,
  run: runUpsertQuoteLinesCommand
});
