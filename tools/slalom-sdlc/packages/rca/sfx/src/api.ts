import { runCli, type CliIo, type CliRuntimeDependencies } from './cli';

export interface SfxInvocationResult {
  envelope: unknown;
  exitCode: number;
  stdout: string;
  stderr: string;
}

/**
 * Run an sfx command in-process and capture its JSON envelope.
 *
 * The sfx CLI writes the canonical machine-readable envelope to stdout via
 * `formatJson(envelope)`. We capture stdout with an in-memory CliIo, invoke the
 * same `runCli` dispatcher the binary uses, then parse the captured JSON back
 * into an object so MCP tools can return structured content without shelling
 * out. `--json` is forced so every command yields the envelope form.
 */
export async function runSfxCommand(
  argv: readonly string[],
  options: { cwd?: string; dependencies?: CliRuntimeDependencies } = {},
): Promise<SfxInvocationResult> {
  const outChunks: string[] = [];
  const errChunks: string[] = [];
  const io: CliIo = {
    stdout: { write: (message: string) => { outChunks.push(message); } },
    stderr: { write: (message: string) => { errChunks.push(message); } },
    cwd: options.cwd ?? process.cwd(),
  };

  const finalArgv = argv.includes('--json') ? [...argv] : [...argv, '--json'];
  const exitCode = await runCli(finalArgv, io, options.dependencies ?? {});

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

export { listCommands, COMMAND_REGISTRY } from './registry';
