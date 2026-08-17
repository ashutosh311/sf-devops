import { execFile, type ExecFileException } from 'node:child_process';
import { promisify } from 'node:util';

import type { SfCliRunnerResult } from './types';

const execFileAsync = promisify(execFile);

/**
 * Default maxBuffer for Salesforce CLI JSON reads (10 MB) — the limit
 * quote-runtime-cli has always applied to `sf` invocations.
 */
export const SF_CLI_MAX_BUFFER_BYTES = 10 * 1024 * 1024;

export type ExecuteSfCommandOptions = {
  readonly timeoutMs?: number;
  readonly maxBuffer?: number;
  readonly windowsHide?: boolean;
};

/**
 * Runs an `sf` (or any) binary asynchronously and maps the outcome to
 * `{ exitCode, stdout, stderr }`.
 *
 * Options are strict pass-through: anything omitted keeps Node's `execFile`
 * defaults, so callers migrating onto this runner keep their exact historical
 * subprocess semantics. Non-ExecFile errors (no `code`/`stdout`/`stderr`
 * shape) are rethrown for the caller to classify.
 */
export async function executeSfCommand(
  file: string,
  args: readonly string[],
  options: ExecuteSfCommandOptions = {}
): Promise<SfCliRunnerResult> {
  try {
    const result = await execFileAsync(file, [...args], {
      encoding: 'utf8',
      ...(options.timeoutMs !== undefined ? { timeout: options.timeoutMs } : {}),
      ...(options.maxBuffer !== undefined ? { maxBuffer: options.maxBuffer } : {}),
      ...(options.windowsHide !== undefined ? { windowsHide: options.windowsHide } : {})
    });

    return {
      exitCode: 0,
      stdout: result.stdout,
      stderr: result.stderr
    };
  } catch (error) {
    if (isExecFileException(error)) {
      return {
        exitCode: typeof error.code === 'number' ? error.code : 1,
        stdout: error.stdout ?? '',
        stderr: error.stderr ?? ''
      };
    }

    throw error;
  }
}

export function defaultSfCliPath(): string | null {
  return process.platform === 'win32' ? 'sf.cmd' : 'sf';
}

export function isExecFileException(error: unknown): error is ExecFileException & { stdout?: string; stderr?: string } {
  return error instanceof Error && 'code' in error && ('stdout' in error || 'stderr' in error);
}
