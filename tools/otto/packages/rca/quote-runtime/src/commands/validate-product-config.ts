import { Flags, Parser } from '@oclif/core';

import type { GlobalFlags } from '../cli/global-flags';
import { emitJsonOutput, emitTextOutput, type CliIo } from '../cli/output';
import { runEnvelopeCommand, type EnvelopeCommandSpec } from '../cli/run-envelope-command';
import { exitCodeForStatus, makeEnvelope, type JsonValue, type ResultEnvelope } from '../contracts/result-envelope';
import {
  executeValidateProductConfig,
  type ExecuteValidateProductConfigInput,
  type ProductConfigValidationPrimitiveResult
} from '../primitives/product-config-runtime';

export const VALIDATE_PRODUCT_CONFIG_HELP_TEXT = [
  'quote-runtime validate-product-config',
  '',
  'Usage:',
  '  quote-runtime validate-product-config --org-alias <alias> --quote-id <id> [--line-id <id> ...]',
  '',
  'Notes:',
  '  Returns persisted QuoteLineItemAttribute and QuoteLineRelationship readback proof for configured product validation.'
].join('\n');

const FLAGS = {
  'quote-id': Flags.string({ required: true }),
  'line-id': Flags.string({ multiple: true, required: false })
};

export type ValidateProductConfigCommandDependencies = {
  executeValidateProductConfig?: (input: ExecuteValidateProductConfigInput) => Promise<ProductConfigValidationPrimitiveResult>;
};

export function renderValidateProductConfigHelp(): string {
  return VALIDATE_PRODUCT_CONFIG_HELP_TEXT;
}

const VALIDATE_PRODUCT_CONFIG_SPEC: EnvelopeCommandSpec<ValidateProductConfigCommandDependencies> = {
  commandName: 'validate-product-config',
  execute: async ({ argv, globalFlags, startedAt, deps }) => {
    const parsed = (await Parser.parse(argv, { args: {}, enableJsonFlag: false, flags: FLAGS, strict: true })) as {
      flags: { 'quote-id': string; 'line-id'?: string[] };
    };
    const primitive = await (deps.executeValidateProductConfig ?? executeValidateProductConfig)({
      orgAlias: globalFlags.orgAlias!,
      quoteId: parsed.flags['quote-id'],
      lineIds: parsed.flags['line-id'] ?? []
    });
    return makeEnvelope({
      command: 'validate-product-config',
      status: primitive.status,
      summary: {
        primary_subject: parsed.flags['quote-id'],
        status_reason: primitive.result.proof_status,
        primary_lane: 'product_config_validation',
        next_suggested_command: 'price-quote'
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
  renderText: (envelope) => `quote-runtime validate-product-config\nstatus: ${envelope.status}\nreason: ${String(envelope.summary.status_reason ?? '')}`
};

export async function runValidateProductConfigCommand(
  argv: string[],
  globalFlags: GlobalFlags,
  io: CliIo,
  dependencies: ValidateProductConfigCommandDependencies = {}
): Promise<{ envelope: ResultEnvelope; text: string; exitCode: 0 | 1 }> {
  return runEnvelopeCommand(VALIDATE_PRODUCT_CONFIG_SPEC, argv, globalFlags, io, dependencies);
}

function toJsonRecord(value: unknown): Record<string, JsonValue> {
  return JSON.parse(JSON.stringify(value)) as Record<string, JsonValue>;
}

// ---------------------------------------------------------------------------
// CommandSpec (Q3: defineCommand consolidation)
// ---------------------------------------------------------------------------
import { defineCommand, WAVE_GROUP_NAMES } from './spec';

export const VALIDATE_PRODUCT_CONFIG_COMMAND_SPEC = defineCommand({
  name: 'validate-product-config',
  wave: 3,
  group_name: WAVE_GROUP_NAMES[3],
  summary: 'Validate persisted product attributes and child relationships for a configured quote.',
  ownership: {
        primary_owner: 'config-runtime-bridge',
        secondary_escalation: ['pricing-runtime-debug'],
        shared_library_dependencies: ['overlay_relationships', 'evidence']
  },
  selectorPolicy: {
        required_selectors: ['quote_id'],
        recommended_selectors: ['line_ids'],
        status_reason: 'Product config validation starts from persisted quote readback and optional line narrowing.'
  },
    quickStart: 'quote-runtime validate-product-config --org-alias <alias> --quote-id <id> --line-id <id>',
  renderHelp: renderValidateProductConfigHelp,
  run: runValidateProductConfigCommand
});
