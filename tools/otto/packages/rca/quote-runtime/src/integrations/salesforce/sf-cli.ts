/**
 * Thin adapter over @otto/rca-cli-core's shared Salesforce CLI runner.
 *
 * Subprocess execution, JSON payload parsing, and error classification
 * (auth / unavailable / timeout / max_buffer / non-json / internal / generic)
 * live in cli-core's `sf-runner`. This module keeps quote-runtime's stable
 * exported surface and its org-alias-aware failure messages.
 */
import {
  compactSfCliMessage,
  invokeSfCliJson,
  type SfCliErrorClassification,
  type SfCliJsonResult,
  type SfCliRunner
} from '@otto/rca-cli-core';

export {
  SF_CLI_ERROR_CLASSIFICATIONS,
  classifySfCliMessage,
  parseSfJsonPayload
} from '@otto/rca-cli-core';
export type {
  SfCliErrorClassification,
  SfCliJsonFailure,
  SfCliJsonResult,
  SfCliJsonSuccess,
  SfCliRunner,
  SfCliRunnerResult
} from '@otto/rca-cli-core';

export type InvokeSfJsonOptions = {
  readonly args: readonly string[];
  readonly orgAlias?: string;
  readonly timeoutMs?: number;
  readonly resolveCliPath?: () => string | null;
  readonly run?: SfCliRunner;
};

export async function invokeSfJson<T>(options: InvokeSfJsonOptions): Promise<SfCliJsonResult<T>> {
  return invokeSfCliJson<T>({
    args: options.args,
    timeoutMs: options.timeoutMs,
    resolveCliPath: options.resolveCliPath,
    run: options.run,
    normalizeFailureMessage: (classification, timeoutMs, fallbackMessage) =>
      normalizeFailureMessage(classification, options.orgAlias, timeoutMs, fallbackMessage)
  });
}

function normalizeFailureMessage(
  classification: SfCliErrorClassification,
  orgAlias: string | undefined,
  timeoutMs: number,
  fallbackMessage: string
): string {
  const normalizedAlias = orgAlias?.trim();
  const aliasSuffix = normalizedAlias ? ` for alias '${normalizedAlias}'` : '';

  switch (classification) {
    case 'auth':
      return `Salesforce CLI live org reads are unavailable${aliasSuffix} because the org is not authenticated.`;
    case 'unavailable':
      return `Salesforce CLI live org reads are unavailable${aliasSuffix}.`;
    case 'timeout':
      return `Salesforce CLI command timed out after ${timeoutMs}ms${aliasSuffix ? aliasSuffix : ''}.`;
    case 'max_buffer':
      return 'Salesforce CLI result exceeded the 10 MB buffer limit; narrow the query or paginate.';
    case 'non_json_error':
      return fallbackMessage || 'Unable to parse Salesforce CLI JSON output.';
    case 'internal_cli_error':
      return `Salesforce CLI live org reads are unavailable${aliasSuffix} because the local Salesforce CLI returned an internal error.`;
    case 'cli_error':
      return compactSfCliMessage(fallbackMessage);
  }
}
