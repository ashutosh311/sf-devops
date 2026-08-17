import { selectHigherSeverityStatus, type DoctorCheck, type Status } from '@sdlc/rca-cli-core';

import type { DoctorIssue, DoctorSfCliAssessment, DoctorSfCliAssessmentInput, DoctorSfCliDetails } from './types';

function createIssue(issue_id: string, severity: DoctorIssue['severity'], code: string, message: string): DoctorIssue {
  return { issue_id, severity, code, message };
}

function appendFixPath(target: string[], step: string): void {
  if (!target.includes(step)) {
    target.push(step);
  }
}

function summarize(status: Status, blocking: boolean): string {
  if (status === 'ok') {
    return 'Salesforce CLI is ready for discovery workflows.';
  }

  if (blocking || status === 'error') {
    return 'Salesforce CLI readiness is blocked until environment prerequisites are fixed.';
  }

  if (status === 'partial' || status === 'warn') {
    return 'Salesforce CLI is present but requires follow-up before discovery workflows are reliable.';
  }

  return 'Salesforce CLI readiness could not be fully confirmed.';
}

export function buildDoctorSfCliAssessment(input: DoctorSfCliAssessmentInput): DoctorSfCliAssessment {
  const checks: DoctorCheck[] = [];
  const warnings: Array<{ code: string; message: string }> = [];
  const errors: Array<{ code: string; message: string }> = [];
  const issues: DoctorIssue[] = [];
  const warningsSummary: string[] = [];
  const recommendedFixPath: string[] = [];
  const recommendedNextCommands = ['sfx commands --json', 'sfx discover project-inventory --repo . --json'];
  const executedNodeCommand = input.node.path ?? 'node';
  const executedSfCommand = input.sf.path ?? 'sf';
  const executedNodeVersionCommand = `${executedNodeCommand} --version`;
  const executedSfVersionCommand = `${executedSfCommand} --version`;
  const executedSfOrgListCommand = `${executedSfCommand} org list --json`;
  let overallStatus: Status = 'ok';
  let blocking = false;

  if (input.node.resolution_status === 'resolved') {
    checks.push({
      name: 'Node resolution',
      status: 'ok',
      code: 'NODE_RESOLVED',
      summary: 'Node was resolved from the current environment.',
      blocking: false,
      detail: input.node.path ? `Resolved from ${input.node.path}.` : undefined,
      guidance: 'No action required.',
    });
  } else {
    checks.push({
      name: 'Node resolution',
      status: 'warn',
      code: 'NODE_NOT_FOUND',
      summary: 'Node was not resolved from the current environment.',
      blocking: false,
      guidance: 'Install or activate a supported Node runtime before retrying Salesforce CLI checks.',
    });
    overallStatus = selectHigherSeverityStatus(overallStatus, 'warn');
    warnings.push({ code: 'NODE_NOT_FOUND', message: 'Node was not resolved from the current environment.' });
    warningsSummary.push('Node was not resolved from the current environment.');
    issues.push(createIssue('missing-node-runtime', 'important', 'NODE_NOT_FOUND', 'Node should be available in the active shell for consistent CLI execution.'));
    appendFixPath(recommendedFixPath, 'Install or activate Node so the runtime is resolvable in the current shell.');
  }

  if (input.node.engine_status === 'supported') {
    checks.push({
      name: 'Node engine contract',
      status: 'ok',
      code: 'NODE_ENGINE_SUPPORTED',
      summary: `Resolved Node version satisfies the package engine contract (${input.node.engine_range}).`,
      blocking: false,
      detail: input.node.version ? `Resolved ${input.node.version}.` : undefined,
      guidance: 'No action required.',
    });
  } else if (input.node.engine_status === 'unsupported') {
    checks.push({
      name: 'Node engine contract',
      status: 'error',
      code: 'NODE_ENGINE_UNSUPPORTED',
      summary: `Resolved Node version does not satisfy the package engine contract (${input.node.engine_range}).`,
      blocking: true,
      detail: input.node.version ? `Resolved ${input.node.version}.` : undefined,
      guidance: `Activate a Node runtime that satisfies ${input.node.engine_range} before retrying doctor.`,
    });
    overallStatus = selectHigherSeverityStatus(overallStatus, 'error');
    blocking = true;
    errors.push({ code: 'NODE_ENGINE_UNSUPPORTED', message: `Resolved Node version does not satisfy the package engine contract (${input.node.engine_range}).` });
    warningsSummary.push(`Resolved Node version ${input.node.version ?? 'unknown'} does not satisfy the package engine contract (${input.node.engine_range}).`);
    issues.push(createIssue('unsupported-node-runtime', 'critical', 'NODE_ENGINE_UNSUPPORTED', `Resolved Node version must satisfy ${input.node.engine_range} for supported CLI execution.`));
    appendFixPath(recommendedFixPath, `Activate Node ${input.node.engine_range} and re-run doctor.`);
  } else if (input.node.resolution_status === 'resolved') {
    checks.push({
      name: 'Node engine contract',
      status: 'warn',
      code: 'NODE_ENGINE_UNVERIFIED',
      summary: `Resolved Node version could not be validated against the package engine contract (${input.node.engine_range}).`,
      blocking: false,
      detail: input.node.version ? `Resolved ${input.node.version}.` : 'Node version output was unavailable.',
      guidance: `Verify \`${executedNodeVersionCommand}\` output and ensure the runtime satisfies the package engine contract.`,
    });
    overallStatus = selectHigherSeverityStatus(overallStatus, 'warn');
    warnings.push({ code: 'NODE_ENGINE_UNVERIFIED', message: `Resolved Node version could not be validated against the package engine contract (${input.node.engine_range}).` });
    warningsSummary.push(`Resolved Node version could not be validated against the package engine contract (${input.node.engine_range}).`);
    issues.push(createIssue('unverified-node-runtime', 'important', 'NODE_ENGINE_UNVERIFIED', 'Resolved Node version output should be reviewed because the engine contract could not be verified.'));
    appendFixPath(recommendedFixPath, `Verify \`${executedNodeVersionCommand}\` output and ensure the active runtime satisfies the declared package engine range.`);
  }

  if (input.npm.resolution_status === 'resolved') {
    checks.push({
      name: 'npm resolution',
      status: 'ok',
      code: 'NPM_RESOLVED',
      summary: 'npm was resolved from the current environment.',
      blocking: false,
      detail: input.npm.path ? `Resolved from ${input.npm.path}.` : undefined,
      guidance: 'No action required.',
    });
  } else {
    checks.push({
      name: 'npm resolution',
      status: 'warn',
      code: 'NPM_NOT_FOUND',
      summary: 'npm was not resolved from the current environment.',
      blocking: false,
      guidance: 'Install or activate npm before running plugin setup.',
    });
    overallStatus = selectHigherSeverityStatus(overallStatus, 'warn');
    warnings.push({ code: 'NPM_NOT_FOUND', message: 'npm was not resolved from the current environment.' });
    warningsSummary.push('npm was not resolved from the current environment.');
    issues.push(createIssue('missing-npm-runtime', 'important', 'NPM_NOT_FOUND', 'npm should be available so plugin setup can install and build command wrappers.'));
    appendFixPath(recommendedFixPath, 'Install or activate npm before running `arm-setup-cli`.');
  }

  if (input.python.resolution_status === 'resolved') {
    checks.push({
      name: 'Python resolution',
      status: 'ok',
      code: 'PYTHON_RESOLVED',
      summary: 'python3 was resolved from the current environment.',
      blocking: false,
      detail: input.python.path ? `Resolved from ${input.python.path}.` : undefined,
      guidance: 'No action required.',
    });
  } else {
    checks.push({
      name: 'Python resolution',
      status: 'warn',
      code: 'PYTHON_NOT_FOUND',
      summary: 'python3 was not resolved from the current environment.',
      blocking: false,
      guidance: 'Install or activate Python 3 for helper workflows that need it.',
    });
    overallStatus = selectHigherSeverityStatus(overallStatus, 'warn');
    warnings.push({ code: 'PYTHON_NOT_FOUND', message: 'python3 was not resolved from the current environment.' });
    warningsSummary.push('python3 was not resolved from the current environment.');
    issues.push(createIssue('missing-python-runtime', 'important', 'PYTHON_NOT_FOUND', 'Python 3 is recommended for helper workflows and future plugin scripts.'));
    appendFixPath(recommendedFixPath, 'Install or activate Python 3 if helper scripts are needed.');
  }

  if (input.sf.resolution_status === 'resolved') {
    checks.push({
      name: 'Salesforce CLI resolution',
      status: 'ok',
      code: 'SF_CLI_RESOLVED',
      summary: 'Salesforce CLI binary is available.',
      blocking: false,
      detail: input.sf.path ? `Resolved from ${input.sf.path}.` : undefined,
      guidance: 'You can proceed to discovery commands once auth is confirmed.',
    });
    if (!recommendedNextCommands.includes(executedSfVersionCommand)) {
      recommendedNextCommands.push(executedSfVersionCommand);
    }
  } else {
    checks.push({
      name: 'Salesforce CLI resolution',
      status: 'error',
      code: 'SF_CLI_NOT_FOUND',
      summary: 'Salesforce CLI binary is not available.',
      blocking: true,
      guidance: 'Install Salesforce CLI and ensure `sf` is on PATH.',
    });
    overallStatus = selectHigherSeverityStatus(overallStatus, 'error');
    blocking = true;
    errors.push({ code: 'SF_CLI_NOT_FOUND', message: 'Salesforce CLI binary is not available.' });
    warningsSummary.push('Doctor could not verify authenticated org access because Salesforce CLI was unavailable.');
    issues.push(createIssue('missing-sf-cli', 'critical', 'SF_CLI_NOT_FOUND', 'Salesforce CLI is required for org-aware discovery commands.'));
    appendFixPath(recommendedFixPath, 'Install Salesforce CLI and verify `sf --version` succeeds before re-running doctor.');
    if (!recommendedNextCommands.includes('sf --version')) {
      recommendedNextCommands.push('sf --version');
    }
  }

  const missingWrappers = input.commandWrappers.filter((wrapper) => wrapper.status === 'missing');
  const staleWrappers = input.commandWrappers.filter((wrapper) => wrapper.status === 'stale');
  if (missingWrappers.length === 0 && staleWrappers.length === 0) {
    checks.push({
      name: 'ARM command wrappers',
      status: 'ok',
      code: 'ARM_WRAPPERS_READY',
      summary: 'ARM command wrappers were resolved from PATH.',
      blocking: false,
      guidance: 'No action required.',
    });
  } else {
    const code = staleWrappers.length > 0 ? 'ARM_WRAPPERS_STALE' : 'ARM_WRAPPERS_MISSING';
    const summary = staleWrappers.length > 0
      ? 'One or more ARM command wrappers point at a missing runtime root.'
      : 'One or more ARM command wrappers were not resolved from PATH.';
    checks.push({
      name: 'ARM command wrappers',
      status: 'warn',
      code,
      summary,
      blocking: false,
      detail: [...staleWrappers, ...missingWrappers].map((wrapper) => wrapper.detail).join('\n'),
      guidance: 'Run `arm-setup-cli` to refresh user-level command wrappers.',
    });
    overallStatus = selectHigherSeverityStatus(overallStatus, 'warn');
    warnings.push({ code, message: summary });
    warningsSummary.push(summary);
    issues.push(createIssue('arm-command-wrapper-refresh-needed', 'important', code, summary));
    appendFixPath(recommendedFixPath, 'Run `arm-setup-cli` to install or refresh user-level command wrappers.');
    if (!recommendedNextCommands.includes('arm-setup-cli')) {
      recommendedNextCommands.push('arm-setup-cli');
    }
  }

  if (input.projectContext) {
    if (input.projectContext.project_config_status === 'detected') {
      checks.push({
        name: 'Project root context',
        status: 'ok',
        code: 'PROJECT_CONTEXT_DETECTED',
        summary: 'Project root context was detected.',
        blocking: false,
        detail: `Project root: ${input.projectContext.project_root}\nArtifact root: ${input.projectContext.artifact_root}\nDetected: ${input.projectContext.detected_project_files.join(', ')}`,
        guidance: 'No action required.',
      });
    } else {
      checks.push({
        name: 'Project root context',
        status: 'warn',
        code: 'PROJECT_CONTEXT_MISSING',
        summary: 'No Salesforce or Node project marker was detected in the active project root.',
        blocking: false,
        detail: `Project root: ${input.projectContext.project_root}\nArtifact root: ${input.projectContext.artifact_root}`,
        guidance: 'Run from the intended project root or pass `--project-root` / `ARM_PROJECT_ROOT`.',
      });
      overallStatus = selectHigherSeverityStatus(overallStatus, 'warn');
      warnings.push({ code: 'PROJECT_CONTEXT_MISSING', message: 'No Salesforce or Node project marker was detected in the active project root.' });
      warningsSummary.push('No Salesforce or Node project marker was detected in the active project root.');
      issues.push(createIssue('missing-project-context', 'important', 'PROJECT_CONTEXT_MISSING', 'Run from the intended project root or pass an explicit project root before discovery.'));
      appendFixPath(recommendedFixPath, 'Run from the intended project root, or pass `--project-root <path>` and optionally `--artifact-root <path>`.');
    }
  }

  if (input.sfVersion.status === 'available') {
    checks.push({
      name: 'Salesforce CLI version',
      status: 'ok',
      code: 'SF_VERSION_AVAILABLE',
      summary: 'Salesforce CLI version was captured successfully.',
      blocking: false,
      detail: input.sfVersion.parsed_version ? `Parsed version ${input.sfVersion.parsed_version}.` : undefined,
    });
  } else if (input.sfVersion.status === 'parse_failed') {
    checks.push({
      name: 'Salesforce CLI version',
      status: 'warn',
      code: 'SF_VERSION_PARSE_FAILED',
      summary: 'Salesforce CLI version output was captured but could not be parsed.',
      blocking: false,
      detail: 'The raw version string was preserved for inspection.',
      guidance: `Verify \`${executedSfVersionCommand}\` output and update the parser if the upstream shape changed.`,
    });
    overallStatus = selectHigherSeverityStatus(overallStatus, 'warn');
    warnings.push({ code: 'SF_VERSION_PARSE_FAILED', message: 'Salesforce CLI version output was captured but could not be parsed.' });
    warningsSummary.push('Salesforce CLI version output could not be parsed.');
    issues.push(createIssue('sf-version-parse-failed', 'minor', 'SF_VERSION_PARSE_FAILED', 'Salesforce CLI version output changed shape and should be reviewed.'));
  } else if (input.sfVersion.status === 'command_failed') {
    checks.push({
      name: 'Salesforce CLI version',
      status: 'warn',
      code: 'SF_VERSION_COMMAND_FAILED',
      summary: `Salesforce CLI was resolved, but \`${executedSfVersionCommand}\` failed.`,
      blocking: false,
      detail: input.sfVersion.raw ?? 'The version command did not produce inspectable output.',
      guidance: `Run \`${executedSfVersionCommand}\` directly and repair the CLI installation if the command continues to fail.`,
    });
    overallStatus = selectHigherSeverityStatus(overallStatus, 'warn');
    warnings.push({ code: 'SF_VERSION_COMMAND_FAILED', message: `Salesforce CLI was resolved, but \`${executedSfVersionCommand}\` failed.` });
    warningsSummary.push(`Salesforce CLI was resolved, but \`${executedSfVersionCommand}\` failed.`);
    issues.push(createIssue('sf-version-command-failed', 'important', 'SF_VERSION_COMMAND_FAILED', 'Salesforce CLI version inspection failed even though the binary resolved from PATH.'));
    appendFixPath(recommendedFixPath, `Run \`${executedSfVersionCommand}\` directly and repair the Salesforce CLI installation if it still fails.`);
    if (!recommendedNextCommands.includes(executedSfVersionCommand)) {
      recommendedNextCommands.push(executedSfVersionCommand);
    }
  } else {
    checks.push({
      name: 'Salesforce CLI version',
      status: 'partial',
      code: 'SF_VERSION_UNAVAILABLE',
      summary: 'Salesforce CLI version could not be inspected because the binary was unavailable.',
      blocking: false,
      detail: 'Version inspection was skipped after CLI resolution failed.',
    });
    overallStatus = selectHigherSeverityStatus(overallStatus, 'partial');
  }

  const orgAccessStatus = input.sf.resolution_status !== 'resolved'
    ? 'unavailable'
    : input.orgListProbeStatus === 'probe_failed'
      ? 'probe_failed'
      : input.authenticatedAliasesCount > 0
        ? 'available'
        : 'partial';

  if (orgAccessStatus === 'available') {
    checks.push({
      name: 'Authenticated org context',
      status: 'ok',
      code: 'SF_ORG_AUTH_AVAILABLE',
      summary: 'Authenticated org aliases were detected for org-aware discovery.',
      blocking: false,
      detail: `${input.authenticatedAliasesCount} authenticated alias(es) detected.`,
    });
    if (!recommendedNextCommands.includes(executedSfOrgListCommand)) {
      recommendedNextCommands.push(executedSfOrgListCommand);
    }
    if (!recommendedNextCommands.includes('sfx discover org-baseline --org <org_alias> --json')) {
      recommendedNextCommands.push('sfx discover org-baseline --org <org_alias> --json');
    }
  } else if (orgAccessStatus === 'partial') {
    checks.push({
      name: 'Authenticated org context',
      status: 'warn',
      code: 'SF_CLI_AUTH_CONTEXT_MISSING',
      summary: 'No authenticated org context was detected for baseline commands.',
      blocking: false,
      guidance: 'Authenticate an org before running org-scoped discovery commands.',
    });
    overallStatus = selectHigherSeverityStatus(overallStatus, 'warn');
    warnings.push({ code: 'SF_CLI_AUTH_CONTEXT_MISSING', message: 'No authenticated org context was detected for baseline commands.' });
    warningsSummary.push('No authenticated org context was detected for baseline commands.');
    issues.push(createIssue('missing-default-org-context', 'important', 'SF_CLI_AUTH_CONTEXT_MISSING', 'No authenticated org context was detected for baseline commands.'));
    appendFixPath(recommendedFixPath, 'Authenticate an org alias before running org-aware discovery commands.');
    if (!recommendedNextCommands.includes(`${executedSfCommand} org login web --alias <alias>`)) {
      recommendedNextCommands.push(`${executedSfCommand} org login web --alias <alias>`);
    }
    if (!recommendedNextCommands.includes(executedSfOrgListCommand)) {
      recommendedNextCommands.push(executedSfOrgListCommand);
    }
  } else if (orgAccessStatus === 'probe_failed') {
    checks.push({
      name: 'Authenticated org context',
      status: 'warn',
      code: 'SF_ORG_LIST_PROBE_FAILED',
      summary: `Authenticated org access could not be verified because \`${executedSfOrgListCommand}\` failed.`,
      blocking: false,
      detail: input.orgListProbeError ?? 'The org listing probe failed without inspectable output.',
      guidance: `Run \`${executedSfOrgListCommand}\` directly and repair the Salesforce CLI auth context if the probe continues to fail.`,
    });
    overallStatus = selectHigherSeverityStatus(overallStatus, 'warn');
    warnings.push({ code: 'SF_ORG_LIST_PROBE_FAILED', message: `Authenticated org access could not be verified because \`${executedSfOrgListCommand}\` failed.` });
    warningsSummary.push(`Authenticated org access could not be verified because \`${executedSfOrgListCommand}\` failed.`);
    issues.push(createIssue('sf-org-list-probe-failed', 'important', 'SF_ORG_LIST_PROBE_FAILED', 'Doctor could not distinguish authenticated org availability because the Salesforce CLI org listing probe failed.'));
    appendFixPath(recommendedFixPath, `Run \`${executedSfOrgListCommand}\` directly and repair the Salesforce CLI auth context if the probe still fails.`);
    if (!recommendedNextCommands.includes(executedSfOrgListCommand)) {
      recommendedNextCommands.push(executedSfOrgListCommand);
    }
  } else {
    checks.push({
      name: 'Authenticated org context',
      status: 'partial',
      code: 'SF_ORG_LIST_SKIPPED',
      summary: 'Authenticated org access could not be verified because Salesforce CLI was unavailable.',
      blocking: false,
      detail: 'Org listing was skipped after CLI resolution failed.',
    });
    overallStatus = selectHigherSeverityStatus(overallStatus, 'partial');
  }

  const details = {
    node_resolution: {
      command: executedNodeVersionCommand,
      path: input.node.path,
      version: input.node.version,
      resolution_status: input.node.resolution_status,
      engine_range: input.node.engine_range,
      engine_status: input.node.engine_status,
    },
    npm_resolution: {
      command: 'npm',
      path: input.npm.path,
      resolution_status: input.npm.resolution_status,
      source_hint: input.npm.source_hint,
    },
    python_resolution: {
      command: 'python3',
      path: input.python.path,
      resolution_status: input.python.resolution_status,
      source_hint: input.python.source_hint,
    },
    sf_resolution: {
      command: executedSfCommand,
      path: input.sf.path,
      resolution_status: input.sf.resolution_status,
      source_hint: input.sf.source_hint,
    },
    sf_version: {
      command: input.sf.resolution_status === 'resolved' ? executedSfVersionCommand : null,
      raw: input.sfVersion.raw,
      parsed_version: input.sfVersion.parsed_version,
      status: input.sfVersion.status,
    },
    command_wrappers: input.commandWrappers,
    project_context: input.projectContext,
    issues,
    org_access_summary: {
      status: orgAccessStatus,
      org_list_command: input.sf.resolution_status === 'resolved' ? executedSfOrgListCommand : null,
      org_list_probe_status: input.orgListProbeStatus,
      org_list_checked: input.orgListChecked,
      authenticated_aliases_count: input.authenticatedAliasesCount,
      probe_error: input.orgListProbeError,
    },
    warnings_summary: warningsSummary,
  } as Record<string, unknown> & DoctorSfCliDetails;

  return {
    status: overallStatus,
    summary: summarize(overallStatus, blocking),
    warnings,
    errors,
    evidence: [
      {
        label: 'Node resolution',
        detail: input.node.path ? `Resolved node at ${input.node.path}; version probe uses \`${executedNodeVersionCommand}\`.` : 'Node was not resolved from PATH.',
        source: input.node.path ?? 'PATH',
      },
      {
        label: 'Salesforce CLI resolution',
        detail: input.sf.path ? `Resolved Salesforce CLI at ${input.sf.path}; follow-up probes use \`${executedSfVersionCommand}\` and \`${executedSfOrgListCommand}\`.` : 'Salesforce CLI was not resolved from PATH.',
        source: input.sf.path ?? 'PATH',
      },
      {
        label: 'Salesforce CLI version',
        detail: details.sf_version.command === null ? 'Version output unavailable.' : `Command: ${details.sf_version.command}\n${input.sfVersion.raw ?? 'Version output unavailable.'}`,
        source: input.sf.path ?? undefined,
      },
      {
        label: 'ARM command wrappers',
        detail: input.commandWrappers.map((wrapper) => `${wrapper.command}: ${wrapper.status}${wrapper.path ? ` (${wrapper.path})` : ''}`).join('\n'),
        source: 'PATH',
      },
    ],
    result: {
      mode: 'local-file',
      checks,
      recommended_fix_path: recommendedFixPath,
      details,
    },
    recommendedNextCommands,
    evidenceArtifacts: [
      {
        evidenceId: 'ev_node_resolution_001',
        payload: {
          ...details.node_resolution,
          command: executedNodeCommand,
        },
      },
      {
        evidenceId: 'ev_sf_resolution_001',
        payload: {
          ...details.sf_resolution,
          command: executedSfCommand,
        },
      },
      {
        evidenceId: 'ev_sf_cli_version_001',
        payload: details.sf_version,
      },
      {
        evidenceId: 'ev_sf_org_access_001',
        payload: details.org_access_summary,
      },
      {
        evidenceId: 'ev_arm_command_wrappers_001',
        payload: details.command_wrappers,
      },
      {
        evidenceId: 'ev_project_context_001',
        payload: details.project_context,
      },
    ],
    logLines: [
      `doctor.sf-cli status=${overallStatus}`,
      `node resolution=${input.node.resolution_status} path=${input.node.path ?? 'null'} version=${input.node.version ?? 'null'} engine_status=${input.node.engine_status} engine_range=${input.node.engine_range}`,
      `npm resolution=${input.npm.resolution_status} path=${input.npm.path ?? 'null'}`,
      `python3 resolution=${input.python.resolution_status} path=${input.python.path ?? 'null'}`,
      `sf resolution=${input.sf.resolution_status} path=${input.sf.path ?? 'null'}`,
      `arm wrappers=${input.commandWrappers.map((wrapper) => `${wrapper.command}:${wrapper.status}`).join(',')}`,
      `project root=${input.projectContext?.project_root ?? 'null'} artifact_root=${input.projectContext?.artifact_root ?? 'null'} project_config_status=${input.projectContext?.project_config_status ?? 'null'}`,
      `sf version status=${input.sfVersion.status} parsed=${input.sfVersion.parsed_version ?? 'null'}`,
      `org access status=${orgAccessStatus} probe_status=${input.orgListProbeStatus} checked=${String(input.orgListChecked)} aliases=${String(input.authenticatedAliasesCount)}`,
    ],
  };
}
