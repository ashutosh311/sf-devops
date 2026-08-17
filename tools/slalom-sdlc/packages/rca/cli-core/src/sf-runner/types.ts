/**
 * Shared types for the Salesforce CLI runner.
 *
 * Extracted verbatim from quote-runtime-cli's `sf-cli.ts` so every package in the
 * CLI family interprets `sf` results (exit codes, JSON payloads, error
 * classifications) the same way.
 */

export const SF_CLI_ERROR_CLASSIFICATIONS = [
  'unavailable',
  'auth',
  'timeout',
  'max_buffer',
  'non_json_error',
  'internal_cli_error',
  'cli_error'
] as const;

export type SfCliErrorClassification = (typeof SF_CLI_ERROR_CLASSIFICATIONS)[number];

export type SfCliRunnerResult = {
  readonly exitCode: number;
  readonly stdout: string;
  readonly stderr: string;
};

export type SfCliRunner = (
  file: string,
  args: readonly string[],
  options: {
    readonly timeoutMs: number;
  }
) => Promise<SfCliRunnerResult>;

export type SfCliJsonSuccess<T> = {
  readonly ok: true;
  readonly classification: 'ok';
  readonly cliPath: string;
  readonly data: T;
  readonly exitCode: number;
  readonly stdout: string;
  readonly stderr: string;
};

export type SfCliJsonFailure = {
  readonly ok: false;
  readonly classification: SfCliErrorClassification;
  readonly cliPath: string | null;
  readonly message: string;
  readonly exitCode: number | null;
  readonly stdout: string;
  readonly stderr: string;
};

export type SfCliJsonResult<T> = SfCliJsonSuccess<T> | SfCliJsonFailure;

export type SfCliPayload<T> = {
  readonly status?: number;
  readonly result?: T;
  readonly message?: string;
  readonly name?: string;
};

/**
 * Hook that turns a raw classification + fallback message into the user-facing
 * failure message. Callers with package-specific context (e.g. quote-runtime's
 * org-alias suffixes) inject their own; `defaultNormalizeSfFailureMessage` is
 * used otherwise.
 */
export type SfCliFailureMessageNormalizer = (
  classification: SfCliErrorClassification,
  timeoutMs: number,
  fallbackMessage: string
) => string;

export type InvokeSfCliJsonOptions = {
  readonly args: readonly string[];
  readonly timeoutMs?: number;
  readonly resolveCliPath?: () => string | null;
  readonly run?: SfCliRunner;
  readonly normalizeFailureMessage?: SfCliFailureMessageNormalizer;
};
