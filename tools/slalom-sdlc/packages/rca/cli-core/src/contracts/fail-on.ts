import { STATUS_PRECEDENCE_INDEX, type Status } from './status';

export type FailOn = Status;

export function shouldFailOnStatus(status: Status, failOn: FailOn): boolean {
  return STATUS_PRECEDENCE_INDEX[status] <= STATUS_PRECEDENCE_INDEX[failOn];
}
