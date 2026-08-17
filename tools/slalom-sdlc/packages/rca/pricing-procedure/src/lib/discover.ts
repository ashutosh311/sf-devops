import { lstatSync, readdirSync } from 'node:fs';
import * as path from 'node:path';

import { REPO_SCAN_EXCLUDED_DIRS, REPO_SCAN_LIMIT, type FailChoice } from './contracts/constants';
import { makeEnvelope, makeNotice, makeSummary } from './contracts/envelope';
import { PricingCliError } from './contracts/errors';
import type { Envelope, NormalizedProcedureArtifact, NormalizedProcedureVersion, Notice } from './contracts/types';
import { selectVersions } from './domain/selectors';
import { loadExpressionSet, summarizeArtifact, type ProcedureArtifactSummary } from './parsing/normalize/procedure';

export interface DiscoverArgs {
  file?: string;
  repo?: string;
  interfaceSourceType?: string;
  version?: string;
  stepName?: string;
  actionType?: string;
  sequence?: string;
  json: boolean;
  failOn: FailChoice;
}

interface DiscoverResult {
  mode: 'file' | 'repo_scan';
  artifacts: ProcedureArtifactSummary[];
  filters_applied: {
    interface_source_type: string | null;
    version: string | null;
    step_name: string | null;
    action_type: string | null;
    sequence: string | null;
  };
}

type RepoScanItem = string | readonly ['__TRUNCATED__', number] | readonly ['symlink_skipped', string];

function filterArtifactVersions(artifact: NormalizedProcedureArtifact, args: DiscoverArgs): NormalizedProcedureArtifact {
  const filteredVersions = selectVersions(artifact.versions, args.version).map((version) => ({
    ...version,
    steps: version.steps.filter((step) => {
      if (args.stepName != null && step.name !== args.stepName) {
        return false;
      }
      if (args.actionType != null && (step.actionType ?? '') !== args.actionType) {
        return false;
      }
      if (args.sequence != null && String(step.sequenceNumber) !== String(args.sequence)) {
        return false;
      }
      return true;
    }),
  }));

  return {
    ...artifact,
    versions: filteredVersions,
  };
}

function iterRepoExpressionSets(rootPath: string): RepoScanItem[] {
  let rootStats;
  try {
    rootStats = lstatSync(rootPath);
  } catch {
    throw new PricingCliError(
      'repo_scan_root_not_found',
      `Repo scan root not found: ${rootPath}`,
      { path: rootPath },
      'Check the repo path and rerun discover --repo.',
    );
  }

  if (!rootStats.isDirectory()) {
    throw new PricingCliError(
      'repo_scan_root_not_found',
      `Repo scan root not found: ${rootPath}`,
      { path: rootPath },
      'Check the repo path and rerun discover --repo.',
    );
  }

  let count = 0;
  const results: RepoScanItem[] = [];
  const skipped: Array<readonly ['symlink_skipped', string]> = [];
  const queue = [rootPath];

  while (queue.length > 0) {
    const currentDir = queue.pop()!;
    const entries = readdirSync(currentDir, { withFileTypes: true });

    for (const entry of entries) {
      if (REPO_SCAN_EXCLUDED_DIRS.has(entry.name)) {
        continue;
      }

      const fullPath = path.join(currentDir, entry.name);
      const stats = lstatSync(fullPath);
      if (stats.isSymbolicLink()) {
        if (entry.name.endsWith('.expressionSetDefinition-meta.xml')) {
          skipped.push(['symlink_skipped', fullPath] as const);
        }
        continue;
      }

      if (stats.isDirectory()) {
        queue.push(fullPath);
        continue;
      }

      if (!entry.name.endsWith('.expressionSetDefinition-meta.xml')) {
        continue;
      }

      count += 1;
      if (count > REPO_SCAN_LIMIT) {
        results.push(['__TRUNCATED__', count] as const, ...skipped);
        return results;
      }

      results.push(fullPath);
    }
  }

  results.push(...skipped);
  return results;
}

