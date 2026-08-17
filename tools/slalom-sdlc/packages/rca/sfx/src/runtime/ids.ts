import { randomBytes } from 'node:crypto';

function pad(value: number, width: number): string {
  return value.toString().padStart(width, '0');
}

export function createShortId(size = 3): string {
  return randomBytes(size).toString('hex');
}

export function createRunId(now: Date = new Date(), shortId: string = createShortId()): string {
  return [
    'run',
    `${now.getUTCFullYear()}${pad(now.getUTCMonth() + 1, 2)}${pad(now.getUTCDate(), 2)}`,
    `${pad(now.getUTCHours(), 2)}${pad(now.getUTCMinutes(), 2)}${pad(now.getUTCSeconds(), 2)}`,
    shortId,
  ].join('_');
}

export function createCommandExecutionId(step: number, shortId: string = createShortId()): string {
  return `exec_${pad(step, 3)}_${shortId}`;
}

export function commandToSlug(command: string): string {
  return command
    .trim()
    .toLowerCase()
    .replace(/^sfx\s+/, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}
