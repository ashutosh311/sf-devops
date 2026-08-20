import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import * as path from 'node:path';

import type { FailOn } from '@otto/rca-cli-core';

import { createDiscoveryCommandMeta, createDiscoveryEnvelope } from '../../runtime/envelope';
import { resolveSfxArtifactRoot, resolveSfxProjectRoot } from '../../runtime/artifacts';
import { getEvidenceArtifactRelativePath, resolveRunRelativePath } from '../../runtime/artifacts';
import { commandToSlug } from '../../runtime/ids';
import { LocalFileRunManager } from '../../runtime/run-manager';
import { buildDoctorSfCliAssessment } from './checks';
import { parseSfVersion, SystemDoctorCommandRunner } from './resolution';
import type { BinaryResolution, CliWrapperSummary, CommandRunnerResult, DoctorCommandRunner, DoctorExecutionResult, DoctorSfCliAssessmentInput, ProjectContextSummary } from './types';

const DOCTOR_COMMAND = 'sfx doctor sf-cli';
const DOCTOR_COMMAND_JSON = 'sfx doctor sf-cli --json';

function readSupportedNodeEngineRange(): string {
  try {
    const packageJsonPath = path.resolve(__dirname, '..', '..', '..', 'package.json');
    const parsed = JSON.parse(readFileSync(packageJsonPath, 'utf8')) as { engines?: { node?: unknown } };
    return typeof parsed.engines?.node === 'string' && parsed.engines.node.trim().length > 0
      ? parsed.engines.node
      : '>=20 <25';
  } catch {
    return '>=20 <25';
  }
}

const SUPPORTED_NODE_ENGINE_RANGE = readSupportedNodeEngineRange();

function parseSupportedNodeMajorRange(range: string): { min: number; maxExclusive: number } | null {
  const match = range.match(/^>=(\d+) <(\d+)$/);
  const min = Number.parseInt(match?.[1] ?? '', 10);
  const maxExclusive = Number.parseInt(match?.[2] ?? '', 10);

  if (!Number.isInteger(min) || !Number.isInteger(maxExclusive)) {
    return null;
  }

  return { min, maxExclusive };
}

