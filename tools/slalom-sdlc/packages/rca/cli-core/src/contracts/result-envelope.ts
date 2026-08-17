import type { Status } from './status';

export const CLI_FAMILY_SCHEMA_VERSION = '1.0.0';

export interface MessageEntry {
  code: string;
  message: string;
  detail?: string;
}

export interface EvidenceEntry {
  label: string;
  detail: string;
  source?: string;
}

export interface ResultEnvelope<TResult = unknown, TMeta = Record<string, unknown>> {
  schema_version: string;
  command: string;
  status: Status;
  summary: string;
  result: TResult;
  warnings: MessageEntry[];
  errors: MessageEntry[];
  meta: TMeta;
  evidence: EvidenceEntry[];
}

export function createResultEnvelope<TResult, TMeta = Record<string, unknown>>(
  input: Omit<ResultEnvelope<TResult, TMeta>, 'schema_version'> & { schema_version?: string },
): ResultEnvelope<TResult, TMeta> {
  return {
    schema_version: input.schema_version ?? CLI_FAMILY_SCHEMA_VERSION,
    command: input.command,
    status: input.status,
    summary: input.summary,
    result: input.result,
    warnings: input.warnings,
    errors: input.errors,
    meta: input.meta,
    evidence: input.evidence,
  };
}
