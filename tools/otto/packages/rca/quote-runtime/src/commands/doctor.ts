import { Flags, Parser } from '@oclif/core';

import type { GlobalFlags } from '../cli/global-flags';
import { emitJsonOutput, emitTextOutput, type CliIo } from '../cli/output';
import { runEnvelopeCommand, type EnvelopeCommandSpec } from '../cli/run-envelope-command';
import { exitCodeForStatus, makeEnvelope, type JsonValue, type ResultEnvelope } from '../contracts/result-envelope';
import type { RuntimeStatus } from '../contracts/status';
import { invokeSfJson, type InvokeSfJsonOptions, type SfCliJsonResult } from '../integrations/salesforce/sf-cli';
import { buildSoqlSelect, escapeSoqlStringLiteral } from '../integrations/salesforce/soql';
import {
  getCommandReadinessIssuesForCommand,
  getCommandSelectorPolicy,
  getDoctorNextSuggestedCommand,
  getDoctorRecommendedNextCommands,
  getMissingRequiredSelectorsForCommand,
  type SelectorKey
} from '../routing/selector-functions';
import { normalizeSelectors, type RuntimeSelectorBundle } from '../selectors/runtime-selectors';

export const DOCTOR_HELP_TEXT = [
  'quote-runtime doctor',
  '',
  'Usage:',
  '  quote-runtime doctor --org-alias <alias> --for-command <subcommand>',
  '',
  'Global flags:',
  '  --json',
  '  --org-alias <alias>',
  '  --fail-on <status>',
  '  --output <path>',
  '  --verbose',
  '',
  'Doctor flags:',
  '  --for-command <subcommand>',
  '  --quote-id <id>',
  '  --line-id <id>',
  '  --asset-id <id>',
  '',
  'Notes:',
  '  doctor validates selector fit for the requested command.',
  '  doctor verifies local Salesforce CLI availability and org alias/auth viability when possible.',
  '  doctor attempts one safe read-only Organization query proof after org access is confirmed.',
  '',
  'Examples:',
  '  quote-runtime doctor --org-alias <alias> --for-command doctor',
  '  quote-runtime doctor --org-alias <alias> --for-command snapshot-quote --quote-id <id>'
].join('\n');

const DOCTOR_FLAG_DEFINITIONS = {
  'for-command': Flags.string({
    required: true,
    helpValue: '<subcommand>',
    summary: 'Check selector and live-readiness fit for the named quote-runtime command.'
  }),
  'quote-id': Flags.string({
    helpValue: '<id>',
    summary: 'Target quote id for command-specific preflight.'
  }),
  'line-id': Flags.string({
    helpValue: '<id>',
    multiple: true,
    summary: 'Optional repeatable line id narrowing.'
  }),
  'asset-id': Flags.string({
    helpValue: '<id>',
    multiple: true,
    summary: 'Optional repeatable asset id narrowing.'
  })
};

const SAFE_ORG_READINESS_PROOF_QUERY = buildSoqlSelect({
  objectName: 'Organization',
  fields: ['Id', 'InstanceName'],
  limit: 1
});

export type DoctorCommandFlags = {
  forCommand: string | undefined;
  quoteId: string | undefined;
  lineIds: string[];
  assetIds: string[];
};

export type DoctorCheck = {
  scope: 'global' | 'command' | 'live';
  key: string;
  status: 'ok' | 'missing';
  message: string;
};

export type DoctorResult = {
  subjects: {
    org_alias: string | null;
    for_command: string | null;
    quote_id: string | null;
    line_ids: string[];
    asset_ids: string[];
  };
  checks: DoctorCheck[];
  missing_requirements: string[];
  warnings?: string[];
  recommended_next_commands: string[];
};

export type DoctorExecution = {
  envelope: ResultEnvelope;
  text: string;
  exitCode: 0 | 1;
};

export type DoctorCommandDependencies = {
  invokeSfJson?: <T>(options: InvokeSfJsonOptions) => Promise<SfCliJsonResult<T>>;
  resolveCliPath?: () => string | null;
};

