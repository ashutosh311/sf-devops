import type { FailOn } from '@otto/rca-cli-core';

import { createDiscoveryCommandMeta } from '../../../runtime/envelope';
import { commandToSlug } from '../../../runtime/ids';
import { LocalFileRunManager } from '../../../runtime/run-manager';
import { buildProjectInventoryEnvelope } from './payload';
import { scanProjectInventory } from './scan';
import type { ProjectInventoryDetailLevel, ProjectInventoryExecutionResult } from './types';

const PROJECT_INVENTORY_COMMAND = 'sfx discover project-inventory';

function shellQuote(value: string): string {
  return /^[A-Za-z0-9_./:-]+$/.test(value)
    ? value
    : `'${value.replace(/'/g, `'\\''`)}'`;
}

function buildProjectInventoryCommand(repo: string, detail: ProjectInventoryDetailLevel): string {
  const detailSuffix = detail === 'standard' ? '' : ` --detail ${detail}`;
  return `${PROJECT_INVENTORY_COMMAND} --repo ${shellQuote(repo)}${detailSuffix} --json`;
}

function collectRecommendedNextCommands(recommendedNextSteps: Array<{ text: string; step_type: string }>): string[] {
  return recommendedNextSteps
    .filter((step) => step.step_type === 'command' && step.text.startsWith('Run '))
    .map((step) => step.text.slice('Run '.length));
}

export function executeProjectInventory(options: {
  repoRoot: string;
  artifactRoot?: string;
  repo: string;
  detail?: ProjectInventoryDetailLevel;
  appendRunId?: string;
  newRun?: boolean;
  failOn?: FailOn;
  runManager?: LocalFileRunManager;
}): ProjectInventoryExecutionResult {
  const detail = options.detail ?? 'standard';
  const command = buildProjectInventoryCommand(options.repo, detail);
  const commandSlug = commandToSlug(PROJECT_INVENTORY_COMMAND);
  const runManager = options.runManager ?? new LocalFileRunManager();
  const prepared = runManager.prepareCommandExecution({
    repoRoot: options.repoRoot,
    artifactRoot: options.artifactRoot,
    command,
    commandSlug,
    inputs: {
      repo: options.repo,
      ...(detail === 'standard' ? {} : { detail }),
    },
    runId: options.appendRunId,
    newRun: options.newRun,
    outputFormat: 'json',
  });

  const scan = scanProjectInventory(options.repo, detail);
  const envelope = buildProjectInventoryEnvelope({
    command,
    scan,
    meta: createDiscoveryCommandMeta({
      runId: prepared.runId,
      commandExecutionId: prepared.commandExecutionId,
      commandSlug: prepared.commandSlug,
      outputArtifactPaths: [prepared.outputArtifactRelativePath],
      evidenceArtifactPaths: [],
      logArtifactPath: prepared.logArtifactRelativePath,
      recommendedNextCommands: collectRecommendedNextCommands(scan.recommended_next_steps),
      stats: scan.stats,
      effectiveFailOn: options.failOn,
    }),
  });

  runManager.finalizeCommandExecution({
    prepared,
    status: envelope.status,
    envelope,
    inputs: {
      repo: options.repo,
      ...(detail === 'standard' ? {} : { detail }),
    },
    warnings: envelope.warnings.map((warning) => warning.message),
    logLines: [
      `command=${command}`,
      `repo=${scan.repo_root}`,
      `detail=${detail}`,
      `run_id=${prepared.runId}`,
      `command_execution_id=${prepared.commandExecutionId}`,
      `status=${envelope.status}`,
      `files_scanned=${scan.stats.files_scanned}`,
      `matched_metadata_files=${scan.stats.matched_metadata_files}`,
      `package_root_count=${scan.stats.package_root_count}`,
      `hotspot_count=${scan.stats.hotspot_count}`,
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
