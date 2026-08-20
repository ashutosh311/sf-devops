import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';

import type { GlobalFlags } from './global-flags';

export type CliIo = {
  stdout: { write(message: string): void };
  stderr: { write(message: string): void };
};

export function emitTextOutput(message: string, flags: GlobalFlags, io: CliIo): void {
  emitOutput(message, flags, io);
}

export function emitJsonOutput(payload: unknown, flags: GlobalFlags, io: CliIo): void {
  emitOutput(`${JSON.stringify(payload, null, 2)}\n`, flags, io);
}

export function emitParseError(message: string, io: CliIo): void {
  io.stderr.write(`${message.trimEnd()}\n`);
}

function emitOutput(message: string, flags: GlobalFlags, io: CliIo): void {
  if (flags.output !== undefined) {
    mkdirSync(dirname(flags.output), { recursive: true });
    writeFileSync(flags.output, message, 'utf8');
    return;
  }

  io.stdout.write(message);
}
