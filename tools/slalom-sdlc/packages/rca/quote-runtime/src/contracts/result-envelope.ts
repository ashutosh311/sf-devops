import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';

import { z } from 'zod';
import { makeResultEnvelopeSchemaV2, jsonRecordSchema } from '@sdlc/rca-cli-core';

import { ALL_COMMAND_NAMES, type CommandName } from './command-names';
import { evidenceListSchema, type EvidenceItem } from './evidence';
import { FAIL_ON_VALUES, RUNTIME_STATUSES, shouldFailForStatus, type FailOn, type RuntimeStatus } from './status';
import type { EnvelopeSummary } from './envelope-summary';

export const RESULT_ENVELOPE_SCHEMA_VERSION = '1.0.0' as const;

export type JsonValue = string | number | boolean | null | JsonValue[] | { [key: string]: JsonValue };

const commandNameSchema = z.enum(ALL_COMMAND_NAMES);
const runtimeStatusSchema = z.enum(RUNTIME_STATUSES);
const failOnSchema = z.enum(FAIL_ON_VALUES);

export const envelopeMetaSchema = z
  .object({
    org_alias: z.string().min(1, 'meta.org_alias is required'),
    generated_at: z.string().datetime({ offset: true }),
    duration_ms: z.number().finite().nonnegative(),
    source_files: z.array(z.string().min(1, 'meta.source_files entries must be non-empty'))
  })
  .strict();

export const resultEnvelopeSchema = makeResultEnvelopeSchemaV2({
  schemaVersion: RESULT_ENVELOPE_SCHEMA_VERSION,
  commandSchema: commandNameSchema,
  statusSchema: runtimeStatusSchema,
  evidenceSchema: evidenceListSchema,
  metaSchema: envelopeMetaSchema,
});

export type EnvelopeMeta = z.infer<typeof envelopeMetaSchema>;
export type ResultEnvelope = z.infer<typeof resultEnvelopeSchema>;

export type MakeEnvelopeInput = {
  command: CommandName;
  status: RuntimeStatus;
  summary: EnvelopeSummary;
  result: Record<string, JsonValue>;
  warnings?: string[];
  errors?: string[];
  evidence?: EvidenceItem[];
  meta: {
    org_alias: string;
    generated_at: string;
    duration_ms: number;
    source_files?: string[];
  };
};

export function normalizeStatus(status: RuntimeStatus | string): RuntimeStatus {
  const parsed = runtimeStatusSchema.safeParse(status);

  if (!parsed.success) {
    throw new Error(`Invalid runtime status: ${status}`);
  }

  return parsed.data;
}

export function parseEnvelope(value: unknown): ResultEnvelope {
  return resultEnvelopeSchema.parse(value);
}

export function makeEnvelope(input: MakeEnvelopeInput): ResultEnvelope {
  return parseEnvelope({
    schema_version: RESULT_ENVELOPE_SCHEMA_VERSION,
    command: input.command,
    status: input.status,
    summary: input.summary,
    result: input.result,
    warnings: input.warnings ?? [],
    errors: input.errors ?? [],
    evidence: input.evidence ?? [],
    meta: {
      org_alias: input.meta.org_alias,
      generated_at: input.meta.generated_at,
      duration_ms: input.meta.duration_ms,
      source_files: input.meta.source_files ?? []
    }
  });
}

export function exitCodeForStatus(status: RuntimeStatus | string, failOn: FailOn = 'error'): 0 | 1 {
  return shouldFailForStatus(normalizeStatus(status), failOnSchema.parse(failOn)) ? 1 : 0;
}

export function renderEnvelopeJson(envelope: ResultEnvelope): string {
  return `${JSON.stringify(parseEnvelope(envelope), null, 2)}\n`;
}

export function writeEnvelopeJson(path: string, envelope: ResultEnvelope): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, renderEnvelopeJson(envelope), 'utf8');
}

// Re-export jsonRecordSchema from cli-core for consumers that need the zod type
export { jsonRecordSchema };

// Re-export EnvelopeSummary so command files and tests can import from one place
export type { EnvelopeSummary };
