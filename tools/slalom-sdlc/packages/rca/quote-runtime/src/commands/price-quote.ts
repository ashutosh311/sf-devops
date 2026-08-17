import { Flags, Parser } from '@oclif/core';

import type { GlobalFlags } from '../cli/global-flags';
import { emitJsonOutput, emitTextOutput, type CliIo } from '../cli/output';
import { runEnvelopeCommand, type EnvelopeCommandSpec } from '../cli/run-envelope-command';
import { exitCodeForStatus, makeEnvelope, type ResultEnvelope } from '../contracts/result-envelope';
import {
  executePriceQuote,
  type ExecutePriceQuoteInput,
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

export const PRICE_QUOTE_HELP_TEXT = [
  'quote-runtime price-quote',
  '',
  'Usage:',
  '  quote-runtime price-quote --org-alias <alias> --quote-id <id> [--line-id <id> --line-field <Name=value> ...] [--execute]',
  '',
  'Notes:',
  '  price-quote submits the proven PST place route when --execute is provided.',
  '  Omit --execute for dry-run validation.'
].join('\n');

const PRICE_QUOTE_FLAG_DEFINITIONS = {
  'quote-id': Flags.string({ required: true, helpValue: '<id>', summary: 'Target quote id.' }),
  'line-id': Flags.string({ multiple: true, helpValue: '<id>', summary: 'Optional line ids to PATCH as part of repricing.' }),
  'line-field': Flags.string({ multiple: true, helpValue: '<Name=value>', summary: 'Field assignment applied to each supplied line id.' }),
  execute: Flags.boolean({ allowNo: false, summary: 'Submit the PST graph request.' })
};

export type PriceQuoteCommandFlags = {
  mode: MutationMode;
  quoteId: string;
  lines: QuoteLineInput[];
};

export type PriceQuoteCommandDependencies = {
  executePriceQuote?: (input: ExecutePriceQuoteInput) => Promise<QuoteMutationPrimitiveResult>;
};

export function renderPriceQuoteHelp(): string {
  return PRICE_QUOTE_HELP_TEXT;
}

export async function parsePriceQuoteFlags(argv: string[]): Promise<PriceQuoteCommandFlags> {
  const parsed = (await Parser.parse(argv, {
    args: {},
    enableJsonFlag: false,
    flags: PRICE_QUOTE_FLAG_DEFINITIONS,
    strict: true
  })) as {
    flags: {
      'quote-id': string;
      'line-id'?: string[];
      'line-field'?: string[];
      execute?: boolean;
    };
  };
  const extraFields = parseFieldAssignments(parsed.flags['line-field'] ?? []);

  return {
    mode: parsed.flags.execute === true ? 'execute' : 'dry_run',
    quoteId: parsed.flags['quote-id'],
    lines: (parsed.flags['line-id'] ?? []).map((lineId) => ({
      lineId,
      extraFields
    }))
  };
}

export function buildPriceQuoteEnvelope(input: {
  globalFlags: GlobalFlags;
  commandFlags: PriceQuoteCommandFlags;
  primitiveResult: QuoteMutationPrimitiveResult;
  generatedAt?: string;
  durationMs?: number;
}): ResultEnvelope {
  if (!input.globalFlags.orgAlias) {
    throw new Error('price-quote envelope requires a resolved org alias.');
  }

  return makeEnvelope({
    command: 'price-quote',
    status: input.primitiveResult.status,
    summary: {
      primary_subject: input.commandFlags.quoteId,
      status_reason: buildMutationStatusReason('price-quote', input.commandFlags.mode, input.primitiveResult),
      primary_lane: 'quote_runtime_mutation',
      verification_anchor: `quote:${input.commandFlags.quoteId}`,
      next_suggested_command: 'capture-post-pst-evidence'
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

const PRICE_QUOTE_SPEC: EnvelopeCommandSpec<PriceQuoteCommandDependencies> = {
  commandName: 'price-quote',
  execute: async ({ argv, globalFlags, startedAt, deps }) => {
    const commandFlags = await parsePriceQuoteFlags(argv);
    const runPrimitive = deps.executePriceQuote ?? executePriceQuote;
    const primitiveResult = await runPrimitive({
      orgAlias: globalFlags.orgAlias!,
      mode: commandFlags.mode,
      quoteId: commandFlags.quoteId,
      lines: commandFlags.lines
    });
    return buildPriceQuoteEnvelope({
      globalFlags,
      commandFlags,
      primitiveResult,
      durationMs: Math.max(0, Date.now() - startedAt)
    });
  },
  renderText: (envelope) => renderMutationText('quote-runtime price-quote', envelope)
};

export async function runPriceQuoteCommand(
  argv: string[],
  globalFlags: GlobalFlags,
  io: CliIo,
  dependencies: PriceQuoteCommandDependencies = {}
): Promise<{ envelope: ResultEnvelope; text: string; exitCode: 0 | 1 }> {
  return runEnvelopeCommand(PRICE_QUOTE_SPEC, argv, globalFlags, io, dependencies);
}

// ---------------------------------------------------------------------------
// CommandSpec (Q3: defineCommand consolidation)
// ---------------------------------------------------------------------------
import { defineCommand, WAVE_GROUP_NAMES } from './spec';

export const PRICE_QUOTE_COMMAND_SPEC = defineCommand({
  name: 'price-quote',
  wave: 3,
  group_name: WAVE_GROUP_NAMES[3],
  summary: 'Run the proven Place Sales Transaction route to price or reprice a quote.',
  ownership: {
        primary_owner: 'quote-runtime-mutations',
        secondary_escalation: ['pricing-runtime-debug'],
        shared_library_dependencies: ['quote_mutations', 'pst_plan', 'selectors', 'evidence']
  },
  selectorPolicy: {
        required_selectors: ['quote_id'],
        recommended_selectors: ['line_ids'],
        status_reason: 'Pricing execution requires a target quote id and optional line ids for scoped PATCH payloads.'
  },
    quickStart: 'quote-runtime price-quote --org-alias <alias> --quote-id <id> --line-id <id> --line-field Quantity=2',
  renderHelp: renderPriceQuoteHelp,
  run: runPriceQuoteCommand
});
