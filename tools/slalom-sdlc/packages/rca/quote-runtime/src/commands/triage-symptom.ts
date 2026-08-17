import { Flags, Parser } from '@oclif/core';

import type { GlobalFlags } from '../cli/global-flags';
import { emitJsonOutput, emitTextOutput, type CliIo } from '../cli/output';
import { runEnvelopeCommand, type EnvelopeCommandSpec } from '../cli/run-envelope-command';
import type { EvidenceItem } from '../contracts/evidence';
import { exitCodeForStatus, makeEnvelope, type JsonValue, type ResultEnvelope } from '../contracts/result-envelope';
import { normalizeOptionalId, normalizeOptionalText, normalizeRepeatableIds } from '../selectors/runtime-selectors';
import { routeSymptom, type SymptomRoute } from '../primitives/symptom-routing';

export const TRIAGE_SYMPTOM_HELP_TEXT = [
  'quote-runtime triage-symptom',
  '',
  'Usage:',
  '  quote-runtime triage-symptom --org-alias <alias> --quote-id <id> --symptom <text> [--line-id <id> ...]',
  '',
  'Global flags:',
  '  --json',
  '  --org-alias <alias>',
  '  --fail-on <status>',
  '  --output <path>',
  '  --verbose',
  '',
  'Triage-symptom flags:',
  '  --quote-id <id>',
  '  --symptom <text>',
  '  --line-id <id>',
  '',
  'Notes:',
  '  triage-symptom performs symptom-led routing only; it does not fetch snapshots or overlays itself.',
  '  triage-symptom must use shared route logic instead of command-local branching tables.',
  '  unsupported symptoms fail fast instead of falling back to another route.',
  '',
  'Example:',
  '  quote-runtime triage-symptom --org-alias <alias> --quote-id <id> --symptom "wrong price on this quote line" --line-id <id>'
].join('\n');

const TRIAGE_SYMPTOM_FLAG_DEFINITIONS = {
  'quote-id': Flags.string({
    required: true,
    helpValue: '<id>',
    summary: 'Target quote id for symptom-led runtime routing.'
  }),
  symptom: Flags.string({
    required: true,
    helpValue: '<text>',
    summary: 'Operator-stated runtime symptom used for shared-route classification.'
  }),
  'line-id': Flags.string({
    multiple: true,
    helpValue: '<id>',
    summary: 'Optional line ids carried into the routed follow-up commands.'
  })
};

export type TriageSymptomCommandFlags = {
  quoteId: string;
  symptom: string;
  lineIds: string[];
};

export type TriageSymptomResult = {
  symptom_class: SymptomRoute['symptom_class'];
  primary_lane: SymptomRoute['primary_lane'];
  recommended_branch: SymptomRoute['recommended_branch'];
  required_overlays: string[];
  recommended_next_commands: string[];
};

export type TriageSymptomExecution = {
  envelope: ResultEnvelope;
  text: string;
  exitCode: 0 | 1;
};

export type BuildTriageSymptomEnvelopeInput = {
  globalFlags: GlobalFlags;
  commandFlags: TriageSymptomCommandFlags;
  generatedAt?: string;
  durationMs?: number;
};

export async function parseTriageSymptomFlags(argv: string[]): Promise<TriageSymptomCommandFlags> {
  const parsed = (await Parser.parse(argv, {
    args: {},
    enableJsonFlag: false,
    flags: TRIAGE_SYMPTOM_FLAG_DEFINITIONS,
    strict: true
  })) as {
    flags: {
      'quote-id': string;
      symptom: string;
      'line-id'?: string[];
    };
  };

  return {
    quoteId: normalizeOptionalId(parsed.flags['quote-id'], 'quote-id') ?? '',
    symptom: normalizeOptionalText(parsed.flags.symptom) ?? '',
    lineIds: normalizeRepeatableIds(parsed.flags['line-id'], 'line-id')
  };
}

export function renderTriageSymptomHelp(): string {
  return TRIAGE_SYMPTOM_HELP_TEXT;
}

export function buildTriageSymptomEnvelope(input: BuildTriageSymptomEnvelopeInput): ResultEnvelope {
  if (!input.globalFlags.orgAlias) {
    throw new Error('triage-symptom envelope requires a resolved org alias.');
  }

  const route = routeSymptom(input.commandFlags.symptom);
  const result: TriageSymptomResult = {
    symptom_class: route.symptom_class,
    primary_lane: route.primary_lane,
    recommended_branch: route.recommended_branch,
    required_overlays: [...route.required_overlays],
    recommended_next_commands: [...route.recommended_next_commands]
  };

  return makeEnvelope({
    command: 'triage-symptom',
    status: 'ok',
    summary: {
      primary_subject: input.commandFlags.quoteId,
      status_reason: buildTriageSymptomStatusReason(input.commandFlags, route),
      primary_lane: route.primary_lane,
      verification_anchor: `quote:${input.commandFlags.quoteId}`,
      symptom_class: route.symptom_class,
      next_suggested_command: result.recommended_next_commands[0] ?? null,
      key_counts: {
        line_ids: input.commandFlags.lineIds.length,
        required_overlays: result.required_overlays.length,
        recommended_next_commands: result.recommended_next_commands.length
      }
    } satisfies Record<string, JsonValue>,
    result: triageSymptomResultToJsonRecord(result),
    warnings: [],
    errors: [],
    evidence: buildTriageSymptomEvidence(input.commandFlags, route),
    meta: {
      org_alias: input.globalFlags.orgAlias,
      generated_at: input.generatedAt ?? new Date().toISOString(),
      duration_ms: input.durationMs ?? 0,
      source_files: []
    }
  });
}

