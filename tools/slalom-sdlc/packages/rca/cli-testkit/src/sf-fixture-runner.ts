/**
 * Types and helpers for building injectable sf CLI fixture runners in tests.
 * Zero test-framework dependency — works from compiled node scripts (sfx
 * hand-rolled asserters) and from vitest tests alike.
 */

/**
 * Minimal result shape returned by executing the sf CLI: stdout, stderr, exit
 * code. This type is intentionally identical to OrgBaselineRunnerResult and
 * the inline runner shapes in sfx's test fixtures, collected here so each
 * command's test file does not need to re-declare it.
 */
export interface SfRunnerResult {
  stdout: string;
  stderr: string;
  exitCode: number;
}

/**
 * Build a canned sf success response wrapping a JSON result payload.
 * Matches the `{ status: 0, result: ... }` envelope the real sf CLI emits to
 * stdout on successful execution.
 */
export function makeSfOkResponse(result: unknown): SfRunnerResult {
  return {
    stdout: JSON.stringify({ status: 0, result }),
    stderr: '',
    exitCode: 0,
  };
}

/**
 * Build a canned sf error response.
 */
export function makeSfErrorResponse(stderr: string, exitCode = 1): SfRunnerResult {
  return { stdout: '', stderr, exitCode };
}
