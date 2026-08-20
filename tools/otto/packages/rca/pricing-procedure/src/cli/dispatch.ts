/**
 * Shared dispatch harness for pricing-procedure-cli.
 *
 * Handles: global-flag parsing, command lookup, help routing, envelope
 * rendering, exit-code logic, and the error-handling envelope.  Each command
 * is a CommandModule registered in the entry-point array.
 */

import {
  ALL_COMMANDS,
  FAIL_CHOICES,
  FAIL_DEFAULTS,
  READONLY_NOTE,
  type CommandName,
  type FailChoice,
} from '../lib/contracts/constants';
import { exitCodeForStatus, makeEnvelope, makeNotice, makeSummary, dumpsJson } from '../lib/contracts/envelope';
import { PricingCliError } from '../lib/contracts/errors';
import type { Envelope } from '../lib/contracts/types';

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

/** Minimum fields the dispatch harness reads from parsed command args. */
export interface MinCommandArgs {
  json: boolean;
  failOn: FailChoice;
}

/**
 * Uniform interface every command module must satisfy.
 *
 * Implementations keep their own internal arg types; they cast inside
 * `parseArgs` / `run` as needed.  The contract here is structural.
 */
export interface CommandModule {
  /** Stable command name (must be in ALL_COMMANDS). */
  readonly name: CommandName;
  /** One-line help shown in the top-level command listing. */
  readonly help: string;
  /** Full subcommand --help output (including description, usage, options, epilog). */
  readonly helpText: string;
  parseArgs(argv: string[]): MinCommandArgs;
  run(args: MinCommandArgs, startedAt: number): Envelope<unknown>;
  /** Source-file paths extracted from raw argv for error-envelope metadata. */
  sourceFiles(argv: string[]): string[];
}

// ---------------------------------------------------------------------------
// Shared helpers
// ---------------------------------------------------------------------------

const TOP_LEVEL_DESCRIPTION =
  'Canonical pricing procedure analysis CLI. JSON is the canonical machine interface; ' +
  'text mode is a compact rendering of the same result contract. ' +
  READONLY_NOTE;

const TOP_LEVEL_EPILOG = `Workflow examples:
  How does NetUnitPrice get calculated?
    pricing-procedure trace-tag --file <procedure-file> --version active --tag NetUnitPrice --json

  Update the final calculations and the pricing waterfall for how NetUnitPrice gets calculated.
    pricing-procedure plan-change --file <procedure-file> --version active --tag NetUnitPrice --context <context-file> --object QuoteLineItem --json

  What QuoteLineItem field is NetUnitPrice mapped from?
    pricing-procedure crosswalk --procedure <procedure-file> --context <context-file> --version active --tag NetUnitPrice --object QuoteLineItem --include-mappings --json

  What changed in the NetUnitPrice flow between versions?
    pricing-procedure diff --file <procedure-file> --version-left <left-version> --version-right <right-version> --tag NetUnitPrice --json

  I am not sure I have the right procedure/context/version.
    pricing-procedure doctor --file <procedure-file> --context <context-file> --version active --json
    pricing-procedure explain-error --list-codes --json

Help note: use "help" as a shortcut alias, for example:
  pricing-procedure help trace-tag

Exit codes: 0=ok/no_change, 1=warn/partial/changed/no_match/unsupported, 2=error.
See .agents/skills/pricing-procedures/references/script-quick-reference.md for command routing.`;

/** Shared text rendering for a result envelope. */
export function renderText(envelope: Envelope<unknown>): string {
  const lines: string[] = [];
  lines.push(`command=${envelope.command} status=${envelope.status}`);
  lines.push(`primary_subject=${envelope.summary.primary_subject}`);
  lines.push(`status_reason=${envelope.summary.status_reason}`);
  if (Object.keys(envelope.summary.key_counts).length > 0) {
    lines.push(`key_counts=${JSON.stringify(envelope.summary.key_counts)}`);
  }
  if (envelope.warnings.length > 0) {
    lines.push('warnings:');
    for (const item of envelope.warnings) {
      lines.push(`- ${item.code}: ${item.message}`);
    }
  }
  if (envelope.errors.length > 0) {
    lines.push('errors:');
    for (const item of envelope.errors) {
      lines.push(`- ${item.code}: ${item.message}`);
    }
  }
  lines.push(`result=${JSON.stringify(envelope.result, null, 2)}`);
  return lines.join('\n');
}

