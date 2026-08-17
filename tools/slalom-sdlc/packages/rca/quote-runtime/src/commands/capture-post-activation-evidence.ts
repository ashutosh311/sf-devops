import { Flags, Parser } from '@oclif/core';

import type { GlobalFlags } from '../cli/global-flags';
import { emitJsonOutput, emitTextOutput, type CliIo } from '../cli/output';
import { runEnvelopeCommand, type EnvelopeCommandSpec } from '../cli/run-envelope-command';
import { exitCodeForStatus, makeEnvelope, type ResultEnvelope } from '../contracts/result-envelope';
import {
  executeCapturePostActivationEvidence,
  type ExecuteCapturePostActivationEvidenceInput,
  type CapturePostActivationEvidencePrimitiveResult
} from '../primitives/capture-post-activation-evidence';

export const CAPTURE_POST_ACTIVATION_EVIDENCE_HELP_TEXT = [
  'quote-runtime capture-post-activation-evidence',
  '',
  'Usage:',
  '  quote-runtime capture-post-activation-evidence --org-alias <alias> (--order-id <id> | --asset-id <id>) [--json] [--fail-on <status>] [--output <path>] [--verbose]',
  '',
  'Notes:',
  '  Reads Asset, AssetAction, and AssetStatePeriod records after order activation.',
  '  Pivots from --order-id (resolves assets via OrderItem.Id -> AssetActionSource.ReferenceEntityItemId -> AssetAction.AssetId) or direct --asset-id.',
  '  Output feeds inspect-asset-lifecycle and verify-lifecycle-provenance.',
  '  Does not mutate any records.'
].join('\n');

const FLAGS = {
  'order-id': Flags.string({ required: false }),
  'asset-id': Flags.string({ required: false, multiple: true })
};

export type CapturePostActivationEvidenceCommandFlags = {
  orderId?: string | null;
  assetIds: string[];
};

export type CapturePostActivationEvidenceCommandDependencies = {
  executeCapturePostActivationEvidence?: (input: ExecuteCapturePostActivationEvidenceInput) => Promise<CapturePostActivationEvidencePrimitiveResult>;
};

export function renderCapturePostActivationEvidenceHelp(): string {
  return CAPTURE_POST_ACTIVATION_EVIDENCE_HELP_TEXT;
}

export async function parseCapturePostActivationEvidenceFlags(argv: string[]): Promise<CapturePostActivationEvidenceCommandFlags> {
  const parsed = (await Parser.parse(argv, {
    args: {},
    enableJsonFlag: false,
    flags: FLAGS,
    strict: true
  })) as {
    flags: {
      'order-id'?: string;
      'asset-id'?: string[];
    };
  };

  return {
    orderId: parsed.flags['order-id'] ?? null,
    assetIds: parsed.flags['asset-id'] ?? []
  };
}

const CAPTURE_POST_ACTIVATION_EVIDENCE_SPEC: EnvelopeCommandSpec<CapturePostActivationEvidenceCommandDependencies> = {
  commandName: 'capture-post-activation-evidence',
  execute: async ({ argv, globalFlags, startedAt, deps }) => {
    const commandFlags = await parseCapturePostActivationEvidenceFlags(argv);

    if (!commandFlags.orderId && commandFlags.assetIds.length === 0) {
      throw new Error('The capture-post-activation-evidence command requires either --order-id or at least one --asset-id.');
    }

    const primitive = await (deps.executeCapturePostActivationEvidence ?? executeCapturePostActivationEvidence)({
      orgAlias: globalFlags.orgAlias!,
      orderId: commandFlags.orderId,
      assetIds: commandFlags.assetIds
    });

    const assetCount = primitive.result.packet.assets.length;
    const evidenceStatus = primitive.result.packet.evidence_status;

    return makeEnvelope({
      command: 'capture-post-activation-evidence',
      status: primitive.status,
      summary: {
        primary_subject: commandFlags.orderId ?? commandFlags.assetIds[0] ?? 'activation-evidence',
        status_reason: `${assetCount} asset(s) captured; evidence_status=${evidenceStatus}; ${primitive.warnings.length} warning(s).`,
        primary_lane: 'asset_activation_evidence',
        next_suggested_command: assetCount > 0 ? 'inspect-asset-lifecycle' : 'activate-order'
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
  renderText: renderCapturePostActivationEvidenceText
};

export async function runCapturePostActivationEvidenceCommand(
  argv: string[],
  globalFlags: GlobalFlags,
  io: CliIo,
  dependencies: CapturePostActivationEvidenceCommandDependencies = {}
): Promise<{ envelope: ResultEnvelope; text: string; exitCode: 0 | 1 }> {
  return runEnvelopeCommand(CAPTURE_POST_ACTIVATION_EVIDENCE_SPEC, argv, globalFlags, io, dependencies);
}

export function renderCapturePostActivationEvidenceText(envelope: ResultEnvelope): string {
  const result = envelope.result as unknown as {
    packet: {
      order_id: string | null;
      asset_ids_queried: string[];
      assets: Array<{ id: string; status: string | null }>;
      asset_actions: Array<{ id: string; type: string | null }>;
      asset_state_periods: Array<{ id: string }>;
      evidence_status: string;
      gaps: string[];
    };
  };

  const lines = [
    'quote-runtime capture-post-activation-evidence',
    `status: ${envelope.status}`,
    `order id: ${result.packet?.order_id ?? '(direct asset ids)'}`,
    `assets captured: ${String(result.packet?.assets?.length ?? 0)}`,
    `asset actions: ${String(result.packet?.asset_actions?.length ?? 0)}`,
    `asset state periods: ${String(result.packet?.asset_state_periods?.length ?? 0)}`,
    `evidence status: ${result.packet?.evidence_status ?? '(unknown)'}`,
    `next: ${String(envelope.summary.next_suggested_command ?? '')}`
  ];

  if ((result.packet?.gaps ?? []).length > 0) {
    lines.push('gaps:');
    lines.push(...(result.packet.gaps).map((gap) => `- ${gap}`));
  }

  if (envelope.warnings.length > 0) {
    lines.push('warnings:');
    lines.push(...envelope.warnings.map((warning) => `- ${warning}`));
  }

  lines.push('');
  return lines.join('\n');
}

function toJsonRecord(value: unknown): Record<string, import('../contracts/result-envelope').JsonValue> {
  return JSON.parse(JSON.stringify(value)) as Record<string, import('../contracts/result-envelope').JsonValue>;
}

// ---------------------------------------------------------------------------
// CommandSpec (Q3: defineCommand consolidation)
// ---------------------------------------------------------------------------
import { defineCommand, WAVE_GROUP_NAMES } from './spec';

export const CAPTURE_POST_ACTIVATION_EVIDENCE_COMMAND_SPEC = defineCommand({
  name: 'capture-post-activation-evidence',
  wave: 3,
  group_name: WAVE_GROUP_NAMES[3],
  summary: 'Capture Asset, AssetAction, and AssetStatePeriod evidence after order activation.',
  ownership: {
        primary_owner: 'runtime-context-inspection',
        secondary_escalation: ['quote-runtime-mutations'],
        shared_library_dependencies: ['selectors', 'evidence']
  },
  selectorPolicy: {
        required_selectors: [],
        recommended_selectors: [],
        status_reason: 'Post-activation evidence capture requires --order-id or --asset-id at command parse time.'
  },
    quickStart: 'quote-runtime capture-post-activation-evidence --org-alias <alias> --order-id <id>',
  renderHelp: renderCapturePostActivationEvidenceHelp,
  run: runCapturePostActivationEvidenceCommand
});
