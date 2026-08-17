import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import * as path from 'node:path';

import type { ResultEnvelope, Status } from '@sdlc/rca-cli-core';

import {
  assertCanonicalRunId,
  getLogArtifactRelativePath,
  getOutputArtifactRelativePath,
  getRunArtifactPathsForArtifactRoot,
  resolveRunRelativePath,
  resolveSfxArtifactRoot,
  type OutputFormat,
} from './artifacts';
import { createCommandExecutionId, createRunId } from './ids';

export type RunLifecycleStatus = 'created' | 'in_progress' | 'completed' | 'completed_with_warnings' | 'failed';

export interface RunCommandRecord {
  command_execution_id: string;
  command_slug: string;
  command: string;
  status: Status;
  started_at: string;
  completed_at: string;
  inputs: Record<string, unknown>;
  output_artifacts: string[];
  evidence_refs: string[];
  warnings: string[];
  parent_command_execution_id: string | null;
  retry_of_execution_id: string | null;
  agent_execution: boolean;
}

export interface RunRecord {
  schema_version: string;
  run_id: string;
  status: RunLifecycleStatus;
  created_at: string;
  updated_at: string;
  root_path: string;
  commands: RunCommandRecord[];
  warnings: string[];
  notes: string[];
}

export interface PreparedCommandExecution {
  repoRoot: string;
  artifactRoot: string;
  runId: string;
  commandExecutionId: string;
  commandSlug: string;
  startedAt: string;
  runRootPath: string;
  runFilePath: string;
  outputArtifactRelativePath: string;
  outputArtifactAbsolutePath: string;
  logArtifactRelativePath: string;
  logArtifactAbsolutePath: string;
  step: number;
}

export interface PrepareCommandExecutionInput {
  repoRoot: string;
  artifactRoot?: string;
  command: string;
  commandSlug: string;
  inputs?: Record<string, unknown>;
  runId?: string;
  newRun?: boolean;
  outputFormat?: OutputFormat;
}

export interface FinalizeCommandExecutionInput<TResult, TMeta = Record<string, unknown>> {
  prepared: PreparedCommandExecution;
  status: Status;
  envelope: ResultEnvelope<TResult, TMeta>;
  warnings?: string[];
  evidenceRefs?: string[];
  logLines?: string[];
  parentCommandExecutionId?: string | null;
  retryOfExecutionId?: string | null;
  agentExecution?: boolean;
  inputs?: Record<string, unknown>;
}

export interface SingleWriterRunManager {
  prepareCommandExecution(input: PrepareCommandExecutionInput): PreparedCommandExecution;
  finalizeCommandExecution<TResult, TMeta = Record<string, unknown>>(input: FinalizeCommandExecutionInput<TResult, TMeta>): RunRecord;
  readRun(runFilePath: string): RunRecord;
}

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) {
    throw new Error(message);
  }
}