export type BuildDoctorEnvelopeInput = {
  globalFlags: GlobalFlags;
  doctorFlags: DoctorCommandFlags;
  liveChecks?: DoctorCheck[];
  generatedAt?: string;
  durationMs?: number;
};

type SfVersionPayload = {
  cliVersion?: string;
  architecture?: string;
  nodeVersion?: string;
};

type SfOrgDisplayPayload = {
  id?: string;
  username?: string;
  accessToken?: string;
};

type SfQueryPayload = {
  totalSize?: number;
  records?: unknown[];
};

export async function parseDoctorFlags(argv: string[]): Promise<DoctorCommandFlags> {
  const parsed = (await Parser.parse(argv, {
    args: {},
    enableJsonFlag: false,
    flags: DOCTOR_FLAG_DEFINITIONS,
    strict: true
  })) as {
    flags: {
      'for-command'?: string;
      'quote-id'?: string;
      'line-id'?: string[];
      'asset-id'?: string[];
    };
  };

  return {
    forCommand: parsed.flags['for-command'],
    quoteId: parsed.flags['quote-id'],
    lineIds: parsed.flags['line-id'] ?? [],
    assetIds: parsed.flags['asset-id'] ?? []
  };
}

export function renderDoctorHelp(): string {
  return DOCTOR_HELP_TEXT;
}

export function buildDoctorEnvelope(input: BuildDoctorEnvelopeInput): ResultEnvelope {
  const selectors = normalizeSelectors({
    quote_id: input.doctorFlags.quoteId,
    line_id: input.doctorFlags.lineIds,
    asset_id: input.doctorFlags.assetIds,
    for_command: input.doctorFlags.forCommand
  });

  const selectorChecks = buildDoctorCommandChecks(input.globalFlags, selectors);
  const liveChecks = input.liveChecks ?? [];
  const checks = [...selectorChecks, ...liveChecks];
  const missingRequirements = checks.filter((check) => check.status === 'missing').map((check) => check.key);
  const hasLiveReadinessGaps = liveChecks.some((check) => check.status === 'missing');
  const commandName = selectors.for_command ?? 'doctor';
  const recommendedNextCommands = selectors.for_command && !hasLiveReadinessGaps
    ? getDoctorRecommendedNextCommands(selectors.for_command, selectors)
    : [];
  const nextSuggestedCommand = selectors.for_command && !hasLiveReadinessGaps
    ? getDoctorNextSuggestedCommand(selectors.for_command, selectors)
    : null;
  const status: RuntimeStatus = missingRequirements.length > 0 ? 'warn' : 'ok';
  const warnings = buildDoctorWarnings(selectors, selectorChecks, liveChecks);

  const result: DoctorResult = {
    subjects: {
      org_alias: input.globalFlags.orgAlias ?? null,
      for_command: selectors.for_command,
      quote_id: selectors.quote_id,
      line_ids: selectors.line_ids,
      asset_ids: selectors.asset_ids
    },
    checks,
    missing_requirements: missingRequirements,
    recommended_next_commands: recommendedNextCommands,
    ...(warnings.length > 0 ? { warnings } : {})
  };

  return makeEnvelope({
    command: 'doctor',
    status,
    summary: {
      primary_subject: selectors.for_command ?? 'doctor-preflight',
      status_reason:
        missingRequirements.length > 0
          ? `Doctor found ${missingRequirements.length} missing readiness requirement(s) for live/operator preflight.`
          : `Doctor verified selector and live-readiness prerequisites for ${commandName}.`,
      primary_lane: 'preflight',
      verification_anchor: selectors.for_command ? `requirements:${selectors.for_command}` : 'requirements:doctor',
      next_suggested_command: nextSuggestedCommand
    } satisfies Record<string, JsonValue>,
    result: result as unknown as Record<string, JsonValue>,
    warnings,
    errors: [],
    evidence: [],
    meta: {
      org_alias: input.globalFlags.orgAlias ?? 'unknown',
      generated_at: input.generatedAt ?? new Date().toISOString(),
      duration_ms: input.durationMs ?? 0,
      source_files: []
    }
  });
}

