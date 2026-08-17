import { runQuoteRuntimeCli } from './bin/quote-runtime';

export interface QuoteRuntimeInvocationResult {
  envelope: unknown;
  exitCode: number;
  stdout: string;
  stderr: string;
}

/**
 * Run a quote-runtime command in-process and capture its JSON envelope.
 *
 * The quote-runtime CLI writes its canonical result envelope to stdout. We
 * capture stdout with an in-memory CliIo, invoke the same dispatcher the binary
 * uses, then parse the captured JSON back into an object so MCP tools can return
 * structured content without shelling out. `--json` is forced so every command
 * yields the envelope form.
 */
export async function runQuoteRuntimeCommand(
  command: string,
  argv: readonly string[] = [],
): Promise<QuoteRuntimeInvocationResult> {
  const outChunks: string[] = [];
  const errChunks: string[] = [];
  const io = {
    stdout: { write: (message: string) => { outChunks.push(message); } },
    stderr: { write: (message: string) => { errChunks.push(message); } },
  };

  const fullArgv = [command, ...argv];
  if (!fullArgv.includes('--json')) {
    fullArgv.push('--json');
  }
  const exitCode = await runQuoteRuntimeCli(fullArgv, io);

  const stdout = outChunks.join('');
  const stderr = errChunks.join('');

  let envelope: unknown;
  const trimmed = stdout.trim();
  if (trimmed.length > 0) {
    try {
      envelope = JSON.parse(trimmed);
    } catch {
      envelope = undefined;
    }
  }

  return { envelope, exitCode, stdout, stderr };
}

export { runQuoteRuntimeCli } from './bin/quote-runtime';
export { ALL_COMMAND_NAMES, type CommandName } from './contracts/command-names';
