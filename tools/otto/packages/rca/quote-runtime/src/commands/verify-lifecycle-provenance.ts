import { Flags, Parser } from '@oclif/core';

import type { GlobalFlags } from '../cli/global-flags';
import { emitJsonOutput, emitTextOutput, type CliIo } from '../cli/output';
import { runEnvelopeCommand, type EnvelopeCommandSpec } from '../cli/run-envelope-command';
import type { EvidenceItem } from '../contracts/evidence';
import { exitCodeForStatus, makeEnvelope, type JsonValue, type ResultEnvelope } from '../contracts/result-envelope';
import type { RuntimeStatus } from '../contracts/status';
import {
  executeOverlayActions,
  type ExecuteOverlayActionsInput,
  type OverlayActionLineLink,
  type OverlayActionRecord,
  type OverlayActionsPrimitiveResult,
  type OverlayActionsResult
} from '../primitives/overlay-actions';
import { normalizeOptionalId, normalizeRepeatableIds } from '../selectors/runtime-selectors';

export const VERIFY_LIFECYCLE_PROVENANCE_HELP_TEXT = [
  'quote-runtime verify-lifecycle-provenance',
  '',
  'Usage:',
  '  quote-runtime verify-lifecycle-provenance --org-alias <alias> --quote-id <id> [--line-id <id> ...] [--asset-id <id> ...]',
  '',
  'Global flags:',
  '  --json',
  '  --org-alias <alias>',
  '  --fail-on <status>',
  '  --output <path>',
  '  --verbose',
  '',
  'Verify-lifecycle-provenance flags:',
  '  --quote-id <id>',
  '  --line-id <id>',
  '  --asset-id <id>',
  '',
  'Notes:',
  '  verify-lifecycle-provenance composes overlay-actions only.',
  '  verify-lifecycle-provenance uses QuoteAction lifecycle provenance only and does not infer QuoteLineRelationship structure semantics.',
  '',
  'Example:',
  '  quote-runtime verify-lifecycle-provenance --org-alias <alias> --quote-id <id> --line-id <id> --asset-id <id>'
].join('\n');

const VERIFY_LIFECYCLE_PROVENANCE_FLAG_DEFINITIONS = {
  'quote-id': Flags.string({
    required: true,
    helpValue: '<id>',
    summary: 'Target quote id for lifecycle provenance verification.'
  }),
  'line-id': Flags.string({
    multiple: true,
    helpValue: '<id>',
    summary: 'Optional quote line ids used to narrow lifecycle provenance verification.'
  }),
  'asset-id': Flags.string({
    multiple: true,
    helpValue: '<id>',
    summary: 'Optional asset ids checked against observed QuoteAction source assets.'
  })
};

export type VerifyLifecycleProvenanceCommandFlags = {
  quoteId: string;
  lineIds: string[];
  assetIds: string[];
};

export type LifecycleQuoteClassification = {
  quote_id: string;
  classification: 'lifecycle_quote' | 'no_lifecycle_overlay_found' | 'verification_incomplete';
  status_reason: string;
  action_types: string[];
  source_asset_ids: string[];
};

export type LifecycleLineProvenanceFinding = {
  line_id: string;
  quote_action_id: string;
  action_type: string | null;
  source_asset_id: string | null;
  provenance_status: 'linked_via_quoteaction';
  evidence: EvidenceItem[];
};

export type SupportingAssetRef = {
  asset_id: string;
  ref_source: 'quote_action' | 'selector';
  match_status: 'observed_in_quoteaction' | 'requested_and_observed' | 'requested_not_observed' | 'unverified';
  linked_action_ids: string[];
  linked_action_types: string[];
};

export type VerifyLifecycleProvenanceResult = {
  quote_classification: LifecycleQuoteClassification;
  line_provenance_findings: LifecycleLineProvenanceFinding[];
  action_overlay: OverlayActionsResult;
  supporting_asset_refs: SupportingAssetRef[];
  recommended_next_commands: string[];
};

export type VerifyLifecycleProvenanceExecution = {
  envelope: ResultEnvelope;
  text: string;
  exitCode: 0 | 1;
};

