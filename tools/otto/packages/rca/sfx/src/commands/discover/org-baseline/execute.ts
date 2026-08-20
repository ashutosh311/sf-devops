import { executeSfCommand, type Status } from '@otto/rca-cli-core';

import type {
  OrgAccessAssessment,
  OrgBaselineDetailLevel,
  OrgInspectionSnapshot,
  OrgInspectionWarning,
  SfInstalledPackageRecord,
  SfMetadataCoverage,
  SfOrgIdentity,
} from '../../../adapters/salesforce/org-inspection';
import { createDiscoveryCommandMeta } from '../../../runtime/envelope';
import { commandToSlug } from '../../../runtime/ids';
import { LocalFileRunManager } from '../../../runtime/run-manager';
import { buildOrgBaselineEnvelopeFromSnapshot } from './build-org-baseline-result';
import type {
  ExecuteOrgBaselineOptions,
  OrgBaselineCommandRunner,
  OrgBaselineEnvelope,
  OrgBaselineExecutionResult,
  OrgBaselineRunnerResult,
} from './types';

const ORG_BASELINE_COMMAND = 'sfx discover org-baseline';

export class SystemOrgBaselineCommandRunner implements OrgBaselineCommandRunner {
  async runSf(args: string[]): Promise<OrgBaselineRunnerResult> {
    try {
      // cli-core's shared runner passes through Node's execFile defaults when no
      // options are given, matching this runner's historical subprocess semantics.
      // It maps ExecFileException rejections (stdout/stderr strings, numeric-code
      // guard) itself and rethrows anything else.
      const result = await executeSfCommand('sf', args);
      if (result.exitCode === 0) {
        // Preserve the historical mapping: stderr was discarded on success.
        return { stdout: result.stdout, stderr: '', exitCode: 0 };
      }
      return { stdout: result.stdout, stderr: result.stderr, exitCode: result.exitCode };
    } catch (error) {
      // Non-ExecFile errors rethrown by the shared runner — preserve the legacy
      // defensive mapping (code may be a string or null for system-level errors).
      return {
        stdout: typeof error === 'object' && error !== null && 'stdout' in error ? String(error.stdout) : '',
        stderr: typeof error === 'object' && error !== null && 'stderr' in error ? String(error.stderr) : '',
        exitCode: typeof error === 'object' && error !== null && 'code' in error && typeof error.code === 'number' ? error.code : 1,
      };
    }
  }
}