/** Render an envelope as JSON or compact text. */
export function renderEnvelope(envelope: Envelope<unknown>, asJson: boolean): string {
  return asJson ? dumpsJson(envelope) : renderText(envelope);
}

/** Write one line to stdout or stderr. */
export function emit(stream: 'stdout' | 'stderr', output: string): void {
  if (stream === 'stderr') {
    process.stderr.write(`${output}\n`);
    return;
  }
  process.stdout.write(`${output}\n`);
}

// ---------------------------------------------------------------------------
// --fail-on shared parser (used by command modules that delegate here)
// ---------------------------------------------------------------------------

/** Parse and validate a --fail-on value; throws PricingCliError on bad input. */
export function parseFailOn(command: CommandName, next: string | undefined): FailChoice {
  if (!next || next.startsWith('--')) {
    throw new PricingCliError(
      'invalid_selector_format',
      `${command} requires a value for --fail-on when the flag is supplied.`,
      { command },
      `Use one of: ${FAIL_CHOICES.join(', ')}.`,
    );
  }
  if (!(FAIL_CHOICES as readonly string[]).includes(next)) {
    throw new PricingCliError(
      'invalid_selector_format',
      `Invalid --fail-on value: ${next}`,
      { command, fail_on: next, allowed_values: FAIL_CHOICES },
      `Use one of: ${FAIL_CHOICES.join(', ')}.`,
    );
  }
  return next as FailChoice;
}

// ---------------------------------------------------------------------------
// Unsupported-command fallback (safety net for future ALL_COMMANDS additions)
// ---------------------------------------------------------------------------

interface UnsupportedArgs {
  json: boolean;
  failOn: FailChoice;
  passthroughArgs: string[];
}

function parseUnsupportedArgs(command: CommandName, argv: string[]): UnsupportedArgs {
  let json = false;
  let failOn: FailChoice = (FAIL_DEFAULTS as Partial<Record<CommandName, FailChoice>>)[command] ?? 'none';
  const passthroughArgs: string[] = [];

  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (token === '--json') {
      json = true;
      continue;
    }
    if (token === '--fail-on') {
      const next = argv[index + 1];
      failOn = parseFailOn(command, next);
      index += 1;
      continue;
    }
    passthroughArgs.push(token);
  }

  return { json, failOn, passthroughArgs };
}

function buildUnsupportedEnvelope(
  command: CommandName,
  args: UnsupportedArgs,
  startedAt: number,
): Envelope<unknown> {
  return makeEnvelope(
    command,
    makeSummary(
      'cli',
      `The ${command} workflow is not implemented in the TS entrypoint yet.`,
      { accepted_argument_count: args.passthroughArgs.length },
      'explain-error',
    ),
    {
      implemented: false,
      command,
      accepted_passthrough_args: args.passthroughArgs,
      suggested_runtime: 'pricing-procedure',
    },
    {
      warnings: [
        makeNotice(
          'unsupported_analysis_mode',
          `The ${command} command is not implemented in the TS entrypoint shell yet.`,
          {
            command,
            migration_phase: 'task-1.2-entrypoint-shell',
            accepted_passthrough_args: args.passthroughArgs,
          },
          'Use the installed pricing-procedure runtime for this workflow.',
        ),
      ],
      status: 'unsupported',
      source_files: [],
      started_at: startedAt,
      selector_input: { fail_on: args.failOn },
      partial_reason: 'workflow not yet implemented in TS shell',
    },
  );
}

// ---------------------------------------------------------------------------
// Top-level routing
// ---------------------------------------------------------------------------

type ParsedTopLevel =
  | { kind: 'help'; output: string; exitCode: number; stream: 'stdout' | 'stderr' }
  | { kind: 'command'; command: CommandName; rest: string[] };

function isCommandName(value: string): value is CommandName {
  return (ALL_COMMANDS as readonly string[]).includes(value);
}

function topLevelHelp(modules: CommandModule[]): string {
  const nameToHelp = new Map<CommandName, string>(modules.map((m) => [m.name, m.help]));
  const commandLines = ALL_COMMANDS.map(
    (command) => `  ${command.padEnd(13)} ${nameToHelp.get(command) ?? ''}`,
  );

  return [
    TOP_LEVEL_DESCRIPTION,
    '',
    'Usage:',
    '  pricing-procedure <command> [options]',
    '  pricing-procedure help [command]',
    '',
    'Commands:',
    ...commandLines,
    '',
    TOP_LEVEL_EPILOG,
  ].join('\n');
}