export function renderTriageSymptomText(envelope: ResultEnvelope): string {
  const result = envelope.result as unknown as TriageSymptomResult;
  const lines = [
    'quote-runtime triage-symptom',
    `status: ${envelope.status}`,
    `org alias: ${envelope.meta.org_alias}`,
    `quote id: ${String(envelope.summary.primary_subject ?? '(unknown)')}`,
    `symptom class: ${result.symptom_class}`,
    `primary lane: ${result.primary_lane}`,
    `recommended branch: ${result.recommended_branch}`,
    `required overlays: ${formatStringList(result.required_overlays)}`,
    `recommended next commands: ${formatStringList(result.recommended_next_commands)}`,
    ''
  ];

  return lines.join('\n');
}

const TRIAGE_SYMPTOM_SPEC: EnvelopeCommandSpec = {
  commandName: 'triage-symptom',
  execute: async ({ argv, globalFlags, startedAt }) => {
    const commandFlags = await parseTriageSymptomFlags(argv);
    return buildTriageSymptomEnvelope({
      globalFlags,
      commandFlags,
      durationMs: Math.max(0, Date.now() - startedAt)
    });
  },
  renderText: renderTriageSymptomText
};

export async function runTriageSymptomCommand(
  argv: string[],
  globalFlags: GlobalFlags,
  io: CliIo
): Promise<TriageSymptomExecution> {
  return runEnvelopeCommand(TRIAGE_SYMPTOM_SPEC, argv, globalFlags, io, {});
}

function buildTriageSymptomStatusReason(commandFlags: TriageSymptomCommandFlags, route: SymptomRoute): string {
  const lineScopeSuffix = commandFlags.lineIds.length > 0 ? ` with ${commandFlags.lineIds.length} scoped line id(s).` : '.';
  return `Shared route logic classified the symptom as ${route.symptom_class} and routed to ${route.recommended_branch}${lineScopeSuffix}`;
}

function triageSymptomResultToJsonRecord(result: TriageSymptomResult): Record<string, JsonValue> {
  return {
    symptom_class: result.symptom_class,
    primary_lane: result.primary_lane,
    recommended_branch: result.recommended_branch,
    required_overlays: [...result.required_overlays],
    recommended_next_commands: [...result.recommended_next_commands]
  };
}

function buildTriageSymptomEvidence(
  commandFlags: TriageSymptomCommandFlags,
  route: SymptomRoute
): EvidenceItem[] {
  return [{
    claim: `Shared route logic classified the symptom '${commandFlags.symptom}' as ${route.symptom_class}.`,
    evidence_level: 'documented',
    proof_source: ['route_logic:routeSymptom', `symptom:${commandFlags.symptom}`],
    limitations: 'This command routes by deterministic symptom-text classification and does not inspect persisted org state.',
    source_refs: [
      'specs/quoting-pricing-runtime/quoting-pricing-runtime-node-typescript-wave3-scenarios-build-plan.md',
      'specs/quoting-pricing-runtime/quoting-pricing-runtime-wave4-command-grammar-and-result-schemas.md'
    ]
  }];
}

function formatStringList(values: readonly string[]): string {
  return values.length > 0 ? values.join(', ') : '(none)';
}

// ---------------------------------------------------------------------------
// CommandSpec (Q3: defineCommand consolidation)
// ---------------------------------------------------------------------------
import { defineCommand, WAVE_GROUP_NAMES } from './spec';

export const TRIAGE_SYMPTOM_COMMAND_SPEC = defineCommand({
  name: 'triage-symptom',
  wave: 3,
  group_name: WAVE_GROUP_NAMES[3],
  summary: 'Route runtime symptoms into the right persisted, overlay, or context investigation lane.',
  ownership: {
        primary_owner: 'pricing-runtime-debug',
        secondary_escalation: ['runtime-context-inspection', 'config-runtime-bridge'],
        shared_library_dependencies: ['compare_quotes', 'route_logic', 'evidence']
  },
  selectorPolicy: {
        required_selectors: ['quote_id', 'symptom'],
        recommended_selectors: ['line_ids'],
        status_reason: 'Symptom triage needs a quote and a stated symptom to route correctly.'
  },
    quickStart: 'quote-runtime triage-symptom --org-alias <alias> --quote-id <id> --symptom "wrong price" --line-id <id>',
  renderHelp: renderTriageSymptomHelp,
  run: runTriageSymptomCommand
});