export type BuildVerifyLifecycleProvenanceEnvelopeInput = {
  globalFlags: GlobalFlags;
  commandFlags: VerifyLifecycleProvenanceCommandFlags;
  overlayActions: OverlayActionsPrimitiveResult;
  generatedAt?: string;
  durationMs?: number;
};

export type VerifyLifecycleProvenanceCommandDependencies = {
  executeOverlayActions?: (input: ExecuteOverlayActionsInput) => Promise<OverlayActionsPrimitiveResult>;
};

export async function parseVerifyLifecycleProvenanceFlags(argv: string[]): Promise<VerifyLifecycleProvenanceCommandFlags> {
  const parsed = (await Parser.parse(argv, {
    args: {},
    enableJsonFlag: false,
    flags: VERIFY_LIFECYCLE_PROVENANCE_FLAG_DEFINITIONS,
    strict: true
  })) as {
    flags: {
      'quote-id': string;
      'line-id'?: string[];
      'asset-id'?: string[];
    };
  };

  return {
    quoteId: normalizeOptionalId(parsed.flags['quote-id'], 'quote-id') ?? '',
    lineIds: normalizeRepeatableIds(parsed.flags['line-id'], 'line-id'),
    assetIds: normalizeRepeatableIds(parsed.flags['asset-id'], 'asset-id')
  };
}

export function renderVerifyLifecycleProvenanceHelp(): string {
  return VERIFY_LIFECYCLE_PROVENANCE_HELP_TEXT;
}

export function buildVerifyLifecycleProvenanceEnvelope(
  input: BuildVerifyLifecycleProvenanceEnvelopeInput
): ResultEnvelope {
  if (!input.globalFlags.orgAlias) {
    throw new Error('verify-lifecycle-provenance envelope requires a resolved org alias.');
  }

  const result = buildVerifyLifecycleProvenanceResult(input);
  const status = determineVerifyLifecycleProvenanceStatus(input, result);

  return makeEnvelope({
    command: 'verify-lifecycle-provenance',
    status,
    summary: {
      primary_subject: buildPrimarySubject(input.commandFlags),
      status_reason: buildVerifyLifecycleProvenanceStatusReason(status, input, result),
      primary_lane: 'lifecycle_provenance',
      verification_anchor: buildVerificationAnchor(input.commandFlags),
      next_suggested_command: result.recommended_next_commands[0] ?? null,
      key_counts: {
        line_provenance_findings: result.line_provenance_findings.length,
        action_rows: result.action_overlay.action_rows.length,
        supporting_asset_refs: result.supporting_asset_refs.length
      }
    } satisfies Record<string, JsonValue>,
    result: verifyLifecycleProvenanceResultToJsonRecord(result),
    warnings: [...input.overlayActions.warnings],
    errors: [...input.overlayActions.errors],
    evidence: buildVerifyLifecycleProvenanceEvidence(input, result, status),
    meta: {
      org_alias: input.globalFlags.orgAlias,
      generated_at: input.generatedAt ?? new Date().toISOString(),
      duration_ms: input.durationMs ?? 0,
      source_files: []
    }
  });
}

