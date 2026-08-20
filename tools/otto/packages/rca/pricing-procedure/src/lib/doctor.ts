import { existsSync, lstatSync, readdirSync } from 'node:fs';
import * as path from 'node:path';

import { REPO_SCAN_EXCLUDED_DIRS, REPO_SCAN_LIMIT, type FailChoice, type Status } from './contracts/constants';
import { makeEnvelope, makeNotice, makeSummary } from './contracts/envelope';
import { PricingCliError } from './contracts/errors';
import type {
  Envelope,
  NormalizedProcedureArtifact,
  NormalizedProcedureStep,
  Notice,
} from './contracts/types';
import { selectVersions } from './domain/selectors';
import { loadContextDefinition } from './parsing/normalize/context';
import { loadExpressionSet, summarizeArtifact, type ProcedureArtifactSummary } from './parsing/normalize/procedure';

const CONTEXT_SCAN_LIMIT = 20;

export interface DoctorArgs {
  file?: string;
  repo?: string;
  context?: string;
  version?: string;
  stepName?: string;
  sequence?: string;
  json: boolean;
  failOn: FailChoice;
}

type DoctorCheckStatus = 'ok' | 'warn' | 'blocked' | 'skipped';

interface DoctorCheck {
  code: string;
  status: DoctorCheckStatus;
  message: string;
  details: Record<string, unknown>;
  suggestion: string;
}

interface DoctorCheckCounts {
  total: number;
  by_status: Record<string, number>;
}

interface DoctorRepoSummary {
  candidate_file_count: number;
  pricing_procedure_count: number;
  matched_artifact_count: number;
  matched_artifacts?: ProcedureArtifactSummary[];
}

interface DoctorResult {
  checks: DoctorCheck[];
  check_counts: DoctorCheckCounts;
  readiness: 'ready' | 'ready_with_warnings' | 'blocked' | 'partial';
  artifact_summary: ProcedureArtifactSummary | null;
  candidate_commands: string[];
  repo_summary?: DoctorRepoSummary;
}

type RepoScanItem = string | readonly ['__TRUNCATED__', number] | readonly ['symlink_skipped', string];

type DoctorTopStatus = Extract<Status, 'ok' | 'warn' | 'partial' | 'no_match' | 'unsupported'>;

function sanitizeDoctorDetails(details: Record<string, unknown>): Record<string, unknown> {
  const clone = { ...details };
  delete clone.namespace_uri;
  return clone;
}

function doctorCheck(
  code: string,
  status: DoctorCheckStatus,
  message: string,
  details: Record<string, unknown> = {},
  suggestion = '',
): DoctorCheck {
  return { code, status, message, details: sanitizeDoctorDetails(details), suggestion };
}

function doctorNotice(code: string, message: string, details: Record<string, unknown> = {}, suggestion = ''): Notice {
  return makeNotice(code, message, sanitizeDoctorDetails(details), suggestion);
}

function countChecks(checks: readonly DoctorCheck[]): DoctorCheckCounts {
  const counts: DoctorCheckCounts = { total: checks.length, by_status: {} };
  for (const check of checks) {
    counts.by_status[check.status] = (counts.by_status[check.status] ?? 0) + 1;
  }
  return counts;
}

function deriveReadiness(checks: readonly DoctorCheck[], topStatus: DoctorTopStatus): DoctorResult['readiness'] {
  const statuses = new Set(checks.map((check) => check.status));
  if (topStatus === 'partial') {
    return 'partial';
  }
  if (statuses.has('blocked')) {
    return 'blocked';
  }
  if (statuses.has('warn') || statuses.has('skipped')) {
    return 'ready_with_warnings';
  }
  return 'ready';
}

function stepSelectorDetails(args: DoctorArgs): Array<readonly ['step_name' | 'sequence', string]> {
  const supplied: Array<readonly ['step_name' | 'sequence', string]> = [];
  if (args.stepName != null) {
    supplied.push(['step_name', args.stepName]);
  }
  if (args.sequence != null) {
    supplied.push(['sequence', args.sequence]);
  }
  return supplied;
}