function normalizeStdout(value: string): string | null {
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function normalizeMessage(value: string): string {
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : 'No additional diagnostic detail was provided by Salesforce CLI.';
}

function shellQuote(value: string): string {
  return /^[A-Za-z0-9_./:-]+$/.test(value)
    ? value
    : `'${value.replace(/'/g, `'\\''`)}'`;
}

function buildOrgBaselineCommand(org: string, detail: OrgBaselineDetailLevel): string {
  return `${ORG_BASELINE_COMMAND} --org ${shellQuote(org)} --detail ${shellQuote(detail)} --json`;
}

function tryParseJson<T>(value: string): T | null {
  const trimmed = value.trim();
  if (trimmed.length === 0) {
    return null;
  }

  try {
    return JSON.parse(trimmed) as T;
  } catch {
    return null;
  }
}

function recordWarning(warnings: OrgInspectionWarning[], code: string, message: string): void {
  warnings.push({ code, message });
}

function isAccessDegradationWarning(warning: Pick<OrgInspectionWarning, 'code'>): boolean {
  return warning.code === 'ORG_DISPLAY_FAILED' || warning.code === 'ORG_LIST_PARTIAL';
}

function hasAccessDegradation(warnings: readonly OrgInspectionWarning[]): boolean {
  return warnings.some((warning) => isAccessDegradationWarning(warning));
}

function buildExecutionSummary(options: { hasWarnings: boolean; hasAccessDegradation: boolean }): string {
  if (!options.hasWarnings) {
    return 'Authenticated org baseline captured successfully.';
  }

  if (options.hasAccessDegradation) {
    return 'Org baseline captured with degraded org access; completeness is provisional until auth/access issues are resolved.';
  }

  return 'Org baseline captured with partial completeness; org access remained available during capture.';
}

function parseOrgIdentity(result: OrgBaselineRunnerResult, orgAlias: string, warnings: OrgInspectionWarning[], limitations: string[]): SfOrgIdentity {
  const parsed = tryParseJson<{
    result?: {
      alias?: string;
      username?: string;
      edition?: string;
      instanceUrl?: string;
      isSandbox?: boolean;
      isScratchOrg?: boolean;
      isDevHub?: boolean;
      id?: string;
      orgId?: string;
      loginUrl?: string;
    };
    message?: string;
    name?: string;
  }>(result.stdout);

  if (result.exitCode !== 0 || !parsed?.result) {
    recordWarning(warnings, 'ORG_DISPLAY_FAILED', `Salesforce CLI org display failed for ${orgAlias}: ${normalizeMessage(result.stderr || result.stdout)}`);
    limitations.push('Org identity details could not be fully confirmed from Salesforce CLI org display output.');
    return { alias: orgAlias };
  }

  const display = parsed.result;
  const username = typeof display.username === 'string' ? display.username : undefined;
  const edition = typeof display.edition === 'string' ? display.edition : undefined;
  const instanceUrl = typeof display.instanceUrl === 'string' ? display.instanceUrl : undefined;
  const isSandbox = typeof display.isSandbox === 'boolean'
    ? display.isSandbox
    : instanceUrl !== undefined
      ? /\.sandbox\.my\.salesforce\.com$/i.test(instanceUrl)
      : undefined;

  return {
    alias: typeof display.alias === 'string' && display.alias.length > 0 ? display.alias : orgAlias,
    username,
    edition,
    instanceUrl,
    isSandbox,
    isScratchOrg: typeof display.isScratchOrg === 'boolean' ? display.isScratchOrg : undefined,
    isDeveloperEdition: edition ? /developer/i.test(edition) : undefined,
  };
}

function parseInstalledPackages(result: OrgBaselineRunnerResult, warnings: OrgInspectionWarning[], limitations: string[]): SfInstalledPackageRecord[] {
  const parsed = tryParseJson<{
    result?: Array<{
      SubscriberPackageName?: string;
      subscriberPackageName?: string;
      SubscriberPackageNamespace?: string | null;
      subscriberPackageNamespace?: string | null;
      SubscriberPackageVersionNumber?: string | null;
      subscriberPackageVersionNumber?: string | null;
      IsManaged?: boolean;
      isManaged?: boolean;
    }>;
  }>(result.stdout);

  if (result.exitCode !== 0 || !Array.isArray(parsed?.result)) {
    recordWarning(warnings, 'ORG_PACKAGES_PARTIAL', `Installed package inventory could not be fully captured: ${normalizeMessage(result.stderr || result.stdout)}`);
    limitations.push('Installed package inventory may be incomplete because Salesforce CLI package listing was unavailable.');
    return [];
  }

  return parsed.result
    .map((entry) => ({
      subscriberPackageName: entry.SubscriberPackageName ?? entry.subscriberPackageName ?? 'unknown',
      subscriberPackageNamespace: entry.SubscriberPackageNamespace ?? entry.subscriberPackageNamespace ?? null,
      subscriberPackageVersionNumber: entry.SubscriberPackageVersionNumber ?? entry.subscriberPackageVersionNumber ?? null,
      isManaged: typeof entry.IsManaged === 'boolean' ? entry.IsManaged : typeof entry.isManaged === 'boolean' ? entry.isManaged : undefined,
    }))
    .filter((entry) => entry.subscriberPackageName !== 'unknown');
}

function parseCountResult(result: OrgBaselineRunnerResult): number | null {
  const parsed = tryParseJson<{
    result?: {
      totalSize?: number;
      records?: Array<Record<string, unknown>>;
    };
  }>(result.stdout);

  if (result.exitCode !== 0 || !parsed?.result) {
    return null;
  }

  const records = Array.isArray(parsed.result.records) ? parsed.result.records : [];
  const firstRecord = records[0];
  if (firstRecord && typeof firstRecord === 'object') {
    for (const key of ['total', 'expr0', 'count']) {
      const value = firstRecord[key];
      if (typeof value === 'number' && Number.isFinite(value)) {
        return value;
      }
      if (typeof value === 'string' && /^\d+$/.test(value)) {
        return Number.parseInt(value, 10);
      }
    }
  }

  if (typeof parsed.result.totalSize === 'number' && Number.isFinite(parsed.result.totalSize)) {
    return parsed.result.totalSize;
  }

  return null;
}

interface QueryCountOutcome {
  count: number | undefined;
  warning?: { code: string; message: string };
  limitation?: string;
}

async function queryCount(
  runner: OrgBaselineCommandRunner,
  org: string,
  soql: string,
  warningCode: string,
  limitation: string,
): Promise<QueryCountOutcome> {
  const result = await runner.runSf(['data', 'query', '--target-org', org, '--use-tooling-api', '--query', soql, '--json']);
  const count = parseCountResult(result);
  if (count === null) {
    return {
      count: undefined,
      warning: { code: warningCode, message: `${warningCode}: ${normalizeMessage(result.stderr || result.stdout)}` },
      limitation,
    };
  }

  return { count };
}

const STANDARD_METADATA_QUERIES = {
  flows: {
    soql: 'SELECT COUNT(Id) total FROM FlowDefinition',
    warningCode: 'ORG_METADATA_FLOWS_PARTIAL',
    limitation: 'Flow metadata coverage could not be fully enumerated during the baseline pass.',
  },
  apexClasses: {
    soql: 'SELECT COUNT(Id) total FROM ApexClass',
    warningCode: 'ORG_METADATA_APEX_CLASSES_PARTIAL',
    limitation: 'Apex class coverage could not be fully enumerated during the baseline pass.',
  },
  triggers: {
    soql: 'SELECT COUNT(Id) total FROM ApexTrigger',
    warningCode: 'ORG_METADATA_TRIGGERS_PARTIAL',
    limitation: 'Trigger coverage could not be fully enumerated during the baseline pass.',
  },
  validationRules: {
    soql: 'SELECT COUNT(Id) total FROM ValidationRule',
    warningCode: 'ORG_METADATA_VALIDATION_RULES_PARTIAL',
    limitation: 'Validation rule coverage could not be fully enumerated during the baseline pass.',
  },
  connectedApps: {
    soql: 'SELECT COUNT(Id) total FROM ConnectedApplication',
    warningCode: 'ORG_METADATA_CONNECTED_APPS_PARTIAL',
    limitation: 'Connected app coverage could not be fully enumerated during the baseline pass.',
  },
  namedCredentials: {
    soql: 'SELECT COUNT(Id) total FROM NamedCredential',
    warningCode: 'ORG_METADATA_NAMED_CREDENTIALS_PARTIAL',
    limitation: 'Named credential coverage could not be fully enumerated during the baseline pass.',
  },
  externalCredentials: {
    soql: 'SELECT COUNT(Id) total FROM ExternalCredential',
    warningCode: 'ORG_METADATA_EXTERNAL_CREDENTIALS_PARTIAL',
    limitation: 'External credential coverage could not be fully enumerated during the baseline pass.',
  },
} satisfies Record<string, { soql: string; warningCode: string; limitation: string }>;

const DEEP_METADATA_QUERIES = {
  permissionSets: {
    soql: 'SELECT COUNT(Id) total FROM PermissionSet',
    warningCode: 'ORG_METADATA_PERMISSION_SETS_PARTIAL',
    limitation: 'Permission set coverage could not be fully enumerated during the baseline pass.',
  },
  profiles: {
    soql: 'SELECT COUNT(Id) total FROM Profile',
    warningCode: 'ORG_METADATA_PROFILES_PARTIAL',
    limitation: 'Profile coverage could not be fully enumerated during the baseline pass.',
  },
  roles: {
    soql: 'SELECT COUNT(Id) total FROM UserRole',
    warningCode: 'ORG_METADATA_ROLES_PARTIAL',
    limitation: 'Role coverage could not be fully enumerated during the baseline pass.',
  },
} satisfies Record<string, { soql: string; warningCode: string; limitation: string }>;

// Maximum number of concurrent Tooling API count queries per batch. Capped to
// avoid hitting per-minute API rate limits on orgs with strict governance.
const QUERY_CONCURRENCY_LIMIT = 5;

async function applyMetadataQueries(
  coverage: SfMetadataCoverage,
  queries: Record<string, { soql: string; warningCode: string; limitation: string }>,
  runner: OrgBaselineCommandRunner,
  org: string,
  warnings: OrgInspectionWarning[],
  limitations: string[],
): Promise<void> {
  const entries = Object.entries(queries);

  // Fire queries in batches of QUERY_CONCURRENCY_LIMIT to bound concurrent org requests.
  // Each task captures the coverageKey so results can be applied in the original entry
  // order after all parallel tasks complete (preserves deterministic warning/limitation ordering).
  const outcomes: Array<{ coverageKey: string } & QueryCountOutcome> = [];
  for (let i = 0; i < entries.length; i += QUERY_CONCURRENCY_LIMIT) {
    const chunk = entries.slice(i, i + QUERY_CONCURRENCY_LIMIT);
    const chunkOutcomes = await Promise.all(
      chunk.map(async ([coverageKey, query]) => {
        const outcome = await queryCount(runner, org, query.soql, query.warningCode, query.limitation);
        return { coverageKey, ...outcome };
      }),
    );
    outcomes.push(...chunkOutcomes);
  }

  // Apply all results serially in original entry order to keep warnings/limitations arrays deterministic.
  for (const { coverageKey, count, warning, limitation } of outcomes) {
    if (warning !== undefined) {
      recordWarning(warnings, warning.code, warning.message);
    }
    if (limitation !== undefined) {
      limitations.push(limitation);
    }
    if (count !== undefined) {
      coverage[coverageKey as keyof SfMetadataCoverage] = count;
    }
  }
}

async function collectMetadataCoverage(
  runner: OrgBaselineCommandRunner,
  org: string,
  detail: OrgBaselineDetailLevel,
  warnings: OrgInspectionWarning[],
  limitations: string[],
): Promise<SfMetadataCoverage> {
  const coverage: SfMetadataCoverage = {};
  await applyMetadataQueries(coverage, STANDARD_METADATA_QUERIES, runner, org, warnings, limitations);

  if (detail === 'deep') {
    await applyMetadataQueries(coverage, DEEP_METADATA_QUERIES, runner, org, warnings, limitations);
  }

  return coverage;
}

function deriveIntegrationSignals(packages: readonly SfInstalledPackageRecord[], coverage: SfMetadataCoverage): string[] {
  const signals: string[] = [];

  if ((coverage.connectedApps ?? 0) > 0 || (coverage.namedCredentials ?? 0) > 0 || (coverage.externalCredentials ?? 0) > 0) {
    signals.push('Connected apps or credential metadata indicate org-to-system integration patterns.');
  }

  if (packages.some((pkg) => /sbqq|cpq|revenue|billing/i.test(`${pkg.subscriberPackageNamespace ?? ''} ${pkg.subscriberPackageName}`))) {
    signals.push('Managed package signals suggest revenue lifecycle customization may be present.');
  }

  if ((coverage.flows ?? 0) > 0 && ((coverage.apexClasses ?? 0) > 0 || (coverage.triggers ?? 0) > 0)) {
    signals.push('Flow and Apex footprints indicate a mixed declarative and programmatic automation surface.');
  }

  return signals;
}

function dedupeStrings(values: readonly string[]): string[] {
  return Array.from(new Set(values));
}

async function buildSnapshot(options: {
  org: string;
  detail: OrgBaselineDetailLevel;
  runner: OrgBaselineCommandRunner;
}): Promise<{ snapshot: OrgInspectionSnapshot; status: Status; summary: string; logLines: string[] }> {
  const warnings: OrgInspectionWarning[] = [];
  const limitations: string[] = [];
  const orgDisplayResult = await options.runner.runSf(['org', 'display', '--target-org', options.org, '--json']);
  const orgIdentity = parseOrgIdentity(orgDisplayResult, options.org, warnings, limitations);
  const installedPackages = parseInstalledPackages(
    await options.runner.runSf(['package', 'installed', 'list', '--target-org', options.org, '--json']),
    warnings,
    limitations,
  );

  const metadataCoverage = options.detail === 'low'
    ? {}
    : await collectMetadataCoverage(options.runner, options.org, options.detail, warnings, limitations);

  const accessAssessment: OrgAccessAssessment = {
    status: hasAccessDegradation(warnings) ? 'partial' : 'available',
    checkedWith: 'direct_org_probe',
    authenticatedAliasesCount: orgDisplayResult.exitCode === 0 ? 1 : 0,
    defaultOrgAccessible: orgDisplayResult.exitCode === 0,
  };

  const snapshot: OrgInspectionSnapshot = {
    org: orgIdentity,
    detail: options.detail,
    installedPackages,
    metadataCoverage,
    integrationSignals: deriveIntegrationSignals(installedPackages, metadataCoverage),
    warnings,
    limitations: dedupeStrings(limitations),
    accessAssessment,
  };

  const status: Status = warnings.length === 0 ? 'ok' : 'partial';
  const summary = buildExecutionSummary({
    hasWarnings: warnings.length > 0,
    hasAccessDegradation: hasAccessDegradation(warnings),
  });

  return {
    snapshot,
    status,
    summary,
    logLines: [
      `org=${options.org}`,
      `detail=${options.detail}`,
      `status=${status}`,
      `warnings=${warnings.length}`,
      `limitations=${dedupeStrings(limitations).length}`,
      `installed_packages=${installedPackages.length}`,
      `flows=${metadataCoverage.flows ?? 'unknown'}`,
      `apex_classes=${metadataCoverage.apexClasses ?? 'unknown'}`,
      `triggers=${metadataCoverage.triggers ?? 'unknown'}`,
      `validation_rules=${metadataCoverage.validationRules ?? 'unknown'}`,
      `permission_sets=${metadataCoverage.permissionSets ?? 'unknown'}`,
      `profiles=${metadataCoverage.profiles ?? 'unknown'}`,
      `connected_apps=${metadataCoverage.connectedApps ?? 'unknown'}`,
      `named_credentials=${metadataCoverage.namedCredentials ?? 'unknown'}`,
      `external_credentials=${metadataCoverage.externalCredentials ?? 'unknown'}`,
      `roles=${metadataCoverage.roles ?? 'unknown'}`,
    ],
  };
}

function collectRecommendedNextCommands(envelope: OrgBaselineEnvelope): string[] {
  return envelope.result.recommended_next_steps
    .filter((step) => step.step_type === 'command' && step.text.startsWith('Run '))
    .map((step) => step.text.slice('Run '.length));
}

export async function executeOrgBaseline(options: ExecuteOrgBaselineOptions): Promise<OrgBaselineExecutionResult> {
  const detail = options.detail ?? 'standard';
  const command = buildOrgBaselineCommand(options.org, detail);
  const commandSlug = commandToSlug(ORG_BASELINE_COMMAND);
  const runManager = options.runManager ?? new LocalFileRunManager();
  const runner = options.runner ?? new SystemOrgBaselineCommandRunner();
  const prepared = runManager.prepareCommandExecution({
    repoRoot: options.repoRoot,
    artifactRoot: options.artifactRoot,
    command,
    commandSlug,
    inputs: {
      org: options.org,
      detail,
    },
    runId: options.appendRunId,
    newRun: options.newRun,
    outputFormat: 'json',
  });

  const execution = await buildSnapshot({
    org: options.org,
    detail,
    runner,
  });

  const baseMeta = createDiscoveryCommandMeta({
    runId: prepared.runId,
    commandExecutionId: prepared.commandExecutionId,
    commandSlug: prepared.commandSlug,
    outputArtifactPaths: [prepared.outputArtifactRelativePath],
    evidenceArtifactPaths: [],
    logArtifactPath: prepared.logArtifactRelativePath,
    stats: {
      installed_package_count: execution.snapshot.installedPackages.length,
      integration_signal_count: execution.snapshot.integrationSignals?.length ?? 0,
      warning_count: execution.snapshot.warnings?.length ?? 0,
      limitation_count: execution.snapshot.limitations?.length ?? 0,
    },
    effectiveFailOn: options.failOn,
  });

  const provisionalEnvelope = buildOrgBaselineEnvelopeFromSnapshot({
    command,
    status: execution.status,
    summary: execution.summary,
    snapshot: execution.snapshot,
    meta: baseMeta,
  });

  const envelope = buildOrgBaselineEnvelopeFromSnapshot({
    command,
    status: execution.status,
    summary: execution.summary,
    snapshot: execution.snapshot,
    meta: createDiscoveryCommandMeta({
      runId: prepared.runId,
      commandExecutionId: prepared.commandExecutionId,
      commandSlug: prepared.commandSlug,
      outputArtifactPaths: [prepared.outputArtifactRelativePath],
      evidenceArtifactPaths: [],
      logArtifactPath: prepared.logArtifactRelativePath,
      recommendedNextCommands: collectRecommendedNextCommands(provisionalEnvelope),
      stats: baseMeta.stats,
      effectiveFailOn: options.failOn,
    }),
  });

  runManager.finalizeCommandExecution({
    prepared,
    status: envelope.status,
    envelope,
    inputs: {
      org: options.org,
      detail,
    },
    warnings: envelope.warnings.map((warning) => warning.message),
    logLines: [
      `command=${command}`,
      `run_id=${prepared.runId}`,
      `command_execution_id=${prepared.commandExecutionId}`,
      ...execution.logLines,
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