export function renderVerifyLifecycleProvenanceText(envelope: ResultEnvelope): string {
  const result = envelope.result as unknown as VerifyLifecycleProvenanceResult;
  const lines = [
    'quote-runtime verify-lifecycle-provenance',
    `status: ${envelope.status}`,
    `org alias: ${envelope.meta.org_alias}`,
    `quote id: ${result.quote_classification.quote_id}`,
    `classification: ${result.quote_classification.classification}`,
    `action types: ${formatStringList(result.quote_classification.action_types)}`,
    `line provenance findings: ${result.line_provenance_findings.length}`,
    `supporting asset refs: ${result.supporting_asset_refs.length}`,
    `recommended next commands: ${formatStringList(result.recommended_next_commands)}`
  ];

  if (result.line_provenance_findings.length > 0) {
    lines.push('');
    lines.push('Line provenance findings:');
    for (const finding of result.line_provenance_findings) {
      lines.push(
        `- ${finding.line_id} -> ${finding.quote_action_id} type=${finding.action_type ?? '-'} source_asset_id=${finding.source_asset_id ?? '-'}`
      );
    }
  }

  if (result.supporting_asset_refs.length > 0) {
    lines.push('');
    lines.push('Supporting asset refs:');
    for (const ref of result.supporting_asset_refs) {
      lines.push(`- ${ref.asset_id}: ${ref.match_status} via ${ref.ref_source}`);
    }
  }

  if (envelope.warnings.length > 0) {
    lines.push('');
    lines.push('Warnings:');
    for (const warning of envelope.warnings) {
      lines.push(`- ${warning}`);
    }
  }

  if (envelope.errors.length > 0) {
    lines.push('');
    lines.push('Errors:');
    for (const error of envelope.errors) {
      lines.push(`- ${error}`);
    }
  }

  lines.push('');
  return lines.join('\n');
}

const VERIFY_LIFECYCLE_PROVENANCE_SPEC: EnvelopeCommandSpec<VerifyLifecycleProvenanceCommandDependencies> = {
  commandName: 'verify-lifecycle-provenance',
  execute: async ({ argv, globalFlags, startedAt, deps }) => {
    const commandFlags = await parseVerifyLifecycleProvenanceFlags(argv);
    const runOverlayActions = deps.executeOverlayActions ?? executeOverlayActions;
    const overlayActions = await runOverlayActions({
      orgAlias: globalFlags.orgAlias!,
      quoteId: commandFlags.quoteId,
      lineIds: commandFlags.lineIds
    });
    return buildVerifyLifecycleProvenanceEnvelope({
      globalFlags,
      commandFlags,
      overlayActions,
      durationMs: Math.max(0, Date.now() - startedAt)
    });
  },
  renderText: renderVerifyLifecycleProvenanceText
};

export async function runVerifyLifecycleProvenanceCommand(
  argv: string[],
  globalFlags: GlobalFlags,
  io: CliIo,
  dependencies: VerifyLifecycleProvenanceCommandDependencies = {}
): Promise<VerifyLifecycleProvenanceExecution> {
  return runEnvelopeCommand(VERIFY_LIFECYCLE_PROVENANCE_SPEC, argv, globalFlags, io, dependencies);
}

function buildVerifyLifecycleProvenanceResult(
  input: BuildVerifyLifecycleProvenanceEnvelopeInput
): VerifyLifecycleProvenanceResult {
  const lineProvenanceFindings = buildLineProvenanceFindings(input.overlayActions.result.line_action_links);
  const supportingAssetRefs = buildSupportingAssetRefs(input.overlayActions.result.action_rows, input.commandFlags.assetIds);
  return {
    quote_classification: buildQuoteClassification(input.commandFlags.quoteId, input.overlayActions),
    line_provenance_findings: lineProvenanceFindings,
    action_overlay: input.overlayActions.result,
    supporting_asset_refs: supportingAssetRefs,
    recommended_next_commands: buildRecommendedNextCommands(lineProvenanceFindings)
  };
}

function buildLineProvenanceFindings(lineActionLinks: readonly OverlayActionLineLink[]): LifecycleLineProvenanceFinding[] {
  return lineActionLinks.map((link) => ({
    line_id: link.line_id,
    quote_action_id: link.quote_action_id,
    action_type: link.action_type,
    source_asset_id: link.source_asset_id,
    provenance_status: 'linked_via_quoteaction',
    evidence: [{
      claim: `Quote line ${link.line_id} is lifecycle-linked through QuoteAction ${link.quote_action_id}.`,
      evidence_level: 'org_proven',
      proof_source: ['QuoteLineItem.QuoteActionId', 'QuoteAction.Id', 'QuoteAction.Type', 'QuoteAction.SourceAssetId'],
      limitations: 'Lifecycle provenance is limited to QuoteAction evidence only and does not imply bundle or structure semantics.',
      source_refs: []
    }]
  }));
}