export function renderDoctorText(envelope: ResultEnvelope): string {
  const result = envelope.result as unknown as DoctorResult;
  const lines = [
    'quote-runtime doctor',
    `status: ${envelope.status}`,
    `org alias: ${result.subjects.org_alias ?? '(missing)'}`,
    `for command: ${result.subjects.for_command ?? '(missing)'}`,
    `quote id: ${result.subjects.quote_id ?? '(none)'}`,
    `line ids: ${result.subjects.line_ids.length > 0 ? result.subjects.line_ids.join(', ') : '(none)'}`,
    `asset ids: ${result.subjects.asset_ids.length > 0 ? result.subjects.asset_ids.join(', ') : '(none)'}`,
    '',
    'Checks:'
  ];

  for (const check of result.checks) {
    lines.push(`- [${check.status}] ${check.key}: ${check.message}`);
  }

  lines.push('');
  lines.push('Missing requirements:');

  if (result.missing_requirements.length === 0) {
    lines.push('- (none)');
  } else {
    for (const requirement of result.missing_requirements) {
      lines.push(`- ${requirement}`);
    }
  }

  lines.push('');
  lines.push('Recommended next commands:');

  if (result.recommended_next_commands.length === 0) {
    lines.push('- (none)');
  } else {
    for (const command of result.recommended_next_commands) {
      lines.push(`- ${command}`);
    }
  }

  if (result.warnings?.length) {
    lines.push('');
    lines.push('Warnings:');
    for (const warning of result.warnings) {
      lines.push(`- ${warning}`);
    }
  }

  lines.push('');
  return lines.join('\n');
}

const DOCTOR_SPEC: EnvelopeCommandSpec<DoctorCommandDependencies> = {
  commandName: 'doctor',
  requiresOrgAlias: false,
  execute: async ({ argv, globalFlags, startedAt, deps }) => {
    const doctorFlags = await parseDoctorFlags(argv);
    const liveChecks = await buildDoctorLiveChecks(globalFlags, deps, doctorFlags);
    return buildDoctorEnvelope({
      globalFlags,
      doctorFlags,
      liveChecks,
      durationMs: Math.max(0, Date.now() - startedAt)
    });
  },
  renderText: renderDoctorText
};

export async function runDoctorCommand(
  argv: string[],
  globalFlags: GlobalFlags,
  io: CliIo,
  dependencies: DoctorCommandDependencies = {}
): Promise<DoctorExecution> {
  return runEnvelopeCommand(DOCTOR_SPEC, argv, globalFlags, io, dependencies);
}

const LIFECYCLE_ASSETIZATION_COMMANDS = new Set([
  'inspect-asset-lifecycle',
  'plan-order-activation',
  'activate-order',
  'capture-post-activation-evidence'
]);

type DescribePayload = {
  name?: string;
  queryable?: boolean;
};