function contextCandidates(rootPath: string, expectedNames: readonly string[] = [], limit = CONTEXT_SCAN_LIMIT): string[] {
  if (!existsSync(rootPath)) {
    return [];
  }

  const expected = new Set(expectedNames);
  const matches: string[] = [];
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
        continue;
      }
      if (stats.isDirectory()) {
        queue.push(fullPath);
        continue;
      }
      if (!entry.name.endsWith('.contextDefinition-meta.xml')) {
        continue;
      }
      const stem = entry.name.replace(/\.contextDefinition-meta\.xml$/, '');
      if (expected.size > 0 && !expected.has(stem)) {
        continue;
      }
      matches.push(fullPath);
      if (matches.length >= limit) {
        return matches;
      }
    }
  }
  return matches;
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

function buildDoctorResult(
  checks: DoctorCheck[],
  topStatus: DoctorTopStatus,
  artifactSummary: ProcedureArtifactSummary | null,
  candidateCommands: string[],
  repoSummary?: DoctorRepoSummary,
): DoctorResult {
  return {
    checks,
    check_counts: countChecks(checks),
    readiness: deriveReadiness(checks, topStatus),
    artifact_summary: artifactSummary,
    candidate_commands: candidateCommands,
    ...(repoSummary ? { repo_summary: repoSummary } : {}),
  };
}

function matchStep(selectorKind: 'step_name' | 'sequence', selectorValue: string, step: NormalizedProcedureStep): boolean {
  return selectorKind === 'step_name'
    ? step.name === selectorValue
    : String(step.sequenceNumber) === String(selectorValue);
}

