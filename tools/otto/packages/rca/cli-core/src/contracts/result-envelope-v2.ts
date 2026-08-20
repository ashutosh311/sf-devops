import { z } from 'zod';

/**
 * Canonical schema version for v2-shape envelopes.
 * A package sets its emitted version to '2.0.0' only when it actually migrates its
 * emitted JSON shape.  Packages adopting this factory while keeping their existing
 * emitted shape (e.g. quote-runtime-cli keeping '1.0.0') pass their own version
 * literal as the `schemaVersion` parameter.
 */
export const RESULT_ENVELOPE_SCHEMA_VERSION_V2 = '2.0.0' as const;

/**
 * Recursive JSON-safe value type shared by all v2 envelopes.
 * `summary` and `result` are typed as `Record<string, JsonValue>` in the v2 shape.
 */
export type JsonValue =
  | string
  | number
  | boolean
  | null
  | JsonValue[]
  | { [key: string]: JsonValue };

const jsonValueSchema: z.ZodType<JsonValue> = z.lazy(() =>
  z.union([
    z.string(),
    z.number().finite(),
    z.boolean(),
    z.null(),
    z.array(jsonValueSchema),
    z.record(z.string(), jsonValueSchema),
  ])
);

/**
 * Zod schema for a `Record<string, JsonValue>` — used for `summary` and `result`
 * in the v2 envelope shape.  Exported so package-level files can reference it in
 * their own type annotations without re-creating the recursive lazy schema.
 */
export const jsonRecordSchema: z.ZodType<Record<string, JsonValue>> = z.record(
  z.string(),
  jsonValueSchema
);

/**
 * Factory that produces a strictly-validated v2 result-envelope zod schema
 * parameterized by the package-specific axes:
 *
 * - `schemaVersion`   — string literal emitted in the envelope (e.g. `'1.0.0'` or `'2.0.0'`)
 * - `commandSchema`   — z.enum of the package's command names
 * - `statusSchema`    — z.enum of the package's status values
 * - `evidenceSchema`  — zod schema for the package's evidence array
 * - `metaSchema`      — zod schema for the package's meta object
 *
 * Fixed v2 fields (not parameterized):
 * - `summary`  → `Record<string, JsonValue>`
 * - `result`   → `Record<string, JsonValue>`
 * - `warnings` → `string[]`
 * - `errors`   → `string[]`
 *
 * The returned schema is `.strict()` — unknown top-level keys are rejected.
 */
export function makeResultEnvelopeSchemaV2<
  TVersion extends string,
  TCmd extends z.ZodTypeAny,
  TSt extends z.ZodTypeAny,
  TEv extends z.ZodTypeAny,
  TMeta extends z.ZodTypeAny,
>(params: {
  schemaVersion: TVersion;
  commandSchema: TCmd;
  statusSchema: TSt;
  evidenceSchema: TEv;
  metaSchema: TMeta;
}) {
  return z
    .object({
      schema_version: z.literal(params.schemaVersion),
      command: params.commandSchema,
      status: params.statusSchema,
      summary: jsonRecordSchema,
      result: jsonRecordSchema,
      warnings: z.array(z.string()),
      errors: z.array(z.string()),
      evidence: params.evidenceSchema,
      meta: params.metaSchema,
    })
    .strict();
}