async function buildLifecycleAssetizationChecks(
  orgAlias: string,
  invokeWithRuntimeDependencies: <T>(options: InvokeSfJsonOptions) => Promise<SfCliJsonResult<T>>,
  username: string | null
): Promise<DoctorCheck[]> {
  const checks: DoctorCheck[] = [];

  // Check AssetStatePeriod readability (also confirms RLM is enabled)
  const assetStatePeriodDescribe = await invokeWithRuntimeDependencies<DescribePayload>({
    args: ['sobject', 'describe', '--target-org', orgAlias, '--sobject', 'AssetStatePeriod', '--json'],
    orgAlias,
    timeoutMs: 20_000
  });

  checks.push(
    assetStatePeriodDescribe.ok && assetStatePeriodDescribe.data.queryable === true
      ? {
          scope: 'live',
          key: 'lifecycle_assetization.asset_state_period_readable',
          status: 'ok',
          message: `AssetStatePeriod is readable in org '${orgAlias}' — Revenue Lifecycle Management is enabled.`
        }
      : {
          scope: 'live',
          key: 'lifecycle_assetization.asset_state_period_readable',
          status: 'missing',
          message: assetStatePeriodDescribe.ok
            ? `AssetStatePeriod is not queryable in org '${orgAlias}'. Revenue Lifecycle Management may not be enabled.`
            : `AssetStatePeriod describe failed for org '${orgAlias}': ${assetStatePeriodDescribe.message}`
        }
  );

  // Check AssetAction readability
  const assetActionDescribe = await invokeWithRuntimeDependencies<DescribePayload>({
    args: ['sobject', 'describe', '--target-org', orgAlias, '--sobject', 'AssetAction', '--json'],
    orgAlias,
    timeoutMs: 20_000
  });

  checks.push(
    assetActionDescribe.ok && assetActionDescribe.data.queryable === true
      ? {
          scope: 'live',
          key: 'lifecycle_assetization.asset_action_readable',
          status: 'ok',
          message: `AssetAction is readable in org '${orgAlias}'.`
        }
      : {
          scope: 'live',
          key: 'lifecycle_assetization.asset_action_readable',
          status: 'missing',
          message: assetActionDescribe.ok
            ? `AssetAction is not queryable in org '${orgAlias}'.`
            : `AssetAction describe failed for org '${orgAlias}': ${assetActionDescribe.message}`
        }
  );

  // Check InitiateAmendment API permission set presence in org.
  // Org-proven API name (v67.0 Developer Edition): RevLifecycleManagementInitiateAmendmentApi, label 'InitiateAmendment API'.
  const permSetQuery = `SELECT COUNT() FROM PermissionSet WHERE Name = 'RevLifecycleManagementInitiateAmendmentApi' OR Label IN ('InitiateAmendment API', 'InitiateAmend API')`;
  const permSetResult = await invokeWithRuntimeDependencies<{ totalSize?: number; records?: unknown[] }>({
    args: ['data', 'query', '--target-org', orgAlias, '--query', permSetQuery, '--json'],
    orgAlias,
    timeoutMs: 20_000
  });

  const permSetCount = permSetResult.ok
    ? (typeof permSetResult.data.totalSize === 'number' ? permSetResult.data.totalSize : 0)
    : 0;

  checks.push(
    permSetResult.ok && permSetCount > 0
      ? {
          scope: 'live',
          key: 'lifecycle_assetization.initiate_amend_permission_set',
          status: 'ok',
          message: `InitiateAmend API permission set is present in org '${orgAlias}'.`
        }
      : {
          scope: 'live',
          key: 'lifecycle_assetization.initiate_amend_permission_set',
          status: 'missing',
          message: permSetResult.ok
            ? `InitiateAmend API permission set was not found in org '${orgAlias}'. Assign it before running amend/renew/cancel commands.`
            : `Permission set check failed for org '${orgAlias}': ${permSetResult.message}`
        }
  );

  // Check ASSIGNMENT of the Assetize Order permission set to the running user.
  // Org-proven (v67.0): createOrUpdateAssetFromOrder fails with a record-permission error
  // unless RevLifecycleManagementCoreCPQAssetization (label 'Assetize Order') is assigned.
  if (!username) {
    checks.push({
      scope: 'live',
      key: 'lifecycle_assetization.assetize_order_permission_assigned',
      status: 'missing',
      message: `Could not resolve the authenticated username for '${orgAlias}', so the Assetize Order permission set assignment was not verified.`
    });
    return checks;
  }

  const assetizeAssignmentQuery = `SELECT COUNT() FROM PermissionSetAssignment WHERE PermissionSet.Name = 'RevLifecycleManagementCoreCPQAssetization' AND Assignee.Username = '${escapeSoqlStringLiteral(username)}'`;
  const assetizeAssignmentResult = await invokeWithRuntimeDependencies<{ totalSize?: number; records?: unknown[] }>({
    args: ['data', 'query', '--target-org', orgAlias, '--query', assetizeAssignmentQuery, '--json'],
    orgAlias,
    timeoutMs: 20_000
  });

  const assetizeAssignmentCount = assetizeAssignmentResult.ok
    ? (typeof assetizeAssignmentResult.data.totalSize === 'number' ? assetizeAssignmentResult.data.totalSize : 0)
    : 0;

  checks.push(
    assetizeAssignmentResult.ok && assetizeAssignmentCount > 0
      ? {
          scope: 'live',
          key: 'lifecycle_assetization.assetize_order_permission_assigned',
          status: 'ok',
          message: `Assetize Order permission set (RevLifecycleManagementCoreCPQAssetization) is assigned to ${username}.`
        }
      : {
          scope: 'live',
          key: 'lifecycle_assetization.assetize_order_permission_assigned',
          status: 'missing',
          message: assetizeAssignmentResult.ok
            ? `Assetize Order permission set (RevLifecycleManagementCoreCPQAssetization) is NOT assigned to ${username}. activate-order --execute will fail with a record-permission error until it is assigned.`
            : `Assetize Order permission set assignment check failed for org '${orgAlias}': ${assetizeAssignmentResult.message}`
        }
  );

  return checks;
}