function runDoctorFileInternal(args: DoctorArgs): {
  result: DoctorResult;
  warnings: Notice[];
  status: DoctorTopStatus;
  sourceFiles: string[];
} {
  const checks: DoctorCheck[] = [];
  const sourceFiles = [args.file!];
  const warnings: Notice[] = [];
  let topStatus: DoctorTopStatus = 'ok';
  let candidateCommands = ['discover'];

  if (!existsSync(args.file!)) {
    checks.push(
      doctorCheck(
        'file_not_found',
        'blocked',
        'Procedure file does not exist.',
        { path: args.file! },
        'Check the file path and rerun doctor or discover.',
      ),
    );
    topStatus = 'warn';
    return {
      result: buildDoctorResult(checks, topStatus, null, candidateCommands),
      warnings,
      status: topStatus,
      sourceFiles,
    };
  }

  let artifact: NormalizedProcedureArtifact;
  try {
    artifact = loadExpressionSet(args.file!);
    checks.push(
      doctorCheck(
        'procedure_file',
        'ok',
        'Procedure file loaded successfully.',
        { path: args.file! },
        'Proceed with summarize, inspect-step, or validate.',
      ),
    );
  } catch (error) {
    const cliError = error instanceof PricingCliError
      ? error
      : new PricingCliError(
          'internal_contract_error',
          error instanceof Error ? error.message : 'Unknown doctor failure.',
          {},
          'Inspect the doctor workflow implementation and rerun.',
        );
    checks.push(doctorCheck(cliError.code, 'blocked', cliError.message, cliError.details, cliError.suggestion));
    topStatus = 'warn';
    return {
      result: buildDoctorResult(checks, topStatus, null, candidateCommands),
      warnings,
      status: topStatus,
      sourceFiles,
    };
  }

  const artifactSummary = summarizeArtifact(artifact);
  if (!artifact.is_pricing_procedure) {
    checks.push(
      doctorCheck(
        'not_pricing_procedure',
        'blocked',
        'Artifact is an ExpressionSetDefinition but not a pricing procedure.',
        {
          path: artifact.path,
          interface_source_type: artifact.interface_source_type,
          candidate_adjacent_family: artifact.candidate_adjacent_family,
        },
        'Use discover to classify the artifact family or provide a PricingProcedure ExpressionSetDefinition.',
      ),
    );
    topStatus = 'warn';
    candidateCommands = ['discover', 'explain-error'];
    return {
      result: buildDoctorResult(checks, topStatus, artifactSummary, candidateCommands),
      warnings,
      status: topStatus,
      sourceFiles,
    };
  }

  checks.push(
    doctorCheck(
      'pricing_procedure_ready',
      'ok',
      'Artifact is a pricing procedure.',
      {
        interface_source_type: artifact.interface_source_type,
        context_definitions: artifact.context_definitions,
        active_versions: artifactSummary.active_versions,
      },
      'Use summarize for procedure-wide shape or inspect-step for one step.',
    ),
  );

  let versions = artifact.versions;
  if (args.version) {
    try {
      versions = selectVersions(artifact.versions, args.version);
    } catch (error) {
      const cliError = error instanceof PricingCliError
        ? error
        : new PricingCliError(
            'internal_contract_error',
            error instanceof Error ? error.message : 'Unknown doctor failure.',
            {},
            'Inspect the doctor workflow implementation and rerun.',
          );
      checks.push(doctorCheck(cliError.code, 'blocked', cliError.message, cliError.details, cliError.suggestion));
      topStatus = cliError.code === 'invalid_selector_format' ? 'unsupported' : 'warn';
      candidateCommands = ['discover', 'explain-error'];
      return {
        result: buildDoctorResult(checks, topStatus, artifactSummary, candidateCommands),
        warnings,
        status: topStatus,
        sourceFiles,
      };
    }

    if (versions.length === 0) {
      checks.push(
        doctorCheck(
          'version_not_found',
          'blocked',
          'Version selector did not match any versions.',
          {
            selector: args.version,
            available_versions: artifact.versions.map((version) => version.fullName).filter(Boolean),
            active_versions: artifactSummary.active_versions,
          },
          'Use discover or summarize to list available versions, then rerun with an exact selector.',
        ),
      );
      topStatus = 'no_match';
      candidateCommands = ['discover', 'summarize', 'explain-error'];
      return {
        result: buildDoctorResult(checks, topStatus, artifactSummary, candidateCommands),
        warnings,
        status: topStatus,
        sourceFiles,
      };
    }

    checks.push(
      doctorCheck(
        'version_selector',
        'ok',
        'Version selector matched one or more versions.',
        {
          selector: args.version,
          matched_versions: versions.map((version) => version.fullName),
        },
        'Use summarize or diff with the matched version fullName values.',
      ),
    );
  } else {
    checks.push(
      doctorCheck(
        'version_selector',
        'skipped',
        'No version selector was provided.',
        {
          active_versions: artifactSummary.active_versions,
          version_count: artifactSummary.version_count,
        },
        'Provide --version active, rank:N, or an exact fullName to narrow the scope when needed.',
      ),
    );
  }

  const stepSelectors = stepSelectorDetails(args);
  if (stepSelectors.length > 0) {
    if (stepSelectors.length !== 1) {
      checks.push(
        doctorCheck(
          'invalid_selector_format',
          'blocked',
          'Doctor supports exactly one step selector family at a time.',
          { received: Object.fromEntries(stepSelectors) },
          'Use exactly one of: --step-name or --sequence.',
        ),
      );
      topStatus = 'unsupported';
      candidateCommands = ['summarize', 'explain-error'];
      return {
        result: buildDoctorResult(checks, topStatus, artifactSummary, candidateCommands),
        warnings,
        status: topStatus,
        sourceFiles,
      };
    }

    const [selectorKind, selectorValue] = stepSelectors[0];
    const matchedSteps: Array<{ version: string | null; name: string | null; sequence_number: string | null }> = [];
    const candidateStepNames = new Set<string>();
    const candidateSequences = new Set<string>();
    for (const version of versions) {
      for (const step of version.steps) {
        if (step.name) {
          candidateStepNames.add(step.name);
        }
        if (step.sequenceNumber != null) {
          candidateSequences.add(String(step.sequenceNumber));
        }
        if (matchStep(selectorKind, selectorValue, step)) {
          matchedSteps.push({
            version: version.fullName,
            name: step.name,
            sequence_number: step.sequenceNumber,
          });
        }
      }
    }

    if (matchedSteps.length === 0) {
      checks.push(
        doctorCheck(
          'step_not_found',
          'blocked',
          'Step selector did not match any steps in the selected version scope.',
          {
            selector_kind: selectorKind,
            selector_value: selectorValue,
            candidate_step_names: Array.from(candidateStepNames).sort().slice(0, 20),
            candidate_sequences: Array.from(candidateSequences)
              .sort((left, right) => {
                const leftNumber = /^\d+$/.test(left) ? Number(left) : Number.MAX_SAFE_INTEGER;
                const rightNumber = /^\d+$/.test(right) ? Number(right) : Number.MAX_SAFE_INTEGER;
                return leftNumber - rightNumber || left.localeCompare(right);
              })
              .slice(0, 20),
          },
          'Use summarize to inspect available steps, then rerun doctor or inspect-step with an exact selector.',
        ),
      );
      topStatus = 'no_match';
      candidateCommands = ['summarize', 'inspect-step', 'explain-error'];
      return {
        result: buildDoctorResult(checks, topStatus, artifactSummary, candidateCommands),
        warnings,
        status: topStatus,
        sourceFiles,
      };
    }

    checks.push(
      doctorCheck(
        'step_selector',
        'ok',
        'Step selector matched one or more steps.',
        {
          selector_kind: selectorKind,
          selector_value: selectorValue,
          matched_steps: matchedSteps.slice(0, 10),
          match_count: matchedSteps.length,
        },
        'Use inspect-step for exact step detail or crosswalk if the question is about context linkage.',
      ),
    );
  }

  if (args.context) {
    sourceFiles.push(args.context);
    if (!existsSync(args.context)) {
      checks.push(
        doctorCheck(
          'missing_context_definition',
          'warn',
          'Context definition file is missing, so exact companion checks cannot complete.',
          {
            path: args.context,
            expected_context_definitions: artifact.context_definitions,
            candidate_context_files: contextCandidates(process.cwd(), artifact.context_definitions),
          },
          'Provide a valid ContextDefinition file to enable exact companion and crosswalk checks.',
        ),
      );
      topStatus = 'partial';
      candidateCommands = ['crosswalk', 'validate', 'explain-error'];
    } else {
      try {
        const context = loadContextDefinition(args.context);
        checks.push(
          doctorCheck(
            'context_definition',
            'ok',
            'Context definition loaded successfully.',
            {
              path: args.context,
              attribute_count: Object.keys(context.attributes).length,
              tag_count: Object.keys(context.tags).length,
              query_attribute_count: Object.keys(context.query_attributes).length,
            },
            'Use crosswalk or validate with the same context file for exact companion checks.',
          ),
        );
      } catch (error) {
        const cliError = error instanceof PricingCliError
          ? error
          : new PricingCliError(
              'internal_contract_error',
              error instanceof Error ? error.message : 'Unknown doctor failure.',
              {},
              'Inspect the doctor workflow implementation and rerun.',
            );
        checks.push(doctorCheck(cliError.code, 'warn', cliError.message, cliError.details, cliError.suggestion));
        topStatus = 'partial';
        candidateCommands = ['crosswalk', 'validate', 'explain-error'];
      }
    }
  }

  return {
    result: buildDoctorResult(checks, topStatus, artifactSummary, candidateCommands),
    warnings,
    status: topStatus,
    sourceFiles,
  };
}

