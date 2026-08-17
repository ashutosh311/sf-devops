import { createResultEnvelope, type EvidenceEntry, type MessageEntry, type ResultEnvelope, type Status } from '@sdlc/rca-cli-core';

export const SFX_TOOL_VERSION = '0.0.0';

export interface DiscoveryCommandMeta {
  run_id: string;
  command_execution_id: string;
  command_slug: string;
  produced_at: string;
  tool_version: string;
  output_artifact_paths: string[];
  evidence_artifact_paths: string[];
  log_artifact_path: string;
  recommended_next_commands?: string[];
  stats?: Record<string, number>;
  effective_fail_on?: Status;
  machine_readable_command_registry?: string;
}

export interface CreateDiscoveryEnvelopeInput<TResult> {
  command: string;
  status: Status;
  summary: string;
  result: TResult;
  meta: DiscoveryCommandMeta;
  warnings?: MessageEntry[];
  errors?: MessageEntry[];
  evidence?: EvidenceEntry[];
}

export function createDiscoveryEnvelope<TResult>(input: CreateDiscoveryEnvelopeInput<TResult>): ResultEnvelope<TResult, DiscoveryCommandMeta> {
  return createResultEnvelope({
    command: input.command,
    status: input.status,
    summary: input.summary,
    result: input.result,
    warnings: input.warnings ?? [],
    errors: input.errors ?? [],
    meta: input.meta,
    evidence: input.evidence ?? [],
  });
}

export interface ArtifactMetaInput {
  runId: string;
  commandExecutionId: string;
  commandSlug: string;
  producedAt?: string;
  outputArtifactPaths: string[];
  evidenceArtifactPaths?: string[];
  logArtifactPath: string;
  recommendedNextCommands?: string[];
  stats?: Record<string, number>;
  effectiveFailOn?: Status;
}

export function createDiscoveryCommandMeta(input: ArtifactMetaInput): DiscoveryCommandMeta {
  return {
    run_id: input.runId,
    command_execution_id: input.commandExecutionId,
    command_slug: input.commandSlug,
    produced_at: input.producedAt ?? new Date().toISOString(),
    tool_version: SFX_TOOL_VERSION,
    output_artifact_paths: [...input.outputArtifactPaths],
    evidence_artifact_paths: [...(input.evidenceArtifactPaths ?? [])],
    log_artifact_path: input.logArtifactPath,
    recommended_next_commands: input.recommendedNextCommands ? [...input.recommendedNextCommands] : undefined,
    stats: input.stats ? { ...input.stats } : undefined,
    effective_fail_on: input.effectiveFailOn,
    machine_readable_command_registry: 'sfx commands --json',
  };
}
