import { Flags, Parser } from '@oclif/core';

import type { GlobalFlags } from '../cli/global-flags';
import { emitJsonOutput, emitTextOutput, type CliIo } from '../cli/output';
import { runEnvelopeCommand, type EnvelopeCommandSpec } from '../cli/run-envelope-command';
import { exitCodeForStatus, makeEnvelope, type JsonValue, type ResultEnvelope } from '../contracts/result-envelope';
import {
  executeDecisionTableRefresh,
  type DecisionTableRefreshPrimitiveResult,
  type ExecuteDecisionTableRefreshInput
} from '../primitives/decision-table-refresh';

export const REFRESH_DECISION_TABLES_HELP_TEXT = [
  'quote-runtime refresh-decision-tables',
  '',
  'Usage:',
  '  quote-runtime refresh-decision-tables --org-alias <alias> --decision-table-api-name <name> ... [--incremental] [--execute] [--json] [--fail-on <status>] [--output <path>] [--verbose]',
  '',
  'Notes:',
  '  Dry-run is default. The command preflights DecisionTable status and the standard refreshDecisionTable action.',
  '  Use after loading or changing pricing data that backs Revenue Cloud pricing/rating decision tables.',
  '  --execute submits the standard refreshDecisionTable action for each supplied DecisionTable API name.'
].join('\n');

const FLAGS = {
  execute: Flags.boolean({ allowNo: false }),
  incremental: Flags.boolean({ allowNo: false }),
  'decision-table-api-name': Flags.string({ multiple: true, required: true, helpValue: '<name>' })
};

export type RefreshDecisionTablesCommandFlags = {
  mode: 'dry_run' | 'execute';
  decisionTableApiNames: string[];
  incremental?: boolean;
};

export type RefreshDecisionTablesCommandDependencies = {
  executeDecisionTableRefresh?: (
    input: ExecuteDecisionTableRefreshInput
  ) => Promise<DecisionTableRefreshPrimitiveResult>;
};

export function renderRefreshDecisionTablesHelp(): string {
  return REFRESH_DECISION_TABLES_HELP_TEXT;
}

export async function parseRefreshDecisionTablesFlags(argv: string[]): Promise<RefreshDecisionTablesCommandFlags> {
  const parsed = (await Parser.parse(argv, {
    args: {},
    enableJsonFlag: false,
    flags: FLAGS,
    strict: true
  })) as {
    flags: {
      execute?: boolean;
      incremental?: boolean;
      'decision-table-api-name': string[];
    };
  };

  return {
    mode: parsed.flags.execute === true ? 'execute' : 'dry_run',
    decisionTableApiNames: parsed.flags['decision-table-api-name'],
    ...(parsed.flags.incremental === true ? { incremental: true } : {})
  };
}

const REFRESH_DECISION_TABLES_SPEC: EnvelopeCommandSpec<RefreshDecisionTablesCommandDependencies> = {
  commandName: 'refresh-decision-tables',
  execute: async ({ argv, globalFlags, startedAt, deps }) => {
    const commandFlags = await parseRefreshDecisionTablesFlags(argv);
    const primitive = await (deps.executeDecisionTableRefresh ?? executeDecisionTableRefresh)({
      orgAlias: globalFlags.orgAlias!,
      mode: commandFlags.mode,
      decisionTableApiNames: commandFlags.decisionTableApiNames,
      ...(commandFlags.incremental === undefined ? {} : { incremental: commandFlags.incremental })
    });
    return makeEnvelope({
      command: 'refresh-decision-tables',
      status: primitive.status,
      summary: {
        primary_subject: 'decision-table-refresh',
        status_reason: buildStatusReason(primitive),
        primary_lane: 'pricing_product_sync_preflight',
        next_suggested_command: primitive.result.expected_verification_commands[0] ?? 'inspect-pricing-product-sync',
        key_counts: {
          tables: primitive.result.request_body.inputs.length,
          executed: primitive.result.execution.executed ? 1 : 0
        }
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
  renderText: renderRefreshDecisionTablesText
};

export async function runRefreshDecisionTablesCommand(
  argv: string[],
  globalFlags: GlobalFlags,
  io: CliIo,
  dependencies: RefreshDecisionTablesCommandDependencies = {}
): Promise<{ envelope: ResultEnvelope; text: string; exitCode: 0 | 1 }> {
  return runEnvelopeCommand(REFRESH_DECISION_TABLES_SPEC, argv, globalFlags, io, dependencies);
}

export function renderRefreshDecisionTablesText(envelope: ResultEnvelope): string {
  const result = envelope.result;
  const execution = readRecord(result.execution);
  const requestBody = readRecord(result.request_body);
  const requestInputs = Array.isArray(requestBody?.inputs) ? requestBody.inputs : [];
  const commands = Array.isArray(result.expected_verification_commands) ? result.expected_verification_commands : [];
  return [
    'quote-runtime refresh-decision-tables',
    `status: ${envelope.status}`,
    `mode: ${String(result.mode ?? 'unknown')}`,
    `route: ${String(result.route ?? '')}`,
    `decision tables: ${String(requestInputs.length)}`,
    `executed: ${String(execution?.executed ?? false)}`,
    `next: ${String(commands[0] ?? 'inspect-pricing-product-sync --sample-limit 100')}`
  ].join('\n');
}

function buildStatusReason(primitive: DecisionTableRefreshPrimitiveResult): string {
  if (primitive.result.execution.executed) {
    return 'Submitted refreshDecisionTable action; run the expected verification commands for readback.';
  }
  if (primitive.status === 'ok' || primitive.status === 'warn') {
    return 'Validated decision table refresh dry-run; no refresh action was submitted.';
  }
  return 'Decision table refresh preflight or submission failed.';
}

function toJsonRecord(value: DecisionTableRefreshPrimitiveResult['result']): Record<string, JsonValue> {
  return value as unknown as Record<string, JsonValue>;
}

function readRecord(value: unknown): Record<string, JsonValue> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? value as Record<string, JsonValue>
    : null;
}

// ---------------------------------------------------------------------------
// CommandSpec (Q3: defineCommand consolidation)
// ---------------------------------------------------------------------------
import { defineCommand, WAVE_GROUP_NAMES } from './spec';

export const REFRESH_DECISION_TABLES_COMMAND_SPEC = defineCommand({
  name: 'refresh-decision-tables',
  wave: 3,
  group_name: WAVE_GROUP_NAMES[3],
  summary: 'Dry-run or execute the standard refreshDecisionTable action for pricing/rating decision tables.',
  ownership: {
        primary_owner: 'config-runtime-bridge',
        secondary_escalation: ['pricing-runtime-debug', 'quote-runtime-mutations'],
        shared_library_dependencies: ['pricing_product_sync', 'rest', 'evidence']
  },
  selectorPolicy: {
        required_selectors: [],
        recommended_selectors: [],
        status_reason: 'Decision table refresh dry-runs by DecisionTable API name; --execute submits the standard refreshDecisionTable action.'
  },
    quickStart: 'quote-runtime refresh-decision-tables --org-alias <alias> --decision-table-api-name <name>',
  renderHelp: renderRefreshDecisionTablesHelp,
  run: runRefreshDecisionTablesCommand
});
