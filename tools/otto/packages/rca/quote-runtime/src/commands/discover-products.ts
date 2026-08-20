import { Flags, Parser } from '@oclif/core';

import type { GlobalFlags } from '../cli/global-flags';
import { emitJsonOutput, emitTextOutput, type CliIo } from '../cli/output';
import { runEnvelopeCommand, type EnvelopeCommandSpec } from '../cli/run-envelope-command';
import { exitCodeForStatus, makeEnvelope, type JsonValue, type ResultEnvelope } from '../contracts/result-envelope';
import {
  executeDiscoverProducts,
  type ExecuteDiscoverProductsInput,
  type ProductDiscoveryPrimitiveResult
} from '../primitives/product-discovery';

export const DISCOVER_PRODUCTS_HELP_TEXT = [
  'quote-runtime discover-products',
  '',
  'Usage:',
  '  quote-runtime discover-products --org-alias <alias> --pricebook-id <id> --term <text> ... [--catalog-id <id>] [--account-id <id>] [--limit <n>]',
  '',
  'Notes:',
  '  Uses Product Discovery Products List when useful, with SOQL fallback for transparent candidate discovery.',
  '  Returns compact ranked candidates for downstream inspect-product-catalog-config.'
].join('\n');

const FLAGS = {
  'pricebook-id': Flags.string({ required: true }),
  'catalog-id': Flags.string({ required: false }),
  'category-id': Flags.string({ required: false }),
  'account-id': Flags.string({ required: false }),
  'currency-code': Flags.string({ required: false }),
  term: Flags.string({ multiple: true, required: true }),
  limit: Flags.integer({ required: false }),
  'include-raw': Flags.boolean({ allowNo: false })
};

export type DiscoverProductsCommandFlags = {
  pricebookId: string;
  catalogId?: string | null;
  categoryId?: string | null;
  accountId?: string | null;
  currencyCode?: string | null;
  terms: string[];
  limit?: number;
  includeRaw: boolean;
};

export type DiscoverProductsCommandDependencies = {
  executeDiscoverProducts?: (input: ExecuteDiscoverProductsInput) => Promise<ProductDiscoveryPrimitiveResult>;
};

export function renderDiscoverProductsHelp(): string {
  return DISCOVER_PRODUCTS_HELP_TEXT;
}

export async function parseDiscoverProductsFlags(argv: string[]): Promise<DiscoverProductsCommandFlags> {
  const parsed = (await Parser.parse(argv, {
    args: {},
    enableJsonFlag: false,
    flags: FLAGS,
    strict: true
  })) as {
    flags: {
      'pricebook-id': string;
      'catalog-id'?: string;
      'category-id'?: string;
      'account-id'?: string;
      'currency-code'?: string;
      term: string[];
      limit?: number;
      'include-raw'?: boolean;
    };
  };

  return {
    pricebookId: parsed.flags['pricebook-id'],
    catalogId: parsed.flags['catalog-id'] ?? null,
    categoryId: parsed.flags['category-id'] ?? null,
    accountId: parsed.flags['account-id'] ?? null,
    currencyCode: parsed.flags['currency-code'] ?? null,
    terms: parsed.flags.term,
    limit: parsed.flags.limit,
    includeRaw: parsed.flags['include-raw'] === true
  };
}

const DISCOVER_PRODUCTS_SPEC: EnvelopeCommandSpec<DiscoverProductsCommandDependencies> = {
  commandName: 'discover-products',
  execute: async ({ argv, globalFlags, startedAt, deps }) => {
    const commandFlags = await parseDiscoverProductsFlags(argv);
    const primitive = await (deps.executeDiscoverProducts ?? executeDiscoverProducts)({
      orgAlias: globalFlags.orgAlias!,
      pricebookId: commandFlags.pricebookId,
      catalogId: commandFlags.catalogId,
      categoryId: commandFlags.categoryId,
      accountId: commandFlags.accountId,
      currencyCode: commandFlags.currencyCode,
      terms: commandFlags.terms,
      limit: commandFlags.limit
    });
    return makeEnvelope({
      command: 'discover-products',
      status: primitive.status,
      summary: {
        primary_subject: commandFlags.terms.join(' '),
        status_reason: `${primitive.result.candidates.length} candidate(s) via ${primitive.result.strategy}`,
        primary_lane: 'product_discovery',
        next_suggested_command: 'inspect-product-catalog-config'
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
  renderText: (envelope) => renderText('quote-runtime discover-products', envelope)
};

export async function runDiscoverProductsCommand(
  argv: string[],
  globalFlags: GlobalFlags,
  io: CliIo,
  dependencies: DiscoverProductsCommandDependencies = {}
): Promise<{ envelope: ResultEnvelope; text: string; exitCode: 0 | 1 }> {
  return runEnvelopeCommand(DISCOVER_PRODUCTS_SPEC, argv, globalFlags, io, dependencies);
}

function renderText(title: string, envelope: ResultEnvelope): string {
  return [
    title,
    `status: ${envelope.status}`,
    `reason: ${String(envelope.summary.status_reason ?? '')}`,
    `next: ${String(envelope.summary.next_suggested_command ?? '')}`
  ].join('\n');
}

function toJsonRecord(value: unknown): Record<string, JsonValue> {
  return JSON.parse(JSON.stringify(value)) as Record<string, JsonValue>;
}

// ---------------------------------------------------------------------------
// CommandSpec (Q3: defineCommand consolidation)
// ---------------------------------------------------------------------------
import { defineCommand, WAVE_GROUP_NAMES } from './spec';

export const DISCOVER_PRODUCTS_COMMAND_SPEC = defineCommand({
  name: 'discover-products',
  wave: 3,
  group_name: WAVE_GROUP_NAMES[3],
  summary: 'Find compact product and pricebook-entry candidates from product intent before quote creation.',
  ownership: {
        primary_owner: 'config-runtime-bridge',
        secondary_escalation: ['quote-runtime-mutations'],
        shared_library_dependencies: ['product_discovery', 'evidence']
  },
  selectorPolicy: {
        required_selectors: [],
        recommended_selectors: [],
        status_reason: 'Product discovery requires product terms and a pricebook id at command parse time.'
  },
    quickStart: 'quote-runtime discover-products --org-alias <alias> --pricebook-id <id> --term "DR suite"',
  renderHelp: renderDiscoverProductsHelp,
  run: runDiscoverProductsCommand
});