function writeJsonFile(filePath: string, value: unknown): void {
  writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`);
}

function readJsonFile<T>(filePath: string): T {
  return JSON.parse(readFileSync(filePath, 'utf8')) as T;
}

function ensureRunDirectories(runRootPath: string): void {
  mkdirSync(path.join(runRootPath, 'evidence'), { recursive: true });
  mkdirSync(path.join(runRootPath, 'outputs'), { recursive: true });
  mkdirSync(path.join(runRootPath, 'logs'), { recursive: true });
}

function createRunRecord(artifactRoot: string, runId: string, createdAt: string): RunRecord {
  const artifactPaths = getRunArtifactPathsForArtifactRoot(artifactRoot, runId);
  return {
    schema_version: '1.0.0',
    run_id: runId,
    status: 'created',
    created_at: createdAt,
    updated_at: createdAt,
    root_path: artifactPaths.rootPath,
    commands: [],
    warnings: [],
    notes: ['single-writer-controller-thread-only'],
  };
}

function getEffectiveCommands(commands: readonly RunCommandRecord[]): RunCommandRecord[] {
  const retriedExecutionIds = new Set(commands.flatMap((command) => (command.retry_of_execution_id ? [command.retry_of_execution_id] : [])));
  return commands.filter((command) => !retriedExecutionIds.has(command.command_execution_id));
}

function resolveRunStatus(commands: readonly RunCommandRecord[]): RunLifecycleStatus {
  const effectiveCommands = getEffectiveCommands(commands);

  if (effectiveCommands.length === 0) {
    return 'created';
  }

  if (effectiveCommands.some((command) => command.status === 'error')) {
    return 'failed';
  }

  if (effectiveCommands.some((command) => ['warn', 'partial', 'unsupported'].includes(command.status))) {
    return 'completed_with_warnings';
  }

  return 'completed';
}

export class LocalFileRunManager implements SingleWriterRunManager {
  prepareCommandExecution(input: PrepareCommandExecutionInput): PreparedCommandExecution {
    const startedAt = new Date().toISOString();
    const runId = input.runId && !input.newRun ? input.runId : createRunId();
    assertCanonicalRunId(runId);
    const artifactRoot = input.artifactRoot ?? resolveSfxArtifactRoot(input.repoRoot);
    const artifactPaths = getRunArtifactPathsForArtifactRoot(artifactRoot, runId);

    let runRecord: RunRecord;
    if (input.runId && !input.newRun) {
      assert(pathExists(artifactPaths.runFilePath), `RUN_ID_NOT_FOUND: ${input.runId}`);
      runRecord = this.readRun(artifactPaths.runFilePath);
      ensureRunDirectories(artifactPaths.rootPath);
    } else {
      ensureRunDirectories(artifactPaths.rootPath);
      runRecord = createRunRecord(artifactRoot, runId, startedAt);
      writeJsonFile(artifactPaths.runFilePath, runRecord);
    }

    const step = runRecord.commands.length + 1;
    const commandExecutionId = createCommandExecutionId(step);
    const outputArtifactRelativePath = getOutputArtifactRelativePath(input.commandSlug, commandExecutionId, input.outputFormat ?? 'json');
    const logArtifactRelativePath = getLogArtifactRelativePath(input.commandSlug, commandExecutionId);

    runRecord.status = 'in_progress';
    runRecord.updated_at = startedAt;
    writeJsonFile(artifactPaths.runFilePath, runRecord);

    return {
      repoRoot: input.repoRoot,
      artifactRoot,
      runId,
      commandExecutionId,
      commandSlug: input.commandSlug,
      startedAt,
      runRootPath: artifactPaths.rootPath,
      runFilePath: artifactPaths.runFilePath,
      outputArtifactRelativePath,
      outputArtifactAbsolutePath: resolveRunRelativePath(artifactPaths.rootPath, outputArtifactRelativePath),
      logArtifactRelativePath,
      logArtifactAbsolutePath: resolveRunRelativePath(artifactPaths.rootPath, logArtifactRelativePath),
      step,
    };
  }

  finalizeCommandExecution<TResult, TMeta = Record<string, unknown>>(input: FinalizeCommandExecutionInput<TResult, TMeta>): RunRecord {
    writeJsonFile(input.prepared.outputArtifactAbsolutePath, input.envelope);
    writeFileSync(input.prepared.logArtifactAbsolutePath, `${(input.logLines ?? []).join('\n')}${input.logLines && input.logLines.length > 0 ? '\n' : ''}`);

    const runRecord = this.readRun(input.prepared.runFilePath);
    const completedAt = new Date().toISOString();

    runRecord.commands.push({
      command_execution_id: input.prepared.commandExecutionId,
      command_slug: input.prepared.commandSlug,
      command: input.envelope.command,
      status: input.status,
      started_at: input.prepared.startedAt,
      completed_at: completedAt,
      inputs: { ...(input.inputs ?? {}) },
      output_artifacts: [input.prepared.outputArtifactRelativePath],
      evidence_refs: [...(input.evidenceRefs ?? [])],
      warnings: [...(input.warnings ?? [])],
      parent_command_execution_id: input.parentCommandExecutionId ?? null,
      retry_of_execution_id: input.retryOfExecutionId ?? null,
      agent_execution: input.agentExecution ?? false,
    });

    runRecord.status = resolveRunStatus(runRecord.commands);
    runRecord.updated_at = completedAt;
    writeJsonFile(input.prepared.runFilePath, runRecord);

    return runRecord;
  }

  readRun(runFilePath: string): RunRecord {
    try {
      return readJsonFile<RunRecord>(runFilePath);
    } catch (error) {
      if (error instanceof SyntaxError) {
        throw new Error(`RUN_ARTIFACT_INVALID: ${runFilePath}`);
      }

      throw error;
    }
  }
}

function pathExists(filePath: string): boolean {
  return existsSync(filePath);
}
