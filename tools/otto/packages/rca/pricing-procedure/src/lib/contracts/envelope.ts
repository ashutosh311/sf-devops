import {
  STATUS_PRECEDENCE,
  TOOL_VERSION,
  type CommandName,
  type FailChoice,
  type Status,
} from './constants';
import type { CommandSummary, Envelope, EvidenceEntry, Notice } from './types';

export interface MakeEnvelopeOptions {
  warnings?: Notice[];
  errors?: Notice[];
  status?: Status;
  source_files?: string[];
  selector_input?: Record<string, unknown>;
  partial_reason?: string;
  started_at?: number;
  generated_at?: string;
}

interface CliCoreContracts {
  schemaVersion: string;
  shouldFail: (status: Status, failOn: Exclude<FailChoice, 'none' | 'changed'>) => boolean;
  createEnvelope: <T>(input: Envelope<T>) => Envelope<T>;
  source: string;
}

// Vendored into Otto: the pricing runtime is self-contained and uses its
// own result-envelope logic (keyed on this package's STATUS_PRECEDENCE). Upstream
// probed for the shared `cli-core` package via createRequire(__filename); that CJS
// construct is unavailable in our ESM/bundled runtime, so we use the local logic
// directly. The shared contract lives at @otto/rca-cli-core; unifying pricing onto
// it is deferred to the envelope-consolidation step (do not unify ad hoc).
function cliCoreContracts(): CliCoreContracts {
  const localShouldFail = (status: Status, failOn: Exclude<FailChoice, 'none' | 'changed'>): boolean =>
    STATUS_PRECEDENCE[status] >= STATUS_PRECEDENCE[failOn];
  const localCreateEnvelope = <T>(input: Envelope<T>): Envelope<T> => input;

  return {
    schemaVersion: '1.0.0',
    shouldFail: localShouldFail,
    createEnvelope: localCreateEnvelope,
    source: 'local',
  };
}

export function nowIso(): string {
  return new Date().toISOString().replace(/\.\d{3}Z$/, 'Z');
}

export function makeNotice(
  code: string,
  message: string,
  details: Record<string, unknown> = {},
  suggestion = '',
): Notice {
  return { code, message, details, suggestion };
}

export function makeSummary(
  primary_subject: string,
  status_reason: string,
  key_counts: Record<string, unknown> = {},
  next_suggested_command = '',
): CommandSummary {
  return {
    primary_subject,
    status_reason,
    key_counts,
    next_suggested_command,
  };
}

export function deriveStatus(
  base_status: Status = 'ok',
  warnings: Notice[] = [],
  errors: Notice[] = [],
): Status {
  if (errors.length > 0) {
    return 'error';
  }

  const candidateStatuses: Status[] = [base_status];
  if (warnings.length > 0 && (base_status === 'ok' || base_status === 'no_change')) {
    candidateStatuses.push('warn');
  }

  return candidateStatuses.reduce((highest, current) =>
    STATUS_PRECEDENCE[current] > STATUS_PRECEDENCE[highest] ? current : highest,
  );
}

function buildEvidence(
  summary: CommandSummary,
  meta: Envelope<unknown>['meta'],
  warnings: Notice[],
  errors: Notice[],
  cliCoreSource: string,
): EvidenceEntry[] {
  const evidence: EvidenceEntry[] = [];

  for (const sourceFile of meta.source_files) {
    evidence.push({
      label: 'source_file',
      detail: sourceFile,
      source: sourceFile,
    });
  }

  if (meta.selector_input) {
    evidence.push({
      label: 'selector_input',
      detail: JSON.stringify(meta.selector_input),
    });
  }

  if (summary.next_suggested_command) {
    evidence.push({
      label: 'next_suggested_command',
      detail: summary.next_suggested_command,
    });
  }

  if (meta.partial_reason) {
    evidence.push({
      label: 'partial_reason',
      detail: meta.partial_reason,
    });
  }

  evidence.push({
    label: 'cli_core_contract',
    detail: cliCoreSource,
  });

  for (const warning of warnings) {
    evidence.push({
      label: `warning:${warning.code}`,
      detail: warning.message,
    });
  }

  for (const error of errors) {
    evidence.push({
      label: `error:${error.code}`,
      detail: error.message,
    });
  }

  return evidence;
}

export function makeEnvelope<T>(
  command: CommandName,
  summary: CommandSummary,
  result: T,
  options: MakeEnvelopeOptions = {},
): Envelope<T> {
  const warnings = options.warnings ?? [];
  const errors = options.errors ?? [];
  const actualStatus = deriveStatus(options.status ?? 'ok', warnings, errors);
  const duration_ms =
    typeof options.started_at === 'number'
      ? Math.max(0, Date.now() - options.started_at)
      : 0;

  const meta: Envelope<T>['meta'] = {
    source_files: options.source_files ?? [],
    generated_at: options.generated_at ?? nowIso(),
    duration_ms,
    tool_version: TOOL_VERSION,
  };

  if (options.selector_input) {
    meta.selector_input = options.selector_input;
  }
  if (options.partial_reason) {
    meta.partial_reason = options.partial_reason;
  }

  const sharedContracts = cliCoreContracts();

  return sharedContracts.createEnvelope({
    schema_version: sharedContracts.schemaVersion,
    command,
    status: actualStatus,
    summary,
    result,
    warnings,
    errors,
    meta,
    evidence: buildEvidence(summary, meta, warnings, errors, sharedContracts.source),
  });
}

export function exitCodeForStatus(
  status: Status,
  fail_on: FailChoice = 'none',
  command = '',
): number {
  if (status === 'error') {
    return 2;
  }
  if (fail_on === 'none') {
    return 0;
  }
  if (fail_on === 'changed') {
    return command === 'diff' && status === 'changed' ? 1 : 0;
  }

  return cliCoreContracts().shouldFail(status, fail_on) ? 1 : 0;
}

export function dumpsJson(envelope: Envelope<unknown>): string {
  const normalizeForJson = (value: unknown): unknown => {
    if (value === null) {
      return null;
    }

    const valueType = typeof value;
    if (valueType === 'string' || valueType === 'number' || valueType === 'boolean') {
      return value;
    }
    if (valueType === 'bigint' || valueType === 'undefined' || valueType === 'function' || valueType === 'symbol') {
      return String(value);
    }
    if (value instanceof Date) {
      return value.toISOString();
    }
    if (value instanceof Error) {
      return String(value);
    }
    if (Array.isArray(value)) {
      return value.map((item) => normalizeForJson(item));
    }
    if (value && typeof value === 'object') {
      const jsonCapable = value as { toJSON?: () => unknown };
      if (typeof jsonCapable.toJSON === 'function') {
        return normalizeForJson(jsonCapable.toJSON());
      }

      return Object.fromEntries(
        Object.entries(value as Record<string, unknown>).map(([key, nestedValue]) => [
          key,
          normalizeForJson(nestedValue),
        ]),
      );
    }

    return String(value);
  };

  return JSON.stringify(normalizeForJson(envelope), null, 2);
}
