import { Flags, Parser } from '@oclif/core';

import type { GlobalFlags } from '../cli/global-flags';
import { emitJsonOutput, emitTextOutput, type CliIo } from '../cli/output';
import { runEnvelopeCommand, type EnvelopeCommandSpec } from '../cli/run-envelope-command';
import { exitCodeForStatus, makeEnvelope, type JsonValue, type ResultEnvelope } from '../contracts/result-envelope';
import {
  executeCreateQuote,
  type ExecuteCreateQuoteInput,
  type MutationFieldValue,
  type MutationMode,
  type QuoteHeaderInput,
  type QuoteMutationPrimitiveResult,
  type QuoteMutationResult
} from '../primitives/quote-mutations';

export const CREATE_QUOTE_HELP_TEXT = [
  'quote-runtime create-quote',
  '',
  'Usage:',
  '  quote-runtime create-quote --org-alias <alias> --name <name> [--quote-account-id <id>] [--opportunity-id <id>] [--pricebook-id <id>] [--status <value>] [--start-date <date>] [--expiration-date <date>] [--field <Name=value> ...] [--execute]',
  '',
  'Global flags:',
  '  --json',
  '  --org-alias <alias>',
  '  --fail-on <status>',
  '  --output <path>',
  '  --verbose',
  '',
  'Create-quote flags:',
  '  --name <name>                 Required Quote.Name.',
  '  --quote-account-id <id>       Createable account relationship for Quote in ARMAF.',
  '  --opportunity-id <id>         Opportunity relationship for opportunity-backed quotes.',
  '  --pricebook-id <id>           Quote.Pricebook2Id.',
  '  --status <value>              Optional quote status, defaulted by Salesforce when omitted.',
  '  --start-date <date>           Optional quote start date.',
  '  --expiration-date <date>      Optional quote expiration date.',
  '  --sales-transaction-type-id <id>',
  '  --transaction-type <value>',
  '  --field <Name=value>          Additional metadata-gated Quote field.',
  '  --execute                    Submit the PST graph request. Omit for dry-run validation.',
  '',
  'Notes:',
  '  create-quote validates requested fields against Salesforce describe metadata before execution.',
  '  Dry-run is the default. Use --execute for writes.',
  '',
  'Example:',
  '  quote-runtime create-quote --org-alias <alias> --name "ACME test quote" --quote-account-id <id> --opportunity-id <id> --pricebook-id <id>'
].join('\n');

const CREATE_QUOTE_FLAG_DEFINITIONS = {
  name: Flags.string({ required: true, helpValue: '<name>', summary: 'Quote.Name value.' }),
  'quote-account-id': Flags.string({ required: false, helpValue: '<id>', summary: 'QuoteAccountId value.' }),
  'opportunity-id': Flags.string({ required: false, helpValue: '<id>', summary: 'OpportunityId value.' }),
  'pricebook-id': Flags.string({ required: false, helpValue: '<id>', summary: 'Pricebook2Id value.' }),
  status: Flags.string({ required: false, helpValue: '<value>', summary: 'Quote status.' }),
  'start-date': Flags.string({ required: false, helpValue: '<date>', summary: 'Quote StartDate.' }),
  'expiration-date': Flags.string({ required: false, helpValue: '<date>', summary: 'Quote ExpirationDate.' }),
  'sales-transaction-type-id': Flags.string({ required: false, helpValue: '<id>', summary: 'SalesTransactionTypeId.' }),
  'transaction-type': Flags.string({ required: false, helpValue: '<value>', summary: 'TransactionType.' }),
  field: Flags.string({ multiple: true, helpValue: '<Name=value>', summary: 'Additional Quote field assignment.' }),
  execute: Flags.boolean({ allowNo: false, summary: 'Submit the PST graph request.' })
};

export type CreateQuoteCommandFlags = {
  mode: MutationMode;
  quote: QuoteHeaderInput;
};

export type CreateQuoteExecution = {
  envelope: ResultEnvelope;
  text: string;
  exitCode: 0 | 1;
};

export type CreateQuoteCommandDependencies = {
  executeCreateQuote?: (input: ExecuteCreateQuoteInput) => Promise<QuoteMutationPrimitiveResult>;
};

export async function parseCreateQuoteFlags(argv: string[]): Promise<CreateQuoteCommandFlags> {
  const parsed = (await Parser.parse(argv, {
    args: {},
    enableJsonFlag: false,
    flags: CREATE_QUOTE_FLAG_DEFINITIONS,
    strict: true
  })) as {
    flags: {
      name: string;
      'quote-account-id'?: string;
      'opportunity-id'?: string;
      'pricebook-id'?: string;
      status?: string;
      'start-date'?: string;
      'expiration-date'?: string;
      'sales-transaction-type-id'?: string;
      'transaction-type'?: string;
      field?: string[];
      execute?: boolean;
    };
  };

  return {
    mode: parsed.flags.execute === true ? 'execute' : 'dry_run',
    quote: {
      name: parsed.flags.name,
      quoteAccountId: parsed.flags['quote-account-id'] ?? null,
      opportunityId: parsed.flags['opportunity-id'] ?? null,
      pricebook2Id: parsed.flags['pricebook-id'] ?? null,
      status: parsed.flags.status ?? null,
      startDate: parsed.flags['start-date'] ?? null,
      expirationDate: parsed.flags['expiration-date'] ?? null,
      salesTransactionTypeId: parsed.flags['sales-transaction-type-id'] ?? null,
      transactionType: parsed.flags['transaction-type'] ?? null,
      extraFields: parseFieldAssignments(parsed.flags.field ?? [])
    }
  };
}

