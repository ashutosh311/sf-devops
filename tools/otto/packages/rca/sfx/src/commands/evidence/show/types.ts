import type { ResultEnvelope, Status } from '@otto/rca-cli-core';

import type { DiscoveryCommandMeta } from '../../../runtime/envelope';
import type { LocalFileRunManager, RunCommandRecord } from '../../../runtime/run-manager';

export interface EvidenceShowOwningCommand {
  command_execution_id: string;
  command_slug: string;
  command: string;
  status: Status;
}

export interface EvidenceShowResult {
  inspected_run_id: string;
  evidence_id: string;
  artifact_path: string;
  owning_command: EvidenceShowOwningCommand | null;
  evidence_artifact: unknown | null;
}

export type EvidenceShowEnvelope = ResultEnvelope<EvidenceShowResult, DiscoveryCommandMeta>;

export interface ExecuteEvidenceShowOptions {
  repoRoot: string;
  artifactRoot?: string;
  runId: string;
  evidenceId: string;
  appendRunId?: string;
  newRun?: boolean;
  failOn?: Status;
  runManager?: LocalFileRunManager;
}

export interface EvidenceShowExecutionResult {
  envelope: EvidenceShowEnvelope;
  runFilePath: string;
  outputArtifactPath: string;
  logArtifactPath: string;
}

export function toEvidenceShowOwningCommand(command: RunCommandRecord | undefined): EvidenceShowOwningCommand | null {
  if (!command) {
    return null;
  }

  return {
    command_execution_id: command.command_execution_id,
    command_slug: command.command_slug,
    command: command.command,
    status: command.status,
  };
}