function buildSupportingAssetRefs(
  actionRows: readonly OverlayActionRecord[],
  requestedAssetIds: readonly string[]
): SupportingAssetRef[] {
  const observed = new Map<string, SupportingAssetRef>();

  for (const row of actionRows) {
    const assetId = normalizeJsonString(row.SourceAssetId);
    if (assetId === null) {
      continue;
    }

    const existing = observed.get(assetId) ?? {
      asset_id: assetId,
      ref_source: 'quote_action' as const,
      match_status: 'observed_in_quoteaction' as const,
      linked_action_ids: [],
      linked_action_types: []
    };
    const actionId = normalizeJsonString(row.Id);
    const actionType = normalizeJsonString(row.Type);
    if (actionId !== null && !existing.linked_action_ids.includes(actionId)) {
      existing.linked_action_ids.push(actionId);
    }
    if (actionType !== null && !existing.linked_action_types.includes(actionType)) {
      existing.linked_action_types.push(actionType);
    }
    observed.set(assetId, existing);
  }

  for (const assetId of requestedAssetIds) {
    const existing = observed.get(assetId);
    if (existing) {
      existing.match_status = 'requested_and_observed';
      continue;
    }

    observed.set(assetId, {
      asset_id: assetId,
      ref_source: 'selector',
      match_status: 'requested_not_observed',
      linked_action_ids: [],
      linked_action_types: []
    });
  }

  return Array.from(observed.values()).sort((left, right) => left.asset_id.localeCompare(right.asset_id));
}

function buildQuoteClassification(
  quoteId: string,
  overlayActions: OverlayActionsPrimitiveResult
): LifecycleQuoteClassification {
  const actionTypes = uniqueStrings(
    overlayActions.result.action_rows.map((row) => normalizeJsonString(row.Type)).filter((value): value is string => value !== null)
  );
  const sourceAssetIds = uniqueStrings(
    overlayActions.result.action_rows.map((row) => normalizeJsonString(row.SourceAssetId)).filter((value): value is string => value !== null)
  );

  if (overlayActions.status === 'error' || overlayActions.status === 'unsupported') {
    return {
      quote_id: quoteId,
      classification: 'verification_incomplete',
      status_reason:
        overlayActions.errors[0] ??
        'Lifecycle provenance verification could not complete cleanly because the QuoteAction overlay was unavailable.',
      action_types: actionTypes,
      source_asset_ids: sourceAssetIds
    };
  }

  if (actionTypes.length > 0) {
    return {
      quote_id: quoteId,
      classification: 'lifecycle_quote',
      status_reason: 'QuoteAction rows were present for the targeted quote scope, so lifecycle provenance is supported.',
      action_types: actionTypes,
      source_asset_ids: sourceAssetIds
    };
  }

  return {
    quote_id: quoteId,
    classification: 'no_lifecycle_overlay_found',
    status_reason: 'No QuoteAction rows were found for the targeted quote scope.',
    action_types: [],
    source_asset_ids: []
  };
}

function buildRecommendedNextCommands(lineProvenanceFindings: readonly LifecycleLineProvenanceFinding[]): string[] {
  return lineProvenanceFindings.length > 0
    ? ['snapshot-lines', 'inspect-rlm-context']
    : ['snapshot-lines', 'inspect-rlm-context'];
}

function determineVerifyLifecycleProvenanceStatus(
  input: BuildVerifyLifecycleProvenanceEnvelopeInput,
  result: VerifyLifecycleProvenanceResult
): RuntimeStatus {
  const overlayStatus = input.overlayActions.status;
  if (overlayStatus === 'error' || overlayStatus === 'unsupported' || overlayStatus === 'no_match') {
    return overlayStatus;
  }

  const unmatchedRequestedAssetCount = result.supporting_asset_refs.filter(
    (ref) => ref.match_status === 'requested_not_observed'
  ).length;

  if (unmatchedRequestedAssetCount > 0 && result.line_provenance_findings.length > 0) {
    return 'partial';
  }

  if (unmatchedRequestedAssetCount > 0) {
    return 'no_match';
  }

  return result.line_provenance_findings.length > 0 ? 'ok' : 'no_match';
}