export async function buildDoctorLiveChecks(
  globalFlags: GlobalFlags,
  dependencies: DoctorCommandDependencies = {},
  doctorFlags?: DoctorCommandFlags
): Promise<DoctorCheck[]> {
  const executeSfJson = dependencies.invokeSfJson ?? invokeSfJson;
  const invokeWithRuntimeDependencies = <T>(options: InvokeSfJsonOptions): Promise<SfCliJsonResult<T>> =>
    executeSfJson<T>({
      ...options,
      ...(dependencies.resolveCliPath === undefined ? {} : { resolveCliPath: dependencies.resolveCliPath })
    });

  const checks: DoctorCheck[] = [];
  const sfVersionResult = await invokeWithRuntimeDependencies<SfVersionPayload>({
    args: ['version', '--json'],
    timeoutMs: 15_000
  });

  if (sfVersionResult.ok === false) {
    checks.push({
      scope: 'live',
      key: 'sf_cli',
      status: 'missing',
      message: sfVersionResult.message
    });

    if (globalFlags.orgAlias) {
      checks.push({
        scope: 'live',
        key: 'org_auth',
        status: 'missing',
        message: `Skipped org alias/auth verification for '${globalFlags.orgAlias}' because Salesforce CLI is not ready.`
      });
      checks.push({
        scope: 'live',
        key: 'org_read_proof',
        status: 'missing',
        message: `Skipped the safe Organization read proof for '${globalFlags.orgAlias}' because Salesforce CLI is not ready.`
      });
    }

    return checks;
  }

  checks.push({
    scope: 'live',
    key: 'sf_cli',
    status: 'ok',
    message: buildSfCliReadyMessage(sfVersionResult.data)
  });

  if (!globalFlags.orgAlias) {
    checks.push({
      scope: 'live',
      key: 'org_auth',
      status: 'missing',
      message: 'Provide --org-alias <alias> to verify org alias/auth viability.'
    });
    checks.push({
      scope: 'live',
      key: 'org_read_proof',
      status: 'missing',
      message: 'Provide --org-alias <alias> to attempt the safe Organization read proof.'
    });
    return checks;
  }

  const orgDisplayResult = await invokeWithRuntimeDependencies<SfOrgDisplayPayload>({
    args: ['org', 'display', '--target-org', globalFlags.orgAlias, '--json'],
    orgAlias: globalFlags.orgAlias,
    timeoutMs: 20_000
  });

  if (orgDisplayResult.ok === false) {
    checks.push({
      scope: 'live',
      key: 'org_auth',
      status: 'missing',
      message: orgDisplayResult.message
    });
    checks.push({
      scope: 'live',
      key: 'org_read_proof',
      status: 'missing',
      message: `Skipped the safe Organization read proof for '${globalFlags.orgAlias}' because org alias/auth readiness did not pass.`
    });
    return checks;
  }

  checks.push({
    scope: 'live',
    key: 'org_auth',
    status: 'ok',
    message: buildOrgAuthReadyMessage(globalFlags.orgAlias, orgDisplayResult.data)
  });

  const orgReadProofResult = await invokeWithRuntimeDependencies<SfQueryPayload>({
    args: ['data', 'query', '--target-org', globalFlags.orgAlias, '--query', SAFE_ORG_READINESS_PROOF_QUERY, '--json'],
    orgAlias: globalFlags.orgAlias,
    timeoutMs: 20_000
  });

  if (orgReadProofResult.ok === false) {
    checks.push({
      scope: 'live',
      key: 'org_read_proof',
      status: 'missing',
      message: orgReadProofResult.message
    });
    return checks;
  }

  const recordCount = Array.isArray(orgReadProofResult.data.records)
    ? orgReadProofResult.data.records.length
    : typeof orgReadProofResult.data.totalSize === 'number'
      ? orgReadProofResult.data.totalSize
      : 0;

  checks.push(
    recordCount > 0
      ? {
          scope: 'live',
          key: 'org_read_proof',
          status: 'ok',
          message: `Safe Organization read proof succeeded for '${globalFlags.orgAlias}'.`
        }
      : {
          scope: 'live',
          key: 'org_read_proof',
          status: 'missing',
          message: `Safe Organization read proof returned no rows for '${globalFlags.orgAlias}'.`
        }
  );

  // Add lifecycle-assetization checks when the target command is a lifecycle command
  if (doctorFlags?.forCommand && LIFECYCLE_ASSETIZATION_COMMANDS.has(doctorFlags.forCommand)) {
    const lifecycleChecks = await buildLifecycleAssetizationChecks(
      globalFlags.orgAlias,
      invokeWithRuntimeDependencies,
      typeof orgDisplayResult.data.username === 'string' && orgDisplayResult.data.username.trim().length > 0
        ? orgDisplayResult.data.username
        : null
    );
    checks.push(...lifecycleChecks);
  }

  return checks;
}

