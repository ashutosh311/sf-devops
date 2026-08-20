import { classifySfCliMessage, isMaxBufferError, isTimeoutError } from './classify';
import { SF_CLI_MAX_BUFFER_BYTES, defaultSfCliPath, executeSfCommand, isExecFileException } from './execute';
import { compactSfCliMessage, extractSfPayloadMessage, parseSfJsonPayload } from './parse';
import type {
  InvokeSfCliJsonOptions,
  SfCliErrorClassification,
  SfCliJsonFailure,
  SfCliJsonResult,
  SfCliRunner
} from './types';

/** Default timeout applied to `sf` JSON invocations (matches quote-runtime-cli). */
export const SF_CLI_DEFAULT_TIMEOUT_MS = 45_000;

const defaultRunSfCommand: SfCliRunner = (file, args, options) =>
  executeSfCommand(file, args, {
    timeoutMs: options.timeoutMs,
    maxBuffer: SF_CLI_MAX_BUFFER_BYTES,
    windowsHide: true
  });

/**
 * Alias-free failure messages. Wording matches quote-runtime-cli's historical
 * messages with no org alias supplied; callers needing alias-aware messages
 * inject their own `normalizeFailureMessage`.
 */
export function defaultNormalizeSfFailureMessage(
  classification: SfCliErrorClassification,
  timeoutMs: number,
  fallbackMessage: string
): string {
  switch (classification) {
    case 'auth':
      return 'Salesforce CLI live org reads are unavailable because the org is not authenticated.';
    case 'unavailable':
      return 'Salesforce CLI live org reads are unavailable.';
    case 'timeout':
      return `Salesforce CLI command timed out after ${timeoutMs}ms.`;
    case 'max_buffer':
      return 'Salesforce CLI result exceeded the 10 MB buffer limit; narrow the query or paginate.';
    case 'non_json_error':
      return fallbackMessage || 'Unable to parse Salesforce CLI JSON output.';
    case 'internal_cli_error':
      return 'Salesforce CLI live org reads are unavailable because the local Salesforce CLI returned an internal error.';
    case 'cli_error':
      return compactSfCliMessage(fallbackMessage);
  }
}

/**
 * Runs an `sf` command with `--json`-style output and interprets the result:
 * exit-code handling, JSON payload parsing, sf `status` handling, and error
 * classification (auth / unavailable / timeout / max_buffer / non-json /
 * internal / generic). Logic is extracted verbatim from quote-runtime-cli's
 * `invokeSfJson`, parameterized only by the failure-message normalizer.
 */
export async function invokeSfCliJson<T>(options: InvokeSfCliJsonOptions): Promise<SfCliJsonResult<T>> {
  const timeoutMs = options.timeoutMs ?? SF_CLI_DEFAULT_TIMEOUT_MS;
  const normalizeFailureMessage = options.normalizeFailureMessage ?? defaultNormalizeSfFailureMessage;
  const cliPath = (options.resolveCliPath ?? defaultSfCliPath)();

  if (!cliPath) {
    return createFailure({
      classification: 'unavailable',
      cliPath: null,
      message: "Salesforce CLI 'sf' is not available on PATH.",
      exitCode: null,
      stdout: '',
      stderr: ''
    });
  }

  try {
    const runner = options.run ?? defaultRunSfCommand;
    const execution = await runner(cliPath, options.args, { timeoutMs });

    const payloadResult = parseSfJsonPayload<T>(execution.stdout, execution.stderr);
    if (execution.exitCode !== 0) {
      let message: string;
      if (payloadResult.ok) {
        message = extractSfPayloadMessage(payloadResult.payload, execution.stderr, execution.stdout);
      } else {
        message = compactSfCliMessage(execution.stderr || execution.stdout || ('message' in payloadResult ? payloadResult.message : ''));
      }
      const classification = classifySfCliMessage(message);

      return createFailure({
        classification,
        cliPath,
        message: normalizeFailureMessage(classification, timeoutMs, message),
        exitCode: execution.exitCode,
        stdout: execution.stdout,
        stderr: execution.stderr
      });
    }

    if (payloadResult.ok === false) {
      return createFailure({
        classification: 'non_json_error',
        cliPath,
        message: payloadResult.message,
        exitCode: execution.exitCode,
        stdout: execution.stdout,
        stderr: execution.stderr
      });
    }

    if (payloadResult.payload.status !== undefined && payloadResult.payload.status !== 0) {
      const message = extractSfPayloadMessage(payloadResult.payload, execution.stderr, execution.stdout);
      const classification = classifySfCliMessage(message);

      return createFailure({
        classification,
        cliPath,
        message: normalizeFailureMessage(classification, timeoutMs, message),
        exitCode: execution.exitCode,
        stdout: execution.stdout,
        stderr: execution.stderr
      });
    }

    const successData = payloadResult.payload.result === undefined && payloadResult.payload.status === undefined
      ? (payloadResult.payload as unknown as T)
      : (payloadResult.payload.result as T);

    return {
      ok: true,
      classification: 'ok',
      cliPath,
      data: successData,
      exitCode: execution.exitCode,
      stdout: execution.stdout,
      stderr: execution.stderr
    };
  } catch (error) {
    const classification = isMaxBufferError(error)
      ? 'max_buffer'
      : isTimeoutError(error)
        ? 'timeout'
        : isExecFileException(error)
          ? 'unavailable'
          : 'cli_error';
    const fallbackMessage = error instanceof Error ? error.message : '';

    return createFailure({
      classification,
      cliPath,
      message: normalizeFailureMessage(classification, timeoutMs, fallbackMessage),
      exitCode: null,
      stdout: '',
      stderr: ''
    });
  }
}

function createFailure(
  failure: Omit<SfCliJsonFailure, 'ok'>
): SfCliJsonFailure {
  return {
    ok: false,
    ...failure
  };
}
