import * as path from 'node:path';
import { realpathSync } from 'node:fs';

export const SFX_ARTIFACT_ROOT = path.join('.artifacts', 'sfx');

export type OutputFormat = 'json';

export interface RunArtifactPaths {
  rootPath: string;
  runFilePath: string;
  evidenceDirPath: string;
  outputsDirPath: string;
  logsDirPath: string;
}

function realpathIfPresent(filePath: string): string {
  try {
    return realpathSync(filePath);
  } catch {
    return filePath;
  }
}

export function resolveSfxProjectRoot(cwd: string, explicitProjectRoot?: string): string {
  return realpathIfPresent(path.resolve(cwd, explicitProjectRoot ?? process.env.ARM_PROJECT_ROOT ?? '.'));
}

export function resolveSfxArtifactRoot(projectRoot: string, explicitArtifactRoot?: string): string {
  const configuredArtifactRoot = explicitArtifactRoot ?? process.env.ARM_ARTIFACT_ROOT;
  const resolved = configuredArtifactRoot
    ? path.resolve(projectRoot, configuredArtifactRoot)
    : path.join(projectRoot, SFX_ARTIFACT_ROOT);
  return realpathIfPresent(resolved);
}

export function getRunRootPath(repoRoot: string, runId: string): string {
  assertCanonicalRunId(runId);
  return path.join(repoRoot, SFX_ARTIFACT_ROOT, 'runs', runId);
}

export function getRunArtifactPaths(repoRoot: string, runId: string): RunArtifactPaths {
  const rootPath = getRunRootPath(repoRoot, runId);

  return {
    rootPath,
    runFilePath: path.join(rootPath, 'run.json'),
    evidenceDirPath: path.join(rootPath, 'evidence'),
    outputsDirPath: path.join(rootPath, 'outputs'),
    logsDirPath: path.join(rootPath, 'logs'),
  };
}

export function getRunRootPathForArtifactRoot(artifactRoot: string, runId: string): string {
  assertCanonicalRunId(runId);
  return path.join(artifactRoot, 'runs', runId);
}

export function getRunArtifactPathsForArtifactRoot(artifactRoot: string, runId: string): RunArtifactPaths {
  const rootPath = getRunRootPathForArtifactRoot(artifactRoot, runId);

  return {
    rootPath,
    runFilePath: path.join(rootPath, 'run.json'),
    evidenceDirPath: path.join(rootPath, 'evidence'),
    outputsDirPath: path.join(rootPath, 'outputs'),
    logsDirPath: path.join(rootPath, 'logs'),
  };
}

export function getOutputArtifactRelativePath(commandSlug: string, commandExecutionId: string, format: OutputFormat): string {
  return path.posix.join('outputs', `${commandSlug}--${commandExecutionId}.${format}`);
}

export function getLogArtifactRelativePath(commandSlug: string, commandExecutionId: string): string {
  return path.posix.join('logs', `${commandSlug}--${commandExecutionId}.log`);
}

export function getEvidenceArtifactRelativePath(evidenceId: string): string {
  assertCanonicalEvidenceId(evidenceId);
  return path.posix.join('evidence', `${evidenceId}.json`);
}

export function resolveRunRelativePath(runRootPath: string, relativePath: string): string {
  return path.join(runRootPath, ...relativePath.split('/'));
}

const CANONICAL_EVIDENCE_ID_PATTERN = /^ev_[a-z0-9]+(?:_[a-z0-9]+)*$/;
const CANONICAL_RUN_ID_PATTERN = /^run_\d{8}_\d{6}_[a-f0-9]+$/;

export function isCanonicalRunId(runId: string): boolean {
  return CANONICAL_RUN_ID_PATTERN.test(runId);
}

export function assertCanonicalRunId(runId: string): void {
  if (!isCanonicalRunId(runId)) {
    throw new Error(`RUN_ID_INVALID: ${runId}`);
  }
}

export function isCanonicalEvidenceId(evidenceId: string): boolean {
  return CANONICAL_EVIDENCE_ID_PATTERN.test(evidenceId);
}

export function assertCanonicalEvidenceId(evidenceId: string): void {
  if (!isCanonicalEvidenceId(evidenceId)) {
    throw new Error(`EVIDENCE_ID_INVALID: ${evidenceId}`);
  }
}