function summarizeDiscoverTarget(args: DiscoverArgs): string {
  return args.file ?? args.repo ?? '';
}

export function runDiscover(args: DiscoverArgs, startedAt: number): Envelope<DiscoverResult> {
  const warnings: Notice[] = [];
  const errors: Notice[] = [];
  const artifacts: ProcedureArtifactSummary[] = [];
  const sourceFiles: string[] = [];
  let mode: 'file' | 'repo_scan';

  if (args.file) {
    mode = 'file';
    const artifact = loadExpressionSet(args.file);
    sourceFiles.push(args.file);
    if (!args.interfaceSourceType || artifact.interface_source_type.includes(args.interfaceSourceType)) {
      artifacts.push(summarizeArtifact(filterArtifactVersions(artifact, args)));
    }
  } else if (args.repo) {
    mode = 'repo_scan';
    let truncatedCount: number | null = null;
    for (const item of iterRepoExpressionSets(args.repo)) {
      if (typeof item !== 'string' && item[0] === '__TRUNCATED__') {
        truncatedCount = item[1];
        continue;
      }

      if (typeof item !== 'string') {
        warnings.push(
          makeNotice(
            item[0],
            'Symlink skipped during repo scan.',
            { path: item[1] },
            'Use a real file path in v1; symlinks are not followed.',
          ),
        );
        continue;
      }

      try {
        const artifact = loadExpressionSet(item);
        sourceFiles.push(item);
        if (args.interfaceSourceType && !artifact.interface_source_type.includes(args.interfaceSourceType)) {
          continue;
        }
        artifacts.push(summarizeArtifact(filterArtifactVersions(artifact, args)));
      } catch (error) {
        const cliError =
          error instanceof PricingCliError
            ? error
            : new PricingCliError(
                'internal_contract_error',
                error instanceof Error ? error.message : 'Unknown discover failure.',
                {},
                'Inspect the discover workflow implementation and rerun.',
              );
        warnings.push(makeNotice(cliError.code, cliError.message, cliError.details, cliError.suggestion));
      }
    }

    if (truncatedCount != null) {
      warnings.push(
        makeNotice(
          'repo_scan_truncated',
          'Repo scan stopped after hitting the v1 candidate limit.',
          { candidate_file_count: truncatedCount },
          'Narrow the repo path and rerun discover --repo.',
        ),
      );
    }
  } else {
    throw new PricingCliError(
      'invalid_selector_format',
      'discover requires exactly one of --file or --repo.',
      {},
      'Pass --file <path> or --repo <path>.',
    );
  }

  let status: 'ok' | 'no_match' | 'warn' | 'partial' = 'ok';
  if (artifacts.length === 0) {
    status = 'no_match';
    warnings.push(
      makeNotice(
        'version_not_found',
        'No artifacts matched the requested filters.',
        {
          version: args.version ?? null,
          step_name: args.stepName ?? null,
          action_type: args.actionType ?? null,
          sequence: args.sequence ?? null,
        },
        'Relax the filters or scan a broader repo path.',
      ),
    );
  } else if (warnings.length > 0) {
    status = warnings.some((warning) => warning.code === 'repo_scan_truncated' || warning.code === 'symlink_skipped')
      ? 'partial'
      : 'warn';
  }

  const result: DiscoverResult = {
    mode,
    artifacts,
    filters_applied: {
      interface_source_type: args.interfaceSourceType ?? null,
      version: args.version ?? null,
      step_name: args.stepName ?? null,
      action_type: args.actionType ?? null,
      sequence: args.sequence ?? null,
    },
  };

  return makeEnvelope(
    'discover',
    makeSummary(
      summarizeDiscoverTarget(args),
      artifacts.length > 0 ? 'Discovery completed.' : 'No artifacts matched the requested filters.',
      { artifact_count: artifacts.length },
      artifacts.length > 0 ? 'summarize' : 'discover',
    ),
    result,
    {
      warnings,
      errors,
      status,
      source_files: sourceFiles,
      selector_input: result.filters_applied,
      started_at: startedAt,
    },
  );
}