function normalizeStdout(value: string): string | null {
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function readNodeVersion(runner: DoctorCommandRunner, nodeResolution: BinaryResolution): string | null {
  if (nodeResolution.resolution_status !== 'resolved') {
    return null;
  }

  const result = runner.run(nodeResolution.path ?? nodeResolution.command, ['--version']);
  return result.exitCode === 0 ? normalizeStdout(result.stdout) : null;
}

function evaluateNodeEngineStatus(version: string | null): 'supported' | 'unsupported' | 'unknown' {
  if (!version) {
    return 'unknown';
  }

  const match = version.match(/^v?(\d+)\.(\d+)\.(\d+)$/);
  if (!match) {
    return 'unknown';
  }

  const major = Number.parseInt(match[1] ?? '', 10);
  if (!Number.isInteger(major)) {
    return 'unknown';
  }

  const supportedRange = parseSupportedNodeMajorRange(SUPPORTED_NODE_ENGINE_RANGE);
  if (!supportedRange) {
    return 'unknown';
  }

  return major >= supportedRange.min && major < supportedRange.maxExclusive ? 'supported' : 'unsupported';
}

function readSfVersion(runner: DoctorCommandRunner, sfResolution: BinaryResolution): ReturnType<typeof parseSfVersion> {
  if (sfResolution.resolution_status !== 'resolved') {
    return parseSfVersion(null);
  }

  const primaryResult = runner.run(sfResolution.path ?? sfResolution.command, ['--version']);
  if (primaryResult.exitCode !== 0) {
    return {
      raw: normalizeStdout(primaryResult.stderr) ?? normalizeStdout(primaryResult.stdout),
      parsed_version: null,
      status: 'command_failed',
    };
  }

  return parseSfVersion(normalizeStdout(primaryResult.stdout));
}

function inspectCommandWrapper(runner: DoctorCommandRunner, command: string): CliWrapperSummary {
  const resolution = runner.resolveBinary(command);
  if (resolution.resolution_status !== 'resolved' || !resolution.path) {
    return {
      command,
      path: null,
      status: 'missing',
      detail: `${command} was not resolved from PATH.`,
    };
  }

  try {
    const contents = readFileSync(resolution.path, 'utf8');
    const runtimeRootMatch = contents.match(/ARM_BUILD_AGENTS_RUNTIME_ROOT=([^\n]+)/);
    if (runtimeRootMatch) {
      const runtimeRoot = runtimeRootMatch[1]!.trim().replace(/^"|"$/g, '');
      if (runtimeRoot.length > 0 && !existsSync(runtimeRoot)) {
        return {
          command,
          path: resolution.path,
          status: 'stale',
          detail: `${command} wrapper points at missing runtime root ${runtimeRoot}.`,
        };
      }
    }
  } catch {
    // PATH resolution is enough for non-ARM wrappers or test fixtures.
  }

  return {
    command,
    path: resolution.path,
    status: 'resolved',
    detail: `${command} resolved from PATH at ${resolution.path}.`,
  };
}

function collectProjectContext(projectRoot: string, artifactRoot?: string): ProjectContextSummary {
  const resolvedProjectRoot = resolveSfxProjectRoot(process.cwd(), projectRoot);
  const resolvedArtifactRoot = resolveSfxArtifactRoot(resolvedProjectRoot, artifactRoot);
  const candidateFiles = ['sfdx-project.json', 'package.json', 'force-app'];
  const detectedProjectFiles = candidateFiles.filter((relativePath) => existsSync(path.join(resolvedProjectRoot, relativePath)));

  return {
    project_root: resolvedProjectRoot,
    artifact_root: resolvedArtifactRoot,
    project_config_status: detectedProjectFiles.length > 0 ? 'detected' : 'missing',
    detected_project_files: detectedProjectFiles,
  };
}

function countAuthenticatedAliases(result: CommandRunnerResult): {
  checked: boolean;
  count: number;
  probeStatus: DoctorSfCliAssessmentInput['orgListProbeStatus'];
  probeError: string | null;
} {
  if (result.exitCode !== 0) {
    return {
      checked: false,
      count: 0,
      probeStatus: 'probe_failed',
      probeError: normalizeStdout(result.stderr) ?? normalizeStdout(result.stdout),
    };
  }

  const trimmed = result.stdout.trim();
  if (trimmed.length === 0) {
    return { checked: true, count: 0, probeStatus: 'empty', probeError: null };
  }

  try {
    const parsed = JSON.parse(trimmed) as { result?: { nonScratchOrgs?: unknown[]; scratchOrgs?: unknown[] } };
    const nonScratch = Array.isArray(parsed.result?.nonScratchOrgs) ? parsed.result?.nonScratchOrgs.length : 0;
    const scratch = Array.isArray(parsed.result?.scratchOrgs) ? parsed.result?.scratchOrgs.length : 0;
    return {
      checked: true,
      count: nonScratch + scratch,
      probeStatus: nonScratch + scratch > 0 ? 'available' : 'empty',
      probeError: null,
    };
  } catch {
    return {
      checked: false,
      count: 0,
      probeStatus: 'probe_failed',
      probeError: 'Failed to parse `sf org list --json` output.',
    };
  }
}

export function collectDoctorSfCliInputs(
  runner: DoctorCommandRunner = new SystemDoctorCommandRunner(),
  context?: { projectRoot?: string; artifactRoot?: string },
): DoctorSfCliAssessmentInput {
  const node = runner.resolveBinary('node');
  const npm = runner.resolveBinary('npm');
  const python = runner.resolveBinary('python3');
  const sf = runner.resolveBinary('sf');
  const nodeVersion = readNodeVersion(runner, node);
  const sfVersion = readSfVersion(runner, sf);
  const authResult = sf.resolution_status === 'resolved'
    ? countAuthenticatedAliases(runner.run(sf.path ?? sf.command, ['org', 'list', '--json']))
    : { checked: false, count: 0, probeStatus: 'skipped' as const, probeError: null };

  return {
    node: {
      ...node,
      version: nodeVersion,
      engine_range: SUPPORTED_NODE_ENGINE_RANGE,
      engine_status: evaluateNodeEngineStatus(nodeVersion),
    },
    npm,
    python,
    sf,
    sfVersion,
    commandWrappers: ['arm-doctor', 'arm-setup-cli', 'sfx', 'quote-runtime', 'pricing-procedure'].map((command) => inspectCommandWrapper(runner, command)),
    projectContext: context?.projectRoot ? collectProjectContext(context.projectRoot, context.artifactRoot) : null,
    authenticatedAliasesCount: authResult.count,
    orgListChecked: authResult.checked,
    orgListProbeStatus: authResult.probeStatus,
    orgListProbeError: authResult.probeError,
  };
}

export function executeDoctorSfCli(options: {
  repoRoot: string;
  artifactRoot?: string;
  appendRunId?: string;
  newRun?: boolean;
  failOn?: FailOn;
  runner?: DoctorCommandRunner;
  runManager?: LocalFileRunManager;
}): DoctorExecutionResult {
  const runManager = options.runManager ?? new LocalFileRunManager();
  const prepared = runManager.prepareCommandExecution({
    repoRoot: options.repoRoot,
    artifactRoot: options.artifactRoot,
    command: DOCTOR_COMMAND_JSON,
    commandSlug: commandToSlug(DOCTOR_COMMAND),
    inputs: {},
    runId: options.appendRunId,
    newRun: options.newRun,
    outputFormat: 'json',
  });

  const assessment = buildDoctorSfCliAssessment(collectDoctorSfCliInputs(options.runner, {
    projectRoot: options.repoRoot,
    artifactRoot: options.artifactRoot,
  }));
  const evidenceArtifactPaths: string[] = [];
  const evidenceRefs: string[] = [];

  for (const artifact of assessment.evidenceArtifacts) {
    const relativePath = getEvidenceArtifactRelativePath(artifact.evidenceId);
    const absolutePath = resolveRunRelativePath(prepared.runRootPath, relativePath);
    mkdirSync(path.dirname(absolutePath), { recursive: true });
    writeFileSync(absolutePath, `${JSON.stringify(artifact.payload, null, 2)}\n`);
    evidenceArtifactPaths.push(relativePath);
    evidenceRefs.push(artifact.evidenceId);
  }

  const envelope = createDiscoveryEnvelope({
    command: DOCTOR_COMMAND_JSON,
    status: assessment.status,
    summary: assessment.summary,
    result: assessment.result,
    warnings: assessment.warnings,
    errors: assessment.errors,
    evidence: assessment.evidence,
    meta: createDiscoveryCommandMeta({
      runId: prepared.runId,
      commandExecutionId: prepared.commandExecutionId,
      commandSlug: prepared.commandSlug,
      outputArtifactPaths: [prepared.outputArtifactRelativePath],
      evidenceArtifactPaths,
      logArtifactPath: prepared.logArtifactRelativePath,
      recommendedNextCommands: assessment.recommendedNextCommands,
      effectiveFailOn: options.failOn,
    }),
  });

  runManager.finalizeCommandExecution({
    prepared,
    status: assessment.status,
    envelope,
    inputs: {},
    warnings: assessment.warnings.map((entry) => entry.message),
    evidenceRefs,
    logLines: assessment.logLines,
  });

  return {
    envelope,
    runFilePath: prepared.runFilePath,
    outputArtifactPath: prepared.outputArtifactAbsolutePath,
    logArtifactPath: prepared.logArtifactAbsolutePath,
    evidenceArtifactPaths: evidenceArtifactPaths.map((relativePath) => resolveRunRelativePath(prepared.runRootPath, relativePath)),
  };
}