function buildDoctorCommandChecks(globalFlags: GlobalFlags, selectors: RuntimeSelectorBundle): DoctorCheck[] {
  const checks: DoctorCheck[] = [
    globalFlags.orgAlias
      ? {
          scope: 'global',
          key: 'org_alias',
          status: 'ok',
          message: `Org alias '${globalFlags.orgAlias}' is present.`
        }
      : {
          scope: 'global',
          key: 'org_alias',
          status: 'missing',
          message: 'Provide --org-alias <alias> to target the runtime org.'
        },
    selectors.for_command
      ? {
          scope: 'command',
          key: 'for_command',
          status: 'ok',
          message: `Doctor is checking readiness for ${selectors.for_command}.`
        }
      : {
          scope: 'command',
          key: 'for_command',
          status: 'missing',
          message: 'Provide --for-command <subcommand> for command-specific preflight.'
        }
  ];

  if (!selectors.for_command) {
    return checks;
  }

  for (const selectorKey of getCommandSelectorPolicy(selectors.for_command).required_selectors) {
    checks.push(buildSelectorRequirementCheck(selectorKey, selectors));
  }

  const requiredSelectorKeys = new Set(getCommandSelectorPolicy(selectors.for_command).required_selectors);

  for (const issue of getCommandReadinessIssuesForCommand(selectors.for_command, selectors)) {
    if (requiredSelectorKeys.has(issue.key as SelectorKey)) {
      continue;
    }

    checks.push({
      scope: 'command',
      key: issue.key,
      status: 'missing',
      message: issue.message
    });
  }

  return checks;
}

function buildSelectorRequirementCheck(selectorKey: SelectorKey, selectors: RuntimeSelectorBundle): DoctorCheck {
  const missing = getMissingRequiredSelectorsForCommand(selectors.for_command ?? 'doctor', selectors).includes(selectorKey);

  return missing
    ? {
        scope: 'command',
        key: selectorKey,
        status: 'missing',
        message: selectorRequirementMessage(selectorKey)
      }
    : {
        scope: 'command',
        key: selectorKey,
        status: 'ok',
        message: selectorSatisfiedMessage(selectorKey, selectors)
      };
}

function selectorRequirementMessage(selectorKey: SelectorKey): string {
  switch (selectorKey) {
    case 'quote_id':
      return 'Provide --quote-id <id>.';
    case 'before_quote_id':
      return 'Provide --before-quote-id <id>.';
    case 'after_quote_id':
      return 'Provide --after-quote-id <id>.';
    case 'line_ids':
      return 'Provide at least one --line-id <id>.';
    case 'asset_ids':
      return 'Provide at least one --asset-id <id>.';
    case 'symptom':
      return 'Provide --symptom <text>.';
    case 'expected_change':
      return 'Provide --expected-change <text>.';
    case 'changed_artifact':
      return 'Provide --changed-artifact <text>.';
    case 'operation_family':
      return 'Provide --operation-family <family>.';
  }
}

