import { existsSync, readFileSync } from 'node:fs';

import { createDiscoveryCommandMeta, createDiscoveryEnvelope } from '../../../runtime/envelope';
import { assertCanonicalEvidenceId, assertCanonicalRunId, getEvidenceArtifactRelativePath, getRunArtifactPaths, resolveRunRelativePath } from '../../../runtime/artifacts';
import { commandToSlug } from '../../../runtime/ids';
import { LocalFileRunManager } from '../../../runtime/run-manager';
import type { ExecuteEvidenceShowOptions, EvidenceShowExecutionResult, EvidenceShowResult } from './types';
import { toEvidenceShowOwningCommand } from './types';

const EVIDENCE_SHOW_COMMAND = 'sfx evidence show';

function shellQuote(value: string): string {
  return /^[A-Za-z0-9_./:-]+$/.test(value)
    ? value
    : `'${value.replace(/'/g, `'\\''`)}'`;
}

function buildEvidenceShowCommand(runId: string, evidenceId: string): string {
  return `${EVIDENCE_SHOW_COMMAND} --run-id ${shellQuote(runId)} --evidence-id ${shellQuote(evidenceId)} --json`;
}

function readJsonFile<T>(filePath: string): T {
  return JSON.parse(readFileSync(filePath, 'utf8')) as T;
}

function buildSuccessSummary(evidenceId: string, runId: string): string {
  return `Loaded saved evidence artifact ${evidenceId} from run ${runId}.`;
}

function buildErrorSummary(evidenceId: string, runId: string): string {
  return `Could not load saved evidence artifact ${evidenceId} from run ${runId}.`;
}

export function executeEvidenceShow(options: ExecuteEvidenceShowOptions): EvidenceShowExecutionResult {
  const command = buildEvidenceShowCommand(options.runId, options.evidenceId);
  const commandSlug = commandToSlug(EVIDENCE_SHOW_COMMAND);
  const runManager = options.runManager ?? new LocalFileRunManager();
  const invalidAppendRunId = options.appendRunId !== undefined && !options.newRun
    ? (() => {
        try {
          assertCanonicalRunId(options.appendRunId);
          return null;
        } catch {
          return options.appendRunId;
        }
      })()
    : null;
  const prepared = runManager.prepareCommandExecution({
    repoRoot: options.repoRoot,
    artifactRoot: options.artifactRoot,
    command,
    commandSlug,
    inputs: {
      run_id: options.runId,
      evidence_id: options.evidenceId,
    },
    runId: invalidAppendRunId ? undefined : options.appendRunId,
    newRun: options.newRun,
    outputFormat: 'json',
  });

  const artifactRelativePath = `evidence/${options.evidenceId}.json`;

  let status: 'ok' | 'error' = 'ok';
  let summary = buildSuccessSummary(options.evidenceId, options.runId);
  const warnings: Array<{ code: string; message: string }> = [];
  const errors: Array<{ code: string; message: string }> = [];
  const evidence = [{
    label: 'Saved evidence artifact',
    detail: `Normalized view of ${options.evidenceId} from run ${options.runId}.`,
    source: artifactRelativePath,
  }];
  let result: EvidenceShowResult = {
    inspected_run_id: options.runId,
    evidence_id: options.evidenceId,
    artifact_path: artifactRelativePath,
    owning_command: null,
    evidence_artifact: null,
  };

  try {
    if (invalidAppendRunId) {
      throw new Error(`APPEND_RUN_ID_INVALID: ${invalidAppendRunId}`);
    }

    assertCanonicalRunId(options.runId);
    assertCanonicalEvidenceId(options.evidenceId);

    const inspectedRunPaths = getRunArtifactPaths(options.repoRoot, options.runId);

    if (!existsSync(inspectedRunPaths.runFilePath)) {
      throw new Error(`RUN_ID_NOT_FOUND: ${options.runId}`);
    }

    const runRecord = runManager.readRun(inspectedRunPaths.runFilePath);
    const owningCommand = runRecord.commands.find((commandRecord) => commandRecord.evidence_refs.includes(options.evidenceId));
    if (!owningCommand) {
      throw new Error(`EVIDENCE_ID_NOT_FOUND: ${options.evidenceId}`);
    }
    const evidenceArtifact = readJsonFile<unknown>(resolveRunRelativePath(inspectedRunPaths.rootPath, getEvidenceArtifactRelativePath(options.evidenceId)));

    result = {
      inspected_run_id: options.runId,
      evidence_id: options.evidenceId,
      artifact_path: artifactRelativePath,
      owning_command: toEvidenceShowOwningCommand(owningCommand),
      evidence_artifact: evidenceArtifact,
    };
  } catch (error) {
    status = 'error';
    summary = buildErrorSummary(options.evidenceId, options.runId);

    const message = error instanceof Error ? error.message : String(error);
    const code = message.includes(`APPEND_RUN_ID_INVALID: ${invalidAppendRunId ?? ''}`) || message.includes(`RUN_ID_INVALID: ${options.runId}`)
      ? 'RUN_ID_INVALID'
      : message.includes(`RUN_ID_NOT_FOUND: ${options.runId}`)
      ? 'RUN_ID_NOT_FOUND'
      : message.includes(`EVIDENCE_ID_INVALID: ${options.evidenceId}`)
        ? 'EVIDENCE_ID_INVALID'
      : message.includes(`EVIDENCE_ID_NOT_FOUND: ${options.evidenceId}`)
        ? 'EVIDENCE_ID_NOT_FOUND'
        : /RUN_ARTIFACT_INVALID: /i.test(message)
          ? 'RUN_ARTIFACT_INVALID'
      : /ENOENT|no such file or directory/i.test(message)
        ? 'EVIDENCE_ID_NOT_FOUND'
        : /Unexpected token|JSON/i.test(message)
          ? 'EVIDENCE_ARTIFACT_INVALID'
          : 'EVIDENCE_SHOW_FAILED';

    errors.push({
      code,
      message: code === 'EVIDENCE_ID_NOT_FOUND'
        ? `Evidence artifact ${options.evidenceId} was not found in run ${options.runId}.`
        : code === 'RUN_ID_INVALID'
          ? invalidAppendRunId
            ? `Append run id ${invalidAppendRunId} must be a canonical run identifier.`
            : `Run id ${options.runId} must be a canonical run identifier.`
        : code === 'RUN_ID_NOT_FOUND'
          ? `Run ${options.runId} was not found.`
          : code === 'EVIDENCE_ID_INVALID'
            ? `Evidence id ${options.evidenceId} must be a canonical evidence artifact identifier.`
          : code === 'RUN_ARTIFACT_INVALID'
            ? `Run ${options.runId} metadata could not be parsed as JSON.`
          : code === 'EVIDENCE_ARTIFACT_INVALID'
            ? `Evidence artifact ${options.evidenceId} in run ${options.runId} could not be parsed as JSON.`
            : message,
    });
  }

  const envelope = createDiscoveryEnvelope({
    command,
    status,
    summary,
    result,
    warnings,
    errors,
    evidence: status === 'ok' ? evidence : [],
    meta: createDiscoveryCommandMeta({
      runId: prepared.runId,
      commandExecutionId: prepared.commandExecutionId,
      commandSlug: prepared.commandSlug,
      outputArtifactPaths: [prepared.outputArtifactRelativePath],
      evidenceArtifactPaths: [],
      logArtifactPath: prepared.logArtifactRelativePath,
      recommendedNextCommands: [],
      effectiveFailOn: options.failOn,
    }),
  });

  runManager.finalizeCommandExecution({
    prepared,
    status,
    envelope,
    inputs: {
      run_id: options.runId,
      evidence_id: options.evidenceId,
    },
    warnings: warnings.map((warning) => warning.message),
    logLines: [
      `command=${command}`,
      `inspected_run_id=${options.runId}`,
      `evidence_id=${options.evidenceId}`,
      `artifact_path=${artifactRelativePath}`,
      `run_id=${prepared.runId}`,
      `command_execution_id=${prepared.commandExecutionId}`,
      `status=${status}`,
      `fail_on=${options.failOn ?? 'default'}`,
    ],
  });

  return {
    envelope,
    runFilePath: prepared.runFilePath,
    outputArtifactPath: prepared.outputArtifactAbsolutePath,
    logArtifactPath: prepared.logArtifactAbsolutePath,
  };
}