function parseTopLevel(argv: string[], modules: CommandModule[]): ParsedTopLevel {
  if (argv.length === 0 || argv[0] === '--help' || argv[0] === '-h') {
    return { kind: 'help', output: topLevelHelp(modules), exitCode: 0, stream: 'stdout' };
  }

  if (argv[0] === 'help') {
    if (argv.length === 1) {
      return { kind: 'help', output: topLevelHelp(modules), exitCode: 0, stream: 'stdout' };
    }
    if (argv.length === 2 && isCommandName(argv[1])) {
      const mod = modules.find((m) => m.name === argv[1]);
      const helpText = mod?.helpText ?? `No help available for: ${argv[1]}`;
      return { kind: 'help', output: helpText, exitCode: 0, stream: 'stdout' };
    }
    if (argv.length === 2) {
      return {
        kind: 'help',
        output: `Unknown subcommand for help: ${argv[1]}`,
        exitCode: 2,
        stream: 'stderr',
      };
    }
    return {
      kind: 'help',
      output: 'help alias accepts at most one subcommand name.',
      exitCode: 2,
      stream: 'stderr',
    };
  }

  const [candidate, ...rest] = argv;
  if (!isCommandName(candidate)) {
    return {
      kind: 'help',
      output: `Unknown command: ${candidate}`,
      exitCode: 2,
      stream: 'stderr',
    };
  }

  if (rest.includes('--help') || rest.includes('-h')) {
    const mod = modules.find((m) => m.name === candidate);
    const helpText = mod?.helpText ?? `No help available for: ${candidate}`;
    return { kind: 'help', output: helpText, exitCode: 0, stream: 'stdout' };
  }

  return { kind: 'command', command: candidate, rest };
}

// ---------------------------------------------------------------------------
// Main dispatch entry point
// ---------------------------------------------------------------------------

/**
 * Run the pricing-procedure CLI with the given command modules.
 *
 * Returns an exit code (0, 1, or 2); the caller is responsible for calling
 * process.exit().
 */
export function runDispatch(
  modules: CommandModule[],
  argv: string[] = process.argv.slice(2),
): number {
  const parsedTopLevel = parseTopLevel(argv, modules);
  if (parsedTopLevel.kind === 'help') {
    emit(parsedTopLevel.stream, parsedTopLevel.output);
    return parsedTopLevel.exitCode;
  }

  const startedAt = Date.now();

  try {
    const mod = modules.find((m) => m.name === parsedTopLevel.command);

    if (!mod) {
      // Safety net: command is in ALL_COMMANDS but not registered as a module.
      const args = parseUnsupportedArgs(parsedTopLevel.command, parsedTopLevel.rest);
      const envelope = buildUnsupportedEnvelope(parsedTopLevel.command, args, startedAt);
      emit('stdout', renderEnvelope(envelope, args.json));
      return exitCodeForStatus(envelope.status, args.failOn, parsedTopLevel.command);
    }

    const args = mod.parseArgs(parsedTopLevel.rest);
    const envelope = mod.run(args, startedAt);
    emit('stdout', renderEnvelope(envelope, args.json));
    return exitCodeForStatus(envelope.status, args.failOn, parsedTopLevel.command);
  } catch (error) {
    const cliError =
      error instanceof PricingCliError
        ? error
        : new PricingCliError(
            'internal_contract_error',
            error instanceof Error ? error.message : 'Unknown CLI failure.',
            {},
            'Inspect the TS entrypoint shell and shared contracts layer before trusting this result.',
          );

    // Find source files for the error envelope.
    const mod = modules.find((m) => m.name === parsedTopLevel.command);
    const sourceFiles = mod ? mod.sourceFiles(parsedTopLevel.rest) : [];

    const envelope = makeEnvelope(
      parsedTopLevel.command,
      makeSummary('cli', cliError.message, {}, 'discover'),
      {},
      {
        errors: [cliError.toErrorObject()],
        status: 'error',
        source_files: sourceFiles,
        started_at: startedAt,
      },
    );

    const shouldRenderJson = parsedTopLevel.rest.includes('--json');
    emit(shouldRenderJson ? 'stdout' : 'stderr', renderEnvelope(envelope, shouldRenderJson));
    return 2;
  }
}