export function renderCreateQuoteHelp(): string {
  return CREATE_QUOTE_HELP_TEXT;
}

export function buildCreateQuoteEnvelope(input: {
  globalFlags: GlobalFlags;
  commandFlags: CreateQuoteCommandFlags;
  primitiveResult: QuoteMutationPrimitiveResult;
  generatedAt?: string;
  durationMs?: number;
}): ResultEnvelope {
  if (!input.globalFlags.orgAlias) {
    throw new Error('create-quote envelope requires a resolved org alias.');
  }

  return makeEnvelope({
    command: 'create-quote',
    status: input.primitiveResult.status,
    summary: {
      primary_subject: input.commandFlags.quote.name,
      status_reason: buildMutationStatusReason('create-quote', input.commandFlags.mode, input.primitiveResult),
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
      source_files: []
    }
  });
}

export function renderCreateQuoteText(envelope: ResultEnvelope): string {
  return renderMutationText('quote-runtime create-quote', envelope);
}

const CREATE_QUOTE_SPEC: EnvelopeCommandSpec<CreateQuoteCommandDependencies> = {
  commandName: 'create-quote',
  execute: async ({ argv, globalFlags, startedAt, deps }) => {
    const commandFlags = await parseCreateQuoteFlags(argv);
    const runPrimitive = deps.executeCreateQuote ?? executeCreateQuote;
    const primitiveResult = await runPrimitive({
      orgAlias: globalFlags.orgAlias!,
      mode: commandFlags.mode,
      quote: commandFlags.quote
    });

    return buildCreateQuoteEnvelope({
      globalFlags,
      commandFlags,
      primitiveResult,
      durationMs: Math.max(0, Date.now() - startedAt)
    });
  },
  renderText: renderCreateQuoteText
};

export async function runCreateQuoteCommand(
  argv: string[],
  globalFlags: GlobalFlags,
  io: CliIo,
  dependencies: CreateQuoteCommandDependencies = {}
): Promise<CreateQuoteExecution> {
  return runEnvelopeCommand(CREATE_QUOTE_SPEC, argv, globalFlags, io, dependencies);
}

export function parseFieldAssignments(assignments: string[]): Record<string, MutationFieldValue> {
  return Object.fromEntries(assignments.map((assignment) => {
    const separatorIndex = assignment.indexOf('=');
    if (separatorIndex <= 0) {
      throw new Error(`Invalid field assignment '${assignment}'. Use Name=value.`);
    }

    return [
      assignment.slice(0, separatorIndex),
      parseMutationFieldValue(assignment.slice(separatorIndex + 1))
    ];
  }));
}

export function parseMutationFieldValue(value: string): MutationFieldValue {
  if (value === 'null') {
    return null;
  }
  if (value === 'true') {
    return true;
  }
  if (value === 'false') {
    return false;
  }
  if (/^-?\d+(\.\d+)?$/.test(value)) {
    return Number(value);
  }
  return value;
}

export function buildMutationStatusReason(commandName: string, mode: MutationMode, primitiveResult: QuoteMutationPrimitiveResult): string {
  if (primitiveResult.status === 'changed') {
    return `${commandName} submitted the PST graph request. Persisted readback remains required.`;
  }
  if (primitiveResult.status === 'ok' && mode === 'dry_run') {
    return `${commandName} validated the PST graph request in dry-run mode.`;
  }
  return primitiveResult.errors[0] ?? `${commandName} finished with status ${primitiveResult.status}.`;
}

export function mutationResultToJsonRecord(result: QuoteMutationResult): Record<string, JsonValue> {
  return result as unknown as Record<string, JsonValue>;
}

export function renderMutationText(title: string, envelope: ResultEnvelope): string {
  const result = envelope.result as unknown as QuoteMutationResult;
  const lines = [
    title,
    `status: ${envelope.status}`,
    `org alias: ${envelope.meta.org_alias}`,
    `mode: ${result.plan.mode}`,
    `route: ${result.plan.route}`,
    `records: ${result.plan.graph.graph.records.length}`,
    `executed: ${String(result.execution.executed)}`,
    `next: ${result.plan.expected_verification_commands.join(', ')}`
  ];

  for (const validation of result.plan.validation) {
    lines.push(`validation: ${validation.reference_id} ${validation.object} ${validation.method} valid=${String(validation.valid)}`);
    for (const error of validation.errors) {
      lines.push(`- ${error}`);
    }
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

// ---------------------------------------------------------------------------
// CommandSpec (Q3: defineCommand consolidation)
// ---------------------------------------------------------------------------
import { defineCommand, WAVE_GROUP_NAMES } from './spec';

export const CREATE_QUOTE_COMMAND_SPEC = defineCommand({
  name: 'create-quote',
  wave: 3,
  group_name: WAVE_GROUP_NAMES[3],
  summary: 'Create a fresh Quote through the metadata-gated PST graph mutation lane.',
  ownership: {
        primary_owner: 'quote-runtime-mutations',
        secondary_escalation: ['pricing-runtime-debug'],
        shared_library_dependencies: ['quote_mutations', 'selectors', 'evidence']
  },
  selectorPolicy: {
        required_selectors: [],
        recommended_selectors: [],
        status_reason: 'Quote creation requires metadata-gated quote fields, including Quote.Name and org-specific relationship fields.'
  },
    quickStart: 'quote-runtime create-quote --org-alias <alias> --name <name> --quote-account-id <id> --opportunity-id <id> --pricebook-id <id>',
  renderHelp: renderCreateQuoteHelp,
  run: runCreateQuoteCommand
});