function buildVerifyLifecycleProvenanceStatusReason(
  status: RuntimeStatus,
  input: BuildVerifyLifecycleProvenanceEnvelopeInput,
  result: VerifyLifecycleProvenanceResult
): string {
  if (status === 'error' || status === 'unsupported') {
    return input.overlayActions.errors[0] ?? result.quote_classification.status_reason;
  }

  if (status === 'no_match' && input.overlayActions.status === 'no_match') {
    return input.overlayActions.status_detail === 'quote_absent'
      ? `No persisted Quote row matched ${input.commandFlags.quoteId}.`
      : `No requested quote lines matched ${input.commandFlags.quoteId}.`;
  }

  const unmatchedRequestedAssetCount = result.supporting_asset_refs.filter(
    (ref) => ref.match_status === 'requested_not_observed'
  ).length;

  if (status === 'partial') {
    return `Verified lifecycle provenance for ${result.line_provenance_findings.length} line(s), but ${unmatchedRequestedAssetCount} requested asset id(s) were not observed in QuoteAction evidence.`;
  }

  if (result.line_provenance_findings.length > 0) {
    return `Verified lifecycle provenance for ${result.line_provenance_findings.length} line(s) on quote ${input.commandFlags.quoteId} using QuoteAction only.`;
  }

  if (unmatchedRequestedAssetCount > 0) {
    return `No requested asset ids were observed in QuoteAction evidence for ${input.commandFlags.quoteId}.`;
  }

  return result.quote_classification.status_reason;
}

function buildVerifyLifecycleProvenanceEvidence(
  input: BuildVerifyLifecycleProvenanceEnvelopeInput,
  result: VerifyLifecycleProvenanceResult,
  status: RuntimeStatus
): EvidenceItem[] {
  const evidence: EvidenceItem[] = [];

  if ((status === 'ok' || status === 'partial') && result.line_provenance_findings.length > 0) {
    evidence.push({
      claim: buildVerifyLifecycleProvenanceStatusReason(status, input, result),
      evidence_level: 'org_proven',
      proof_source: [
        'QuoteLineItem.QuoteActionId',
        'QuoteAction.Id',
        'QuoteAction.Type',
        'QuoteAction.SourceAssetId',
        `quote:${input.commandFlags.quoteId}`,
        ...result.line_provenance_findings.map((finding) => `line:${finding.line_id}`),
        ...result.line_provenance_findings.map((finding) => `quote_action:${finding.quote_action_id}`)
      ],
      limitations:
        status === 'partial'
          ? 'Lifecycle provenance is verified from QuoteAction evidence for the linked lines only; some requested asset ids were not observed.'
          : 'Lifecycle provenance is verified from QuoteAction evidence only and does not imply bundle or structure semantics.',
      source_refs: []
    });
  }

  evidence.push(
    ...input.overlayActions.evidence,
    {
      claim:
        'verify-lifecycle-provenance uses QuoteAction lifecycle provenance only and does not rely on QuoteLineRelationship structural semantics.',
      evidence_level: 'repo_proven',
      proof_source: ['commands/verify-lifecycle-provenance.ts', 'primitives/overlay-actions.ts'],
      limitations: 'Structure and bundle interpretation remain outside this command scope.',
      source_refs: []
    }
  );

  return evidence;
}

function verifyLifecycleProvenanceResultToJsonRecord(
  result: VerifyLifecycleProvenanceResult
): Record<string, JsonValue> {
  return {
    quote_classification: lifecycleQuoteClassificationToJsonValue(result.quote_classification),
    line_provenance_findings: result.line_provenance_findings.map((finding) => lineProvenanceFindingToJsonValue(finding)),
    action_overlay: overlayActionsResultToJsonValue(result.action_overlay),
    supporting_asset_refs: result.supporting_asset_refs.map((ref) => supportingAssetRefToJsonValue(ref)),
    recommended_next_commands: [...result.recommended_next_commands]
  };
}

