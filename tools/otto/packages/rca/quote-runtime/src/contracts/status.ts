export const RUNTIME_STATUSES = [
  'ok',
  'warn',
  'error',
  'partial',
  'changed',
  'no_change',
  'no_match',
  'unsupported'
] as const;

export type RuntimeStatus = (typeof RUNTIME_STATUSES)[number];

export const STATUS_PRECEDENCE = [
  'error',
  'unsupported',
  'partial',
  'warn',
  'changed',
  'no_match',
  'no_change',
  'ok'
] as const satisfies readonly RuntimeStatus[];

const RUNTIME_STATUS_SET = new Set<RuntimeStatus>(RUNTIME_STATUSES);
const STATUS_PRECEDENCE_SET = new Set<RuntimeStatus>(STATUS_PRECEDENCE);

if (
  STATUS_PRECEDENCE.length !== RUNTIME_STATUSES.length ||
  STATUS_PRECEDENCE_SET.size !== RUNTIME_STATUSES.length ||
  RUNTIME_STATUSES.some((status) => !STATUS_PRECEDENCE_SET.has(status))
) {
  throw new Error('STATUS_PRECEDENCE must contain every runtime status exactly once.');
}

export const FAIL_ON_VALUES = [
  'none',
  'warn',
  'partial',
  'no_match',
  'unsupported',
  'changed',
  'no_change',
  'error'
] as const;

export type FailOn = (typeof FAIL_ON_VALUES)[number];

const STATUS_PRECEDENCE_INDEX = Object.freeze(
  Object.fromEntries(STATUS_PRECEDENCE.map((status, index) => [status, index]))
) as Readonly<Record<RuntimeStatus, number>>;

export function getStatusPrecedence(status: RuntimeStatus): number {
  if (!RUNTIME_STATUS_SET.has(status)) {
    throw new Error(`Unknown runtime status: ${status}`);
  }

  return STATUS_PRECEDENCE_INDEX[status];
}

export function shouldFailForStatus(status: RuntimeStatus, failOn: FailOn): boolean {
  if (failOn === 'none') {
    return false;
  }

  return getStatusPrecedence(status) <= getStatusPrecedence(failOn);
}
