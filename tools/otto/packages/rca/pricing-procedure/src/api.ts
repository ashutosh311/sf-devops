/**
 * In-process API for the vendored pricing-procedure runtime.
 *
 * The upstream package shipped a `bin` that shelled out to this runtime. In
 * Otto the same logic is invoked in-process by the MCP server, so this
 * module runs a single command module and returns the structured result
 * envelope instead of writing to stdout / returning an exit code.
 *
 * Error handling mirrors the dispatch harness (`cli/dispatch.ts`): a
 * PricingCliError (or any thrown error) is converted into a canonical error
 * envelope rather than propagated.
 */
import { makeEnvelope, makeSummary, exitCodeForStatus } from './lib/contracts/envelope';
import { PricingCliError } from './lib/contracts/errors';
import type { CommandName } from './lib/contracts/constants';
import type { Envelope } from './lib/contracts/types';
import type { CommandModule } from './cli/dispatch';
import { COMMAND_MODULES } from './pricing_procedure_cli';

export type { CommandModule } from './cli/dispatch';
export type { Envelope } from './lib/contracts/types';
export { COMMAND_MODULES } from './pricing_procedure_cli';

export interface PricingCommandResult {
  /** Canonical machine-readable result envelope. */
  envelope: Envelope<unknown>;
  /** Exit code the CLI would have returned (0 ok, 1 fail-on threshold, 2 error). */
  exitCode: number;
}

/** Names of every registered pricing-procedure command. */
export function pricingCommandNames(): CommandName[] {
  return COMMAND_MODULES.map((m) => m.name);
}

/**
 * Run one pricing-procedure command in-process and return its envelope.
 *
 * @param command  A registered command name (e.g. "inspect-step", "diff").
 * @param argv     The command's own flag tokens (without the command name).
 */
export function runPricingCommand(command: string, argv: string[]): PricingCommandResult {
  const startedAt = Date.now();
  const mod: CommandModule | undefined = COMMAND_MODULES.find((m) => m.name === command);

  if (!mod) {
    const envelope = makeEnvelope(
      command as CommandName,
      makeSummary('cli', `Unknown pricing-procedure command: ${command}`, {}, 'discover'),
      {},
      {
        errors: [
          new PricingCliError(
            'invalid_selector_format',
            `Unknown pricing-procedure command: ${command}`,
            { command, allowed_values: pricingCommandNames() },
            `Use one of: ${pricingCommandNames().join(', ')}.`,
          ).toErrorObject(),
        ],
        status: 'error',
        started_at: startedAt,
      },
    );
    return { envelope, exitCode: 2 };
  }

  try {
    const args = mod.parseArgs(argv);
    const envelope = mod.run(args, startedAt);
    return { envelope, exitCode: exitCodeForStatus(envelope.status, args.failOn, command) };
  } catch (error) {
    const cliError =
      error instanceof PricingCliError
        ? error
        : new PricingCliError(
            'internal_contract_error',
            error instanceof Error ? error.message : 'Unknown CLI failure.',
            {},
            'Inspect the shared contracts layer before trusting this result.',
          );

    const envelope = makeEnvelope(
      command as CommandName,
      makeSummary('cli', cliError.message, {}, 'discover'),
      {},
      {
        errors: [cliError.toErrorObject()],
        status: 'error',
        source_files: mod.sourceFiles(argv),
        started_at: startedAt,
      },
    );
    return { envelope, exitCode: 2 };
  }
}