function lifecycleQuoteClassificationToJsonValue(classification: LifecycleQuoteClassification): JsonValue {
  return {
    quote_id: classification.quote_id,
    classification: classification.classification,
    status_reason: classification.status_reason,
    action_types: [...classification.action_types],
    source_asset_ids: [...classification.source_asset_ids]
  };
}

function lineProvenanceFindingToJsonValue(finding: LifecycleLineProvenanceFinding): JsonValue {
  return {
    line_id: finding.line_id,
    quote_action_id: finding.quote_action_id,
    action_type: finding.action_type,
    source_asset_id: finding.source_asset_id,
    provenance_status: finding.provenance_status,
    evidence: finding.evidence as JsonValue[]
  };
}

function overlayActionsResultToJsonValue(result: OverlayActionsResult): JsonValue {
  return {
    quote_id: result.quote_id,
    field_set: [...result.field_set],
    action_rows: result.action_rows as OverlayActionRecord[],
    line_action_links: result.line_action_links.map((link) => ({
      line_id: link.line_id,
      quote_action_id: link.quote_action_id,
      action_type: link.action_type,
      source_asset_id: link.source_asset_id
    })),
    provenance_summary: result.provenance_summary
  };
}

function supportingAssetRefToJsonValue(ref: SupportingAssetRef): JsonValue {
  return {
    asset_id: ref.asset_id,
    ref_source: ref.ref_source,
    match_status: ref.match_status,
    linked_action_ids: [...ref.linked_action_ids],
    linked_action_types: [...ref.linked_action_types]
  };
}

function buildPrimarySubject(commandFlags: VerifyLifecycleProvenanceCommandFlags): string {
  const parts: string[] = [];
  if (commandFlags.lineIds.length > 0) {
    parts.push(`${commandFlags.lineIds.length} scoped line id(s)`);
  }
  if (commandFlags.assetIds.length > 0) {
    parts.push(`${commandFlags.assetIds.length} scoped asset id(s)`);
  }
  return parts.length > 0 ? `${commandFlags.quoteId} (${parts.join(', ')})` : commandFlags.quoteId;
}

function buildVerificationAnchor(commandFlags: VerifyLifecycleProvenanceCommandFlags): string {
  const segments = [`quote:${commandFlags.quoteId}`];
  if (commandFlags.lineIds.length > 0) {
    segments.push(`lines:${commandFlags.lineIds.join(',')}`);
  }
  if (commandFlags.assetIds.length > 0) {
    segments.push(`assets:${commandFlags.assetIds.join(',')}`);
  }
  return segments.join(':');
}

function uniqueStrings(values: readonly string[]): string[] {
  return Array.from(new Set(values));
}

function normalizeJsonString(value: JsonValue): string | null {
  return typeof value === 'string' && value.length > 0 ? value : null;
}

function formatStringList(values: readonly string[]): string {
  return values.length > 0 ? values.join(', ') : '(none)';
}

// ---------------------------------------------------------------------------
// CommandSpec (Q3: defineCommand consolidation)
// ---------------------------------------------------------------------------
import { defineCommand, WAVE_GROUP_NAMES } from './spec';

export const VERIFY_LIFECYCLE_PROVENANCE_COMMAND_SPEC = defineCommand({
  name: 'verify-lifecycle-provenance',
  wave: 3,
  group_name: WAVE_GROUP_NAMES[3],
  summary: 'Verify QuoteAction-backed lifecycle provenance for a quote and optional scoped lines or assets.',
  ownership: {
        primary_owner: 'pricing-runtime-debug',
        secondary_escalation: ['quote-runtime-mutations'],
        shared_library_dependencies: ['overlay_actions', 'selectors', 'evidence']
  },
  selectorPolicy: {
        required_selectors: ['quote_id'],
        recommended_selectors: ['line_ids', 'asset_ids'],
        status_reason: 'Lifecycle provenance checks require a target quote.'
  },
    quickStart: 'quote-runtime verify-lifecycle-provenance --org-alias <alias> --quote-id <id> --line-id <id> --asset-id <id>',
  renderHelp: renderVerifyLifecycleProvenanceHelp,
  run: runVerifyLifecycleProvenanceCommand
});
