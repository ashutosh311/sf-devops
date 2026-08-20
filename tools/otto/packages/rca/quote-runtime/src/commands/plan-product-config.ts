import { Flags, Parser } from '@oclif/core';

import type { GlobalFlags } from '../cli/global-flags';
import { emitJsonOutput, emitTextOutput, type CliIo } from '../cli/output';
import { runEnvelopeCommand, type EnvelopeCommandSpec } from '../cli/run-envelope-command';
import { exitCodeForStatus, makeEnvelope, type JsonValue, type ResultEnvelope } from '../contracts/result-envelope';
import {
  executePlanProductConfig,
  type ExecutePlanProductConfigInput,
  type ProductConfigPlanningPrimitiveResult
} from '../primitives/product-config-planning';

export const PLAN_PRODUCT_CONFIG_HELP_TEXT = [
  'quote-runtime plan-product-config',
  '',
  'Usage:',
  '  quote-runtime plan-product-config --org-alias <alias> --product-config <path> --choices <path> [--parent-line-reference <ref>]',
  '',
  'Notes:',
  '  Deterministically validates explicit LLM-selected choices. It does not infer transcript meaning.'
].join('\n');

const FLAGS = {
  'product-config': Flags.string({ required: true }),
  choices: Flags.string({ required: true }),
  'parent-line-reference': Flags.string({ required: false })
};

export type PlanProductConfigCommandDependencies = {
  executePlanProductConfig?: (input: ExecutePlanProductConfigInput) => ProductConfigPlanningPrimitiveResult;
};

export function renderPlanProductConfigHelp(): string {
  return PLAN_PRODUCT_CONFIG_HELP_TEXT;
}

export async function parsePlanProductConfigFlags(argv: string[]): Promise<ExecutePlanProductConfigInput> {
  const parsed = (await Parser.parse(argv, {
    args: {},
    enableJsonFlag: false,
    flags: FLAGS,
    strict: true
  })) as {
    flags: {
      'product-config': string;
      choices: string;
      'parent-line-reference'?: string;
    };
  };
  return {
    productConfigPath: parsed.flags['product-config'],
    choicesPath: parsed.flags.choices,
    parentLineReference: parsed.flags['parent-line-reference'] ?? null
  };
}

const PLAN_PRODUCT_CONFIG_SPEC: EnvelopeCommandSpec<PlanProductConfigCommandDependencies> = {
  commandName: 'plan-product-config',
  execute: async ({ argv, globalFlags, startedAt, deps }) => {
    const commandFlags = await parsePlanProductConfigFlags(argv);
    const primitive = (deps.executePlanProductConfig ?? executePlanProductConfig)(commandFlags);
    return makeEnvelope({
      command: 'plan-product-config',
      status: primitive.status,
      summary: {
        primary_subject: primitive.result.product_id,
        status_reason: primitive.result.blocked ? 'Configuration choices are blocked.' : 'Configuration choices are valid.',
        primary_lane: 'product_config_planning',
        next_suggested_command: primitive.result.blocked ? 'inspect-product-catalog-config' : 'apply-configured-quote'
      },
      result: toJsonRecord(primitive.result),
      warnings: primitive.warnings,
      errors: primitive.errors,
      evidence: primitive.evidence,
      meta: {
        org_alias: globalFlags.orgAlias!,
        generated_at: new Date().toISOString(),
        duration_ms: Math.max(0, Date.now() - startedAt),
        source_files: [commandFlags.productConfigPath, commandFlags.choicesPath]
      }
    });
  },
  renderText: (envelope) => `quote-runtime plan-product-config\nstatus: ${envelope.status}\nreason: ${String(envelope.summary.status_reason ?? '')}`
};

export async function runPlanProductConfigCommand(
  argv: string[],
  globalFlags: GlobalFlags,
  io: CliIo,
  dependencies: PlanProductConfigCommandDependencies = {}
): Promise<{ envelope: ResultEnvelope; text: string; exitCode: 0 | 1 }> {
  return runEnvelopeCommand(PLAN_PRODUCT_CONFIG_SPEC, argv, globalFlags, io, dependencies);
}

function toJsonRecord(value: unknown): Record<string, JsonValue> {
  return JSON.parse(JSON.stringify(value)) as Record<string, JsonValue>;
}

// ---------------------------------------------------------------------------
// CommandSpec (Q3: defineCommand consolidation)
// ---------------------------------------------------------------------------
import { defineCommand, WAVE_GROUP_NAMES } from './spec';

export const PLAN_PRODUCT_CONFIG_COMMAND_SPEC = defineCommand({
  name: 'plan-product-config',
  wave: 3,
  group_name: WAVE_GROUP_NAMES[3],
  summary: 'Validate explicit product configuration choices and produce PST-ready attribute records.',
  ownership: {
        primary_owner: 'config-runtime-bridge',
        secondary_escalation: ['quote-runtime-mutations'],
        shared_library_dependencies: ['product_catalog_config', 'quote_mutations', 'evidence']
  },
  selectorPolicy: {
        required_selectors: [],
        recommended_selectors: [],
        status_reason: 'Product config planning reads deterministic config and choices from local JSON files.'
  },
    quickStart: 'quote-runtime plan-product-config --org-alias <alias> --product-config product-config.json --choices choices.json',
  renderHelp: renderPlanProductConfigHelp,
  run: runPlanProductConfigCommand
});
