#!/usr/bin/env node

import { runCli } from '../cli';

runCli(process.argv.slice(2), {
  stdout: process.stdout,
  stderr: process.stderr,
  cwd: process.cwd(),
}).then((exitCode) => {
  process.exitCode = exitCode;
}).catch((error: unknown) => {
  process.stderr.write(`ERROR: ${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 2;
});
