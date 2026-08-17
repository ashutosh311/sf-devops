import type { SfCliErrorClassification } from './types';

/**
 * Error-classification snippets and predicates for Salesforce CLI failures.
 * Extracted verbatim from quote-runtime-cli's `sf-cli.ts`; the snippet lists
 * and matching semantics drive control flow in callers and must not drift.
 */

const SF_AUTH_ERROR_SNIPPETS = [
  'no authorization information found',
  'authorize an org',
  'not authenticated',
  'invalid or expired session',
  'no access token',
  'no username'
] as const;

const UNAVAILABLE_ERROR_SNIPPETS = [
  'org with alias',
  'named org',
  'default org',
  'defaultusername',
  'scratch org',
  'no authorization information found'
] as const;

const INTERNAL_CLI_ERROR_SNIPPETS = ['cannot read properties of undefined', 'typeerror:'] as const;

export function classifySfCliMessage(message: string): SfCliErrorClassification {
  const loweredMessage = normalizeForMatching(message);

  if (containsSnippet(loweredMessage, INTERNAL_CLI_ERROR_SNIPPETS)) {
    return 'internal_cli_error';
  }

  if (containsSnippet(loweredMessage, SF_AUTH_ERROR_SNIPPETS)) {
    return 'auth';
  }

  if (containsSnippet(loweredMessage, UNAVAILABLE_ERROR_SNIPPETS)) {
    return 'unavailable';
  }

  return 'cli_error';
}

export function isTimeoutError(error: unknown): boolean {
  if (!(error instanceof Error)) {
    return false;
  }

  const code = 'code' in error ? error.code : undefined;
  return code === 'ETIMEDOUT' || /timed out/i.test(error.message);
}

export function isMaxBufferError(error: unknown): boolean {
  if (!(error instanceof Error)) {
    return false;
  }

  const code = 'code' in error ? error.code : undefined;
  return code === 'ERR_CHILD_PROCESS_STDIO_MAXBUFFER';
}

function containsSnippet(message: string, snippets: readonly string[]): boolean {
  return snippets.some((snippet) => message.includes(snippet));
}

function normalizeForMatching(message: string): string {
  return message.trim().toLowerCase();
}
