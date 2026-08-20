export const STATUS_PRECEDENCE = [
  'error',
  'unsupported',
  'partial',
  'warn',
  'changed',
  'no_match',
  'no_change',
  'ok',
] as const;

export type Status = (typeof STATUS_PRECEDENCE)[number];

export const STATUS_PRECEDENCE_INDEX: Readonly<Record<Status, number>> = Object.freeze(
  STATUS_PRECEDENCE.reduce<Record<Status, number>>((accumulator, status, index) => {
    accumulator[status] = index;
    return accumulator;
  }, {} as Record<Status, number>),
);

export function compareStatusSeverity(left: Status, right: Status): number {
  return STATUS_PRECEDENCE_INDEX[left] - STATUS_PRECEDENCE_INDEX[right];
}

export function selectHigherSeverityStatus(left: Status, right: Status): Status {
  return compareStatusSeverity(left, right) <= 0 ? left : right;
}