function selectorSatisfiedMessage(selectorKey: SelectorKey, selectors: RuntimeSelectorBundle): string {
  switch (selectorKey) {
    case 'quote_id':
      return `quote_id is ready: ${selectors.quote_id}`;
    case 'before_quote_id':
      return `before_quote_id is ready: ${selectors.before_quote_id}`;
    case 'after_quote_id':
      return `after_quote_id is ready: ${selectors.after_quote_id}`;
    case 'line_ids':
      return `line_ids are ready: ${selectors.line_ids.join(', ')}`;
    case 'asset_ids':
      return `asset_ids are ready: ${selectors.asset_ids.join(', ')}`;
    case 'symptom':
      return `symptom is ready: ${selectors.symptom}`;
    case 'expected_change':
      return `expected_change is ready: ${selectors.expected_change}`;
    case 'changed_artifact':
      return `changed_artifact is ready: ${selectors.changed_artifact}`;
    case 'operation_family':
      return `operation_family is ready: ${selectors.operation_family}`;
  }
}

function buildDoctorWarnings(
  selectors: RuntimeSelectorBundle,
  selectorChecks: readonly DoctorCheck[],
  liveChecks: readonly DoctorCheck[]
): string[] {
  const warnings: string[] = [];

  const missingSelectorRequirements = selectorChecks.filter((check) => check.status === 'missing').map((check) => check.key);
  const missingLiveRequirements = liveChecks.filter((check) => check.status === 'missing').map((check) => check.key);

  if (selectors.for_command && missingSelectorRequirements.length > 0) {
    warnings.push(`${selectors.for_command} is not selector-ready yet: ${missingSelectorRequirements.join(', ')}.`);
  }

  if (missingLiveRequirements.length > 0) {
    warnings.push(`Live-readiness gaps remain: ${missingLiveRequirements.join(', ')}.`);
  }

  return warnings;
}

function buildSfCliReadyMessage(payload: SfVersionPayload): string {
  const fragments = [payload.cliVersion, payload.nodeVersion].filter((value): value is string => typeof value === 'string' && value.trim().length > 0);
  return fragments.length > 0
    ? `Salesforce CLI is available (${fragments.join(', ')}).`
    : 'Salesforce CLI is available.';
}

function buildOrgAuthReadyMessage(orgAlias: string, payload: SfOrgDisplayPayload): string {
  const usernameSuffix = typeof payload.username === 'string' && payload.username.trim().length > 0
    ? ` as ${payload.username}`
    : '';
  const idSuffix = typeof payload.id === 'string' && payload.id.trim().length > 0
    ? ` (${payload.id})`
    : '';
  return `Org alias '${orgAlias}' resolved and authenticated${usernameSuffix}${idSuffix}.`;
}

// ---------------------------------------------------------------------------
// CommandSpec (Q3: defineCommand consolidation)
// ---------------------------------------------------------------------------
import { defineCommand, WAVE_GROUP_NAMES } from './spec';

export const DOCTOR_COMMAND_SPEC = defineCommand({
  name: 'doctor',
  wave: 1,
  group_name: WAVE_GROUP_NAMES[1],
  summary: 'Check command fit and selector prerequisites before deeper runtime work.',
  ownership: {
        primary_owner: 'quote-runtime-mutations',
        secondary_escalation: ['pricing-runtime-debug', 'runtime-context-inspection', 'config-runtime-bridge'],
        shared_library_dependencies: ['selectors', 'doctor', 'evidence']
  },
  selectorPolicy: {
        required_selectors: [],
        recommended_selectors: [],
        status_reason: 'Doctor can run with only org alias and optional command-specific selectors.'
  },
    quickStart: [
    'quote-runtime doctor --org-alias <alias> --for-command doctor',
    'quote-runtime doctor --org-alias <alias> --for-command snapshot-quote --quote-id <id>'
    ] as const,
  renderHelp: renderDoctorHelp,
  run: runDoctorCommand
});