function runDoctorRepoInternal(args: DoctorArgs): {
  result: DoctorResult;
  warnings: Notice[];
  status: DoctorTopStatus;
  sourceFiles: string[];
} {
  const checks: DoctorCheck[] = [];
  const warnings: Notice[] = [];
  const sourceFiles = [args.repo!];
  let candidateCommands = ['discover'];
  const rootPath = args.repo!;

  if (!existsSync(rootPath)) {
    checks.push(
      doctorCheck(
        'repo_scan_root_not_found',
        'blocked',
        'Repo scan root does not exist.',
        { path: rootPath },
        'Provide a valid repo path and rerun doctor or discover.',
      ),
    );
    const topStatus: DoctorTopStatus = 'warn';
    return {
      result: buildDoctorResult(checks, topStatus, null, candidateCommands, {
        candidate_file_count: 0,
        pricing_procedure_count: 0,
        matched_artifact_count: 0,
      }),
      warnings,
      status: topStatus,
      sourceFiles,
    };
  }

  let candidateFileCount = 0;
  const pricingArtifacts: NormalizedProcedureArtifact[] = [];
  const matchedArtifacts: ProcedureArtifactSummary[] = [];
  let truncatedCount: number | null = null;
  let topStatus: DoctorTopStatus = 'ok';

  try {
    for (const item of iterRepoExpressionSets(rootPath)) {
      if (typeof item !== 'string' && item[0] === '__TRUNCATED__') {
        truncatedCount = item[1];
        continue;
      }
      if (typeof item !== 'string') {
        warnings.push(
          doctorNotice(
            item[0],
            'Symlink skipped during repo scan.',
            { path: item[1] },
            'Use a real file path in v1; symlinks are not followed.',
          ),
        );
        continue;
      }
      candidateFileCount += 1;

      let artifact: NormalizedProcedureArtifact;
      try {
        artifact = loadExpressionSet(item);
      } catch (error) {
        const cliError = error instanceof PricingCliError
          ? error
          : new PricingCliError(
              'internal_contract_error',
              error instanceof Error ? error.message : 'Unknown repo doctor failure.',
              {},
              'Inspect the doctor workflow implementation and rerun.',
            );
        warnings.push(doctorNotice(cliError.code, cliError.message, cliError.details, cliError.suggestion));
        continue;
      }

      if (!artifact.is_pricing_procedure) {
        continue;
      }
      pricingArtifacts.push(artifact);

      let versions = artifact.versions;
      if (args.version) {
        try {
          versions = selectVersions(versions, args.version);
        } catch (error) {
          const cliError = error instanceof PricingCliError
            ? error
            : new PricingCliError(
                'internal_contract_error',
                error instanceof Error ? error.message : 'Unknown repo doctor failure.',
                {},
                'Inspect the doctor workflow implementation and rerun.',
              );
          checks.push(doctorCheck(cliError.code, 'blocked', cliError.message, cliError.details, cliError.suggestion));
          topStatus = cliError.code === 'invalid_selector_format' ? 'unsupported' : 'warn';
          return {
            result: buildDoctorResult(checks, topStatus, null, ['discover', 'explain-error'], {
              candidate_file_count: candidateFileCount,
              pricing_procedure_count: pricingArtifacts.length,
              matched_artifact_count: matchedArtifacts.length,
            }),
            warnings,
            status: topStatus,
            sourceFiles,
          };
        }
      }

      if (versions.length === 0) {
        continue;
      }

      const stepSelectors = stepSelectorDetails(args);
      if (stepSelectors.length > 0) {
        if (stepSelectors.length !== 1) {
          checks.push(
            doctorCheck(
              'invalid_selector_format',
              'blocked',
              'Doctor supports exactly one step selector family at a time.',
              { received: Object.fromEntries(stepSelectors) },
              'Use exactly one of: --step-name or --sequence.',
            ),
          );
          topStatus = 'unsupported';
          return {
            result: buildDoctorResult(checks, topStatus, null, ['discover', 'explain-error'], {
              candidate_file_count: candidateFileCount,
              pricing_procedure_count: pricingArtifacts.length,
              matched_artifact_count: matchedArtifacts.length,
            }),
            warnings,
            status: topStatus,
            sourceFiles,
          };
        }

        const [selectorKind, selectorValue] = stepSelectors[0];
        const stepMatch = versions.some((version) => version.steps.some((step) => matchStep(selectorKind, selectorValue, step)));
        if (!stepMatch) {
          continue;
        }
      }

      matchedArtifacts.push(summarizeArtifact({ ...artifact, versions }));
    }
  } catch (error) {
    const cliError = error instanceof PricingCliError
      ? error
      : new PricingCliError(
          'internal_contract_error',
          error instanceof Error ? error.message : 'Unknown repo doctor failure.',
          {},
          'Inspect the doctor workflow implementation and rerun.',
        );
    checks.push(doctorCheck(cliError.code, 'blocked', cliError.message, cliError.details, cliError.suggestion));
    topStatus = 'warn';
    return {
      result: buildDoctorResult(checks, topStatus, null, candidateCommands, {
        candidate_file_count: candidateFileCount,
        pricing_procedure_count: pricingArtifacts.length,
        matched_artifact_count: matchedArtifacts.length,
      }),
      warnings,
      status: topStatus,
      sourceFiles,
    };
  }

  checks.push(
    doctorCheck(
      'repo_scan',
      'ok',
      'Repo scan completed.',
      {
        path: rootPath,
        candidate_file_count: candidateFileCount,
        pricing_procedure_count: pricingArtifacts.length,
      },
      'Use discover --repo for a broader inventory or summarize/inspect-step on a matched file.',
    ),
  );

  if (matchedArtifacts.length === 0) {
    checks.push(
      doctorCheck(
        args.version ? 'version_not_found' : 'file_not_found',
        'blocked',
        'No pricing procedure artifacts matched the requested repo-level filters.',
        {
          version: args.version ?? null,
          step_name: args.stepName ?? null,
          sequence: args.sequence ?? null,
          pricing_procedure_count: pricingArtifacts.length,
        },
        'Relax the filters or narrow the repo path toward the expected metadata directory.',
      ),
    );
    topStatus = 'no_match';
    candidateCommands = ['discover', 'summarize'];
  } else {
    checks.push(
      doctorCheck(
        'repo_matches',
        'ok',
        'Repo scan found one or more pricing procedure candidates that satisfy the requested filters.',
        { matched_artifact_count: matchedArtifacts.length },
        'Use discover for the full inventory or summarize on one matched file for detail.',
      ),
    );
    candidateCommands = ['discover', 'summarize'];
  }

  if (truncatedCount != null) {
    checks.push(
      doctorCheck(
        'repo_scan_truncated',
        'warn',
        'Repo scan hit the candidate-file limit before completing.',
        { candidate_file_count: truncatedCount },
        'Narrow the repo path and rerun doctor or discover.',
      ),
    );
    topStatus = 'partial';
  } else if (warnings.length > 0 && topStatus === 'ok') {
    topStatus = 'warn';
  }

  return {
    result: buildDoctorResult(checks, topStatus, null, candidateCommands, {
      candidate_file_count: candidateFileCount,
      pricing_procedure_count: pricingArtifacts.length,
      matched_artifact_count: matchedArtifacts.length,
      matched_artifacts: matchedArtifacts.slice(0, 10),
    }),
    warnings,
    status: topStatus,
    sourceFiles,
  };
}

export function runDoctor(args: DoctorArgs, startedAt: number): Envelope<DoctorResult> {
  const outcome = args.file ? runDoctorFileInternal(args) : runDoctorRepoInternal(args);
  const primarySubject = args.file ?? args.repo ?? '';
  const nextCommand = outcome.result.readiness === 'ready' || outcome.result.readiness === 'ready_with_warnings'
    ? 'summarize'
    : 'explain-error';

  return makeEnvelope(
    'doctor',
    makeSummary(
      primarySubject,
      'Doctor completed.',
      {
        total: outcome.result.check_counts.total,
        by_status: outcome.result.check_counts.by_status,
      },
      nextCommand,
    ),
    outcome.result,
    {
      warnings: outcome.warnings,
      status: outcome.status,
      source_files: outcome.sourceFiles,
      selector_input: {
        version: args.version ?? null,
        step_name: args.stepName ?? null,
        sequence: args.sequence ?? null,
        context: args.context ?? null,
      },
      partial_reason: outcome.status === 'partial' ? 'companion artifact check incomplete' : undefined,
      started_at: startedAt,
    },
  );
}
