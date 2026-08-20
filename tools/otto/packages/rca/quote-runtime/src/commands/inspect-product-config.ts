import { Flags, Parser } from '@oclif/core';

import type { GlobalFlags } from '../cli/global-flags';
import { emitJsonOutput, emitTextOutput, type CliIo } from '../cli/output';
import { runEnvelopeCommand, type EnvelopeCommandSpec } from '../cli/run-envelope-command';
import { exitCodeForStatus, makeEnvelope, type JsonValue, type ResultEnvelope } from '../contracts/result-envelope';
import {
  executeInspectProductConfig,
  type ExecuteInspectProductConfigInput,
  type ProductConfigRuntimePrimitiveResult
} from '../primitives/product-config-runtime';

export const INSPECT_PRODUCT_CONFIG_HELP_TEXT = [
  'quote-runtime inspect-product-config',
  '',
  'Usage:',
  '  quote-runtime inspect-product-config --org-alias <alias> --quote-id <id> --line-id <id> [--account-id <id>]',
  '',
  'Notes:',
  '  Uses Product Configurator configure against an existing persisted quote line.'
].join('\n');

const FLAGS = {
  'quote-id': Flags.string({ required: true }),
  'line-id': Flags.string({ required: true }),
  'account-id': Flags.string({ required: false })
};

export type InspectProductConfigCommandDependencies = {
  executeInspectProductConfig?: (input: ExecuteInspectProductConfigInput) => Promise<ProductConfigRuntimePrimitiveResult>;
};

export function renderInspectProductConfigHelp(): string {
  return INSPECT_PRODUCT_CONFIG_HELP_TEXT;
}

const INSPECT_PRODUCT_CONFIG_SPEC: EnvelopeCommandSpec<InspectProductConfigCommandDependencies> = {
  commandName: 'inspect-product-config',
  execute: async ({ argv, globalFlags, startedAt, deps }) => {
    const parsed = (await Parser.parse(argv, { args: {}, enableJsonFlag: false, flags: FLAGS, strict: true })) as {
      flags: { 'quote-id': string; 'line-id': string; 'account-id'?: string };
    };
    const primitive = await (deps.executeInspectProductConfig ?? executeInspectProductConfig)({
      orgAlias: globalFlags.orgAlias!,
      quoteId: parsed.flags['quote-id'],
      lineId: parsed.flags['line-id'],
      accountId: parsed.flags['account-id'] ?? null
    });
    return makeEnvelope({
      command: 'inspect-product-config',
      status: primitive.status,
      summary: {
        primary_subject: parsed.flags['line-id'],
        status_reason: `${primitive.result.messages.length} runtime message(s)`,
        primary_lane: 'product_config_runtime',
        next_suggested_command: 'validate-product-config'
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
  renderText: (envelope) => `quote-runtime inspect-product-config\nstatus: ${envelope.status}\nreason: ${String(envelope.summary.status_reason ?? '')}`
};

export async function runInspectProductConfigCommand(
  argv: string[],
  globalFlags: GlobalFlags,
  io: CliIo,
  dependencies: InspectProductConfigCommandDependencies = {}
): Promise<{ envelope: ResultEnvelope; text: string; exitCode: 0 | 1 }> {
  return runEnvelopeCommand(INSPECT_PRODUCT_CONFIG_SPEC, argv, globalFlags, io, dependencies);
}

function toJsonRecord(value: unknown): Record<string, JsonValue> {
  return JSON.parse(JSON.stringify(value)) as Record<string, JsonValue>;
}

// ---------------------------------------------------------------------------
// CommandSpec (Q3: defineCommand consolidation)
// ---------------------------------------------------------------------------
import { defineCommand, WAVE_GROUP_NAMES } from './spec';

export const INSPECT_PRODUCT_CONFIG_COMMAND_SPEC = defineCommand({
  name: 'inspect-product-config',
  wave: 3,
  group_name: WAVE_GROUP_NAMES[3],
  summary: 'Inspect runtime configuration messages for a persisted quote line.',
  ownership: {
        primary_owner: 'config-runtime-bridge',
        secondary_escalation: ['quote-runtime-mutations'],
        shared_library_dependencies: ['product_catalog_config', 'evidence']
  },
  selectorPolicy: {
        required_selectors: ['quote_id', 'line_ids'],
        recommended_selectors: [],
        status_reason: 'Runtime product config inspection requires a quote id and at least one quote line id.'
  },
    quickStart: 'quote-runtime inspect-product-config --org-alias <alias> --quote-id <id> --line-id <id>',
  renderHelp: renderInspectProductConfigHelp,
  run: runInspectProductConfigCommand
});
