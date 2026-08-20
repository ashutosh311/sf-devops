import type { SfCliPayload } from './types';

/**
 * JSON payload parsing and failure-message extraction for Salesforce CLI output.
 * Extracted verbatim from quote-runtime-cli's `sf-cli.ts`.
 */

export function parseSfJsonPayload<T>(stdout: string, stderr: string):
  | { readonly ok: true; readonly payload: SfCliPayload<T> }
  | { readonly ok: false; readonly message: string } {
  for (const stream of [stdout, stderr]) {
    const trimmed = stream.trim();
    if (!trimmed) {
      continue;
    }

    try {
      const parsed = JSON.parse(trimmed) as unknown;
      if (isRecord(parsed)) {
        return {
          ok: true,
          payload: parsed as SfCliPayload<T>
        };
      }

      if (Array.isArray(parsed)) {
        return {
          ok: true,
          payload: { result: parsed as T }
        };
      }

      return {
        ok: false,
        message: 'Salesforce CLI returned a non-object JSON payload.'
      };
    } catch {
      continue;
    }
  }

  return {
    ok: false,
    message: 'Unable to parse Salesforce CLI JSON output.'
  };
}

export function extractSfPayloadMessage<T>(payload: SfCliPayload<T>, stderr: string, stdout: string): string {
  if (typeof payload.message === 'string' && payload.message.trim()) {
    return payload.message.trim();
  }

  if (typeof payload.name === 'string' && payload.name.trim()) {
    return payload.name.trim();
  }

  const payloadMessage = summarizePayload(payload);
  if (payloadMessage) {
    return payloadMessage;
  }

  for (const stream of [stderr, stdout]) {
    const trimmed = stream.trim();
    if (trimmed) {
      return trimmed;
    }
  }

  return 'Salesforce CLI command failed.';
}

function summarizePayload(payload: unknown): string | null {
  if (Array.isArray(payload)) {
    const messages = payload
      .map((entry) => summarizePayload(entry))
      .filter((entry): entry is string => Boolean(entry));
    return messages.length > 0 ? messages.join('; ') : null;
  }

  if (!isRecord(payload)) {
    return null;
  }

  const result = payload.result;
  if (result !== undefined) {
    return summarizePayload(result);
  }

  const errorResponse = payload.errorResponse;
  if (Array.isArray(errorResponse) && errorResponse.length > 0) {
    const messages = errorResponse
      .map((entry) => summarizePayload(entry))
      .filter((entry): entry is string => Boolean(entry));
    if (messages.length > 0) {
      return messages.join('; ');
    }
  }

  const errorCode = typeof payload.errorCode === 'string' ? payload.errorCode : null;
  const errorMessage = typeof payload.errorMessage === 'string'
    ? payload.errorMessage
    : typeof payload.message === 'string'
      ? payload.message
      : null;
  if (errorCode || errorMessage) {
    return [errorCode, errorMessage].filter(Boolean).join(': ');
  }

  try {
    return JSON.stringify(payload);
  } catch {
    return null;
  }
}

export function compactSfCliMessage(message: string): string {
  const compact = message
    .split('\n')
    .map((line) => line.trim())
    .find((line) => line.length > 0);

  return compact ?? 'Salesforce CLI command failed.';
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
