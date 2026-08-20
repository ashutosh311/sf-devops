import { Flags, Parser } from '@oclif/core';

import type { GlobalFlags } from '../cli/global-flags';
import { emitJsonOutput, emitTextOutput, type CliIo } from '../cli/output';
import { runEnvelopeCommand, type EnvelopeCommandSpec } from '../cli/run-envelope-command';
import { exitCodeForStatus, makeEnvelope, type ResultEnvelope } from '../contracts/result-envelope';
import {
  executeInspectAssetLifecycle,
  type ExecuteInspectAssetLifecycleInput,
  type InspectAssetLifecyclePrimitiveResult
} from '../primitives/asset-lifecycle';

export const INSPECT_ASSET_LIFECYCLE_HELP_TEXT = [
  'quote-runtime inspect-asset-lifecycle',
  '',
  'Usage:',
  '  quote-runtime inspect-asset-lifecycle --org-alias <alias> --asset-id <id> [--asset-id <id>] [--account-id <id>] [--json] [--fail-on <status>] [--output <path>] [--verbose]',
  '',
  'Notes:',
  '  Reads Asset, AssetAction, and AssetStatePeriod to determine lifecycle state.',
  '  Reports assetized status, active state periods, and amendable/renewable/cancellable flags.',
  '  Non-assetized assets surface a warning with remediation hint, not a failure.',
  '  Does not mutate any records.'
].join('\n');

const FLAGS = {
  'asset-id': Flags.string({ required: true, multiple: true }),
  'account-id': Flags.string({ required: false })
};

export type InspectAssetLifecycleCommandFlags = {
  assetIds: string[];
  accountId?: string | null;
};

export type InspectAssetLifecycleCommandDependencies = {
  executeInspectAssetLifecycle?: (input: ExecuteInspectAssetLifecycleInput) => Promise<InspectAssetLifecyclePrimitiveResult>;
};

export function renderInspectAssetLifecycleHelp(): string {
  return INSPECT_ASSET_LIFECYCLE_HELP_TEXT;
}

export async function parseInspectAssetLifecycleFlags(argv: string[]): Promise<InspectAssetLifecycleCommandFlags> {
  const parsed = (await Parser.parse(argv, {
    args: {},
    enableJsonFlag: false,
    flags: FLAGS,
    strict: true
  })) as {
    flags: {
      'asset-id': string[];
      'account-id'?: string;
    };
  };

  return {
    assetIds: parsed.flags['asset-id'],
    accountId: parsed.flags['account-id'] ?? null
  };
}

const INSPECT_ASSET_LIFECYCLE_SPEC: EnvelopeCommandSpec<InspectAssetLifecycleCommandDependencies> = {
  commandName: 'inspect-asset-lifecycle',
  execute: async ({ argv, globalFlags, startedAt, deps }) => {
    const commandFlags = await parseInspectAssetLifecycleFlags(argv);
    const primitive = await (deps.executeInspectAssetLifecycle ?? executeInspectAssetLifecycle)({
      orgAlias: globalFlags.orgAlias!,
      assetIds: commandFlags.assetIds,
      accountId: commandFlags.accountId
    });

    const allAssetized = primitive.result.precondition_summary.all_assetized;
    const assetCount = primitive.result.assets.length;

    return makeEnvelope({
      command: 'inspect-asset-lifecycle',
      status: primitive.status,
      summary: {
        primary_subject: commandFlags.assetIds[0] ?? 'asset-lifecycle',
        status_reason: `${assetCount} asset(s) inspected; all_assetized=${String(allAssetized)}; ${primitive.warnings.length} warning(s).`,
        primary_lane: 'asset_lifecycle_inspection',
        next_suggested_command: allAssetized ? 'plan-order-activation' : 'activate-order'
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
  renderText: renderInspectAssetLifecycleText
};

export async function runInspectAssetLifecycleCommand(
  argv: string[],
  globalFlags: GlobalFlags,
  io: CliIo,
  dependencies: InspectAssetLifecycleCommandDependencies = {}
): Promise<{ envelope: ResultEnvelope; text: string; exitCode: 0 | 1 }> {
  return runEnvelopeCommand(INSPECT_ASSET_LIFECYCLE_SPEC, argv, globalFlags, io, dependencies);
}

export function renderInspectAssetLifecycleText(envelope: ResultEnvelope): string {
  const result = envelope.result as unknown as {
    assets: Array<{ id: string; status: string | null; assetized: boolean; amendable: boolean; renewable: boolean; cancellable: boolean }>;
    precondition_summary: { all_assetized: boolean; warnings: string[] };
  };

  const lines = [
    'quote-runtime inspect-asset-lifecycle',
    `status: ${envelope.status}`,
    `reason: ${String(envelope.summary.status_reason ?? '')}`,
    `next: ${String(envelope.summary.next_suggested_command ?? '')}`,
    '',
    'Assets:'
  ];

  for (const asset of result.assets ?? []) {
    lines.push(`  - ${asset.id}: status=${String(asset.status)} assetized=${String(asset.assetized)} amendable=${String(asset.amendable)}`);
  }

  if ((result.precondition_summary?.warnings ?? []).length > 0) {
    lines.push('');
    lines.push('Precondition warnings:');
    for (const warning of result.precondition_summary.warnings) {
      lines.push(`  - ${warning}`);
    }
  }

  if (envelope.warnings.length > 0) {
    lines.push('');
    lines.push('Warnings:');
    for (const warning of envelope.warnings) {
      lines.push(`  - ${warning}`);
    }
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

export const INSPECT_ASSET_LIFECYCLE_COMMAND_SPEC = defineCommand({
  name: 'inspect-asset-lifecycle',
  wave: 3,
  group_name: WAVE_GROUP_NAMES[3],
  summary: 'Read Asset, AssetAction, and AssetStatePeriod to determine lifecycle state, assetized status, and amend/renew/cancel eligibility.',
  ownership: {
        primary_owner: 'runtime-context-inspection',
        secondary_escalation: ['quote-runtime-mutations'],
        shared_library_dependencies: ['selectors', 'evidence']
  },
  selectorPolicy: {
        required_selectors: ['asset_ids'],
        recommended_selectors: [],
        status_reason: 'Asset lifecycle inspection requires at least one target asset id.'
  },
    quickStart: 'quote-runtime inspect-asset-lifecycle --org-alias <alias> --asset-id <id>',
  renderHelp: renderInspectAssetLifecycleHelp,
  run: runInspectAssetLifecycleCommand
});
