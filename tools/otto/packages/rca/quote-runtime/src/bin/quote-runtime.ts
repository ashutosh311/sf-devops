#!/usr/bin/env node

import type { CliIo } from '../cli/output';
import { emitParseError, emitTextOutput } from '../cli/output';
import { parseGlobalFlags, splitRootArgv } from '../cli/global-flags';
import { renderRootHelp } from '../cli/root-help';
import { getRegistryEntry } from '../registry/command-registry';

const DEFAULT_IO: CliIo = {
  stdout: process.stdout,
  stderr: process.stderr
};

export async function runQuoteRuntimeCli(argv: string[], io: CliIo = DEFAULT_IO): Promise<number> {
  try {
    const rootArgv = splitRootArgv(argv);
    const globalFlags = await parseGlobalFlags(rootArgv.globalArgv);

    if (rootArgv.commandName === undefined) {
      if (globalFlags.help) {
        emitTextOutput(renderRootHelp(), globalFlags, io);
        return 0;
      }

      emitParseError('A command is required. Use --help to view the available root command surface.', io);
      return 2;
    }

    if (globalFlags.help) {
      emitTextOutput(renderRootHelp(), globalFlags, io);
      return 0;
    }

    const registryEntry = getRegistryEntry(rootArgv.commandName);

    if (registryEntry === undefined) {
      emitParseError(`Unknown command: ${rootArgv.commandName}`, io);
      return 2;
    }

    if (rootArgv.commandArgv.includes('--help')) {
      emitTextOutput(registryEntry.renderHelp(), globalFlags, io);
      return 0;
    }

    const execution = await registryEntry.run(rootArgv.commandArgv, globalFlags, io);
    return execution.exitCode;
  } catch (error) {
    emitParseError(formatParseError(error), io);
    return 2;
  }
}

export async function main(argv: string[] = process.argv.slice(2)): Promise<void> {
  process.exitCode = await runQuoteRuntimeCli(argv);
}


function formatParseError(error: unknown): string {
  if (typeof error === 'object' && error !== null && 'message' in error && typeof error.message === 'string') {
    return error.message;
  }

  if (error instanceof Error) {
    return error.message;
  }

  return 'Unknown CLI parse failure.';
}
