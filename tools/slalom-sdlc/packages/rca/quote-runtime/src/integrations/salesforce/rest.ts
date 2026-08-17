import {
  invokeSfJson,
  type InvokeSfJsonOptions,
  type SfCliErrorClassification,
  type SfCliJsonResult
} from './sf-cli';

export const SF_REST_ERROR_CLASSIFICATIONS = [
  'unavailable',
  'auth',
  'timeout',
  'non_json_error',
  'internal_cli_error',
  'cli_error'
] as const;

export type SfRestErrorClassification = SfCliErrorClassification;

export type SfRestGetSuccess<T> = {
  readonly ok: true;
  readonly classification: 'ok';
  readonly path: string;
  readonly cliPath: string;
  readonly data: T;
  readonly exitCode: number;
  readonly stdout: string;
  readonly stderr: string;
};

export type SfRestGetFailure = {
  readonly ok: false;
  readonly classification: SfRestErrorClassification;
  readonly path: string;
  readonly cliPath: string | null;
  readonly message: string;
  readonly exitCode: number | null;
  readonly stdout: string;
  readonly stderr: string;
};

export type SfRestGetResult<T> = SfRestGetSuccess<T> | SfRestGetFailure;
export type SfRestWriteSuccess<T> = {
  readonly ok: true;
  readonly classification: 'ok';
  readonly path: string;
  readonly method: 'POST' | 'PATCH';
  readonly body: string;
  readonly cliPath: string;
  readonly data: T;
  readonly exitCode: number;
  readonly stdout: string;
  readonly stderr: string;
};

export type SfRestWriteFailure = {
  readonly ok: false;
  readonly classification: SfRestErrorClassification;
  readonly path: string;
  readonly method: 'POST' | 'PATCH';
  readonly body: string;
  readonly cliPath: string | null;
  readonly message: string;
  readonly exitCode: number | null;
  readonly stdout: string;
  readonly stderr: string;
};

export type SfRestWriteResult<T> = SfRestWriteSuccess<T> | SfRestWriteFailure;

export type InvokeSfRestGetOptions = {
  readonly orgAlias: string;
  readonly path: string;
  readonly timeoutMs?: number;
  readonly invokeSfJson?: <T>(options: InvokeSfJsonOptions) => Promise<SfCliJsonResult<T>>;
};

export type InvokeSfRestWriteOptions = {
  readonly orgAlias: string;
  readonly path: string;
  readonly method: 'POST' | 'PATCH';
  readonly body: unknown;
  readonly timeoutMs?: number;
  readonly invokeSfJson?: <T>(options: InvokeSfJsonOptions) => Promise<SfCliJsonResult<T>>;
};

export async function invokeSfRestGet<T>(options: InvokeSfRestGetOptions): Promise<SfRestGetResult<T>> {
  const normalizedPath = normalizeRestPath(options.path);
  const executeSfJson = options.invokeSfJson ?? invokeSfJson;
  const sfResult = await executeSfJson<T>({
    args: buildSfRestGetArgs(options.orgAlias, normalizedPath),
    orgAlias: options.orgAlias,
    ...(options.timeoutMs === undefined ? {} : { timeoutMs: options.timeoutMs })
  });

  if (sfResult.ok === false) {
    return {
      ok: false,
      classification: sfResult.classification,
      path: normalizedPath,
      cliPath: sfResult.cliPath,
      message: sfResult.message,
      exitCode: sfResult.exitCode,
      stdout: sfResult.stdout,
      stderr: sfResult.stderr
    };
  }

  return {
    ok: true,
    classification: 'ok',
    path: normalizedPath,
    cliPath: sfResult.cliPath,
    data: sfResult.data,
    exitCode: sfResult.exitCode,
    stdout: sfResult.stdout,
    stderr: sfResult.stderr
  };
}

export async function invokeSfRestWrite<T>(options: InvokeSfRestWriteOptions): Promise<SfRestWriteResult<T>> {
  const normalizedPath = normalizeRestPath(options.path);
  const normalizedBody = JSON.stringify(options.body);
  const executeSfJson = options.invokeSfJson ?? invokeSfJson;
  const sfResult = await executeSfJson<T>({
    args: buildSfRestWriteArgs(options.orgAlias, normalizedPath, options.method, normalizedBody),
    orgAlias: options.orgAlias,
    ...(options.timeoutMs === undefined ? {} : { timeoutMs: options.timeoutMs })
  });

  if (sfResult.ok === false) {
    return {
      ok: false,
      classification: sfResult.classification,
      path: normalizedPath,
      method: options.method,
      body: normalizedBody,
      cliPath: sfResult.cliPath,
      message: sfResult.message,
      exitCode: sfResult.exitCode,
      stdout: sfResult.stdout,
      stderr: sfResult.stderr
    };
  }

  return {
    ok: true,
    classification: 'ok',
    path: normalizedPath,
    method: options.method,
    body: normalizedBody,
    cliPath: sfResult.cliPath,
    data: sfResult.data,
    exitCode: sfResult.exitCode,
    stdout: sfResult.stdout,
    stderr: sfResult.stderr
  };
}

export function buildSfRestGetArgs(orgAlias: string, path: string): string[] {
  return ['api', 'request', 'rest', normalizeRestPath(path), '--target-org', orgAlias, '--method', 'GET'];
}

export function buildSfRestWriteArgs(orgAlias: string, path: string, method: 'POST' | 'PATCH', body: string): string[] {
  return [
    'api',
    'request',
    'rest',
    normalizeRestPath(path),
    '--target-org',
    orgAlias,
    '--method',
    method,
    '--body',
    body
  ];
}

export function normalizeRestPath(path: string): string {
  const trimmed = String(path).trim();
  if (!trimmed) {
    throw new Error('REST path must be a non-empty string.');
  }

  return trimmed.startsWith('/') ? trimmed : `/${trimmed}`;
}
