import { formatJson, shouldFailOnStatus, STATUS_PRECEDENCE, type FailOn, type Status } from '@sdlc/rca-cli-core';

import type { CommandFlagDefinition, CommandListing } from './registry';
import { COMMAND_REGISTRY, listCommands } from './registry';
import { executeDoctorSfCli } from './commands/doctor';
import { executeProjectInventory } from './commands/discover/project-inventory';
import { executeOrgBaseline, type OrgBaselineCommandRunner } from './commands/discover/org-baseline';
import { executeEvidenceShow } from './commands/evidence/show';
import { executeDiscoveryBrief } from './commands/synth/discovery-brief';
import { createDiscoveryCommandMeta, createDiscoveryEnvelope } from './runtime/envelope';
import { commandToSlug } from './runtime/ids';
import { resolveSfxArtifactRoot, resolveSfxProjectRoot } from './runtime/artifacts';
import { LocalFileRunManager } from './runtime/run-manager';

export interface CliIo {
  stdout: { write(message: string): void };
  stderr: { write(message: string): void };
  cwd: string;
}

interface ParsedGlobalFlags {
  help: boolean;
  json: boolean;
  format?: string;
  projectRoot?: string;
  artifactRoot?: string;
  appendRunId?: string;
  newRun: boolean;
  failOn?: FailOn;
  error?: string;
  remaining: string[];
}

interface RegisteredCommandMatch {
  entry: CommandListing;
  commandArgv: string[];
  commandStartIndex: number;
  commandEndIndex: number;
}

interface CommandFamilyMatch {
  family: string;
  commands: CommandListing[];
}

interface ParsedCommandInvocation {
  help: boolean;
  json: boolean;
  format?: string;
  runId?: string;
  appendRunId?: string;
  newRun: boolean;
  failOn?: FailOn;
  inputs: Record<string, unknown>;
  errors: string[];
}

export interface CliRuntimeDependencies {
  orgBaselineRunner?: OrgBaselineCommandRunner;
}

function readRequiredFlagValue(argv: readonly string[], index: number, flagName: string): string {
  const value = argv[index + 1];
  if (!value || value.startsWith('-')) {
    throw new Error(`ERROR: ${flagName} requires a value`);
  }

  return value;
}

function isStatus(value: string): value is Status {
  return (STATUS_PRECEDENCE as readonly string[]).includes(value);
}

function validateFlagValue(flag: CommandFlagDefinition, value: string): string | undefined {
  if (flag.value_type === 'enum' && flag.enum && !flag.enum.includes(value)) {
    return `ERROR: ${flag.name} must be one of: ${flag.enum.join(', ')}`;
  }

  if (flag.value_type === 'integer' && !/^\d+$/.test(value)) {
    return `ERROR: ${flag.name} must be an integer`;
  }

  return undefined;
}

function parseGlobalFlags(argv: readonly string[]): ParsedGlobalFlags {
  const remaining: string[] = [];
  let help = false;
  let json = false;
  let format: string | undefined;
  let projectRoot: string | undefined;
  let artifactRoot: string | undefined;
  let appendRunId: string | undefined;
  let newRun = false;
  let failOn: FailOn | undefined;

  try {
    for (let index = 0; index < argv.length; index += 1) {
      const token = argv[index];

      if (token === '--help' || token === '-h') {
        help = true;
        continue;
      }

      if (token === '--json') {
        json = true;
        continue;
      }

      if (token === '--new-run') {
        newRun = true;
        continue;
      }

      if (token === '--project-root') {
        projectRoot = readRequiredFlagValue(argv, index, '--project-root');
        index += 1;
        continue;
      }

      if (token === '--artifact-root') {
        artifactRoot = readRequiredFlagValue(argv, index, '--artifact-root');
        index += 1;
        continue;
      }

      if (token === '--format') {
        format = readRequiredFlagValue(argv, index, '--format');
        index += 1;
        continue;
      }

      if (token === '--append-run-id') {
        appendRunId = readRequiredFlagValue(argv, index, '--append-run-id');
        index += 1;
        continue;
      }

      if (token === '--fail-on') {
        const value = readRequiredFlagValue(argv, index, '--fail-on');
        if (!isStatus(value)) {
          throw new Error(`ERROR: --fail-on must be one of: ${STATUS_PRECEDENCE.join(', ')}`);
        }

        failOn = value;
        index += 1;
        continue;
      }

      remaining.push(token);
    }
  } catch (error) {
    return {
      help,
      json,
      format,
      appendRunId,
      newRun,
      failOn,
      error: error instanceof Error ? error.message : 'ERROR: failed to parse global flags',
      remaining,
    };
  }

  return { help, json, format, projectRoot, artifactRoot, appendRunId, newRun, failOn, remaining };
}

function getCommandArgv(command: string): string[] {
  return command.split(' ').slice(1);
}

function getCommandFamily(entry: CommandListing): string {
  return getCommandArgv(entry.command)[0] ?? '';
}

function findRegisteredCommand(argv: readonly string[]): RegisteredCommandMatch | undefined {
  const entries = [...COMMAND_REGISTRY].sort(
    (left, right) => getCommandArgv(right.command).length - getCommandArgv(left.command).length,
  );

  for (const entry of entries) {
    const commandArgv = getCommandArgv(entry.command);
    for (let startIndex = 0; startIndex <= argv.length - commandArgv.length; startIndex += 1) {
      const matches = commandArgv.every((token, offset) => argv[startIndex + offset] === token);
      if (!matches) {
        continue;
      }

      return {
        entry,
        commandArgv,
        commandStartIndex: startIndex,
        commandEndIndex: startIndex + commandArgv.length,
      };
    }
  }

  return undefined;
}

function getResidualArgv(argv: readonly string[], match: RegisteredCommandMatch): string[] {
  return [...argv.slice(0, match.commandStartIndex), ...argv.slice(match.commandEndIndex)];
}

function findCommandFamily(argv: readonly string[]): CommandFamilyMatch | undefined {
  const familyToken = argv.find((token) => !token.startsWith('-'));
  if (!familyToken) {
    return undefined;
  }

  const commands = COMMAND_REGISTRY.filter((entry) => getCommandFamily(entry) === familyToken);
  if (commands.length === 0) {
    return undefined;
  }

  return { family: familyToken, commands };
}

function flagRequiresValue(flag: CommandFlagDefinition): boolean {
  return flag.value_type !== 'boolean';
}

function parseRegisteredCommandInvocation(
  entry: CommandListing,
  argv: readonly string[],
  options: { helpRequested?: boolean } = {},
): ParsedCommandInvocation {
  const knownFlags = new Map(entry.flags.map((flag) => [flag.name, flag]));
  const inputs: Record<string, unknown> = {};
  const errors: string[] = [];
  let help = false;
  let json = false;
  let format: string | undefined;
  let runId: string | undefined;
  let appendRunId: string | undefined;
  let newRun = false;
  let failOn: FailOn | undefined;

  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (!token.startsWith('-')) {
      errors.push(`ERROR: ${entry.command} does not accept positional arguments: ${argv.slice(index).join(' ')}`);
      break;
    }

    const flag = knownFlags.get(token);
    if (!flag) {
      errors.push(`ERROR: unknown flag: ${token}`);
      continue;
    }

    if (flagRequiresValue(flag)) {
      const value = argv[index + 1];
      if (!value || value.startsWith('-')) {
        errors.push(`ERROR: ${token} requires a value`);
        continue;
      }

      const validationError = validateFlagValue(flag, value);
      if (validationError) {
        errors.push(validationError);
        index += 1;
        continue;
      }

      inputs[flag.name.slice(2).replace(/-/g, '_')] = value;
      if (flag.name === '--format') {
        format = value;
      }
      if (flag.name === '--run-id') {
        runId = value;
      }
      if (flag.name === '--append-run-id') {
        appendRunId = value;
        inputs.append_run_id = value;
      }
      if (flag.name === '--fail-on' && isStatus(value)) {
        failOn = value;
      }
      index += 1;
      continue;
    }

    inputs[flag.name.slice(2).replace(/-/g, '_')] = true;
    if (flag.name === '--json') {
      json = true;
      format = 'json';
    }
    if (flag.name === '--new-run') {
      newRun = true;
    }
    if (flag.name === '--help') {
      help = true;
    }
  }

  if (!(help || options.helpRequested)) {
    for (const flag of entry.flags) {
      if (!flag.required) {
        continue;
      }

      const key = flag.name.slice(2).replace(/-/g, '_');
      if (!(key in inputs)) {
        errors.push(`ERROR: ${entry.command} requires ${flag.name}`);
      }
    }
  }

  return { help, json, format, runId, appendRunId, newRun, failOn, inputs, errors };
}

function formatFlagUsage(flag: CommandFlagDefinition): string {
  if (flag.value_type === 'boolean') {
    return flag.name;
  }

  if (flag.name === '--append-run-id' || flag.name === '--run-id') {
    return `${flag.name} <run_id>`;
  }

  if (flag.name === '--evidence-id') {
    return `${flag.name} <evidence_id>`;
  }

  if (flag.name === '--repo') {
    return `${flag.name} <path>`;
  }

  if (flag.name === '--org') {
    return `${flag.name} <org_alias>`;
  }

  if (flag.name === '--fail-on') {
    return `${flag.name} <status>`;
  }

  if (flag.value_type === 'enum' && flag.enum && flag.enum.length > 0) {
    return `${flag.name} <${flag.enum.join('|')}>`;
  }

  return `${flag.name} <value>`;
}

function formatFlagDetails(flag: CommandFlagDefinition): string {
  const extras: string[] = [];

  if (flag.required) {
    extras.push('required');
  }

  if (flag.default !== undefined) {
    extras.push(`default: ${String(flag.default)}`);
  }

  if (flag.value_type === 'enum' && flag.enum && flag.enum.length > 0) {
    extras.push(`values: ${flag.enum.join(', ')}`);
  }

  return extras.length > 0 ? `${flag.description} (${extras.join('; ')})` : flag.description;
}

function renderCommandSummary(entry: CommandListing): string {
  const synopsisFlags = entry.flags
    .filter((flag) => flag.name !== '--help')
    .map((flag) => (flag.required ? formatFlagUsage(flag) : `[${formatFlagUsage(flag)}]`))
    .join(' ');

  return synopsisFlags.length > 0 ? `${entry.command} ${synopsisFlags}` : entry.command;
}

function renderRootHelp(): string {
  const commands = listCommands();
  const globalFlags = commands.find((entry) => entry.command === 'sfx commands')?.flags ?? [];

  return [
    'Usage: sfx <command> [options]',
    '',
    'Registered commands:',
    ...commands.map((entry) => `  ${entry.command.slice('sfx '.length)}${entry.availability === 'unsupported' ? ' [registered, unimplemented]' : ''}`),
    '',
    'Command surface:',
    ...commands.map((entry) => `  ${renderCommandSummary(entry).slice('sfx '.length)}`),
    '',
    'Global flags:',
    ...globalFlags.map((flag) => `  ${formatFlagUsage(flag)}`),
    '',
    'Help:',
    '  sfx --help',
    '  sfx <family> --help',
    '  sfx <command> --help',
    '',
    'Notes:',
    '  Live execution currently supports the JSON envelope surface only.',
    '  Use "sfx commands --json" for machine-readable command discovery.',
    '',
  ].join('\n');
}

function renderFamilyHelp(family: string, commands: readonly CommandListing[]): string {
  return [
    `Usage: sfx ${family} <subcommand> [options]`,
    '',
    'Registered subcommands:',
    ...commands.map((entry) => `  ${entry.command.slice(`sfx ${family} `.length)}${entry.availability === 'unsupported' ? ' [registered, unimplemented]' : ''}`),
    '',
    'Command surface:',
    ...commands.map((entry) => `  ${renderCommandSummary(entry)}`),
    '',
    'Help:',
    `  sfx ${family} --help`,
    ...commands.map((entry) => `  ${entry.command} --help`),
    '',
    'Notes:',
    '  Live execution currently supports the JSON envelope surface only.',
    '  Use "sfx commands --json" for machine-readable command discovery.',
    '',
  ].join('\n');
}

function renderCommandHelp(entry: CommandListing): string {
  const example = `${entry.command}${entry.required_inputs.length === 0 ? ' --json' : ` ${entry.flags
    .filter((flag) => flag.required)
    .map((flag) => {
      if (flag.name === '--repo') {
        return '--repo <path>';
      }
      if (flag.name === '--org') {
        return '--org <alias>';
      }
      if (flag.name === '--run-id') {
        return '--run-id <run_id>';
      }
      if (flag.name === '--evidence-id') {
        return '--evidence-id <evidence_id>';
      }
      return formatFlagUsage(flag);
    })
    .join(' ')} --json`}`;

  return [
    `Usage: ${renderCommandSummary(entry)}`,
    '',
    `Availability: ${entry.availability}`,
    `Purpose: ${entry.purpose}`,
    `Supported formats: ${entry.supported_formats.join(', ')}`,
    `Canonical example: ${example}`,
    'Run behavior: creates a new run by default; use --append-run-id to append or --new-run to force a fresh run.',
    '',
    'Required inputs:',
    ...(entry.required_inputs.length > 0
      ? entry.required_inputs.map((input) => `  ${input.name} (${input.value_type}) - ${input.description}`)
      : ['  none']),
    '',
    'Flags:',
    ...entry.flags.map((flag) => `  ${formatFlagUsage(flag)}\n    ${formatFlagDetails(flag)}`),
    '',
    'Produced artifacts:',
    ...(entry.produced_artifacts.length > 0 ? entry.produced_artifacts.map((artifact) => `  ${artifact}`) : ['  none']),
    '',
    'Recommended next commands:',
    ...(entry.recommended_next_commands.length > 0
      ? entry.recommended_next_commands.map((command) => `  ${command}`)
      : ['  none']),
    '',
  ].join('\n');
}

function resolveExitCode(status: Status, failOn?: FailOn): number {
  if (!failOn) {
    return 0;
  }

  return shouldFailOnStatus(status, failOn) ? 1 : 0;
}

function hasExplicitJsonFormatConflict(argv: readonly string[]): boolean {
  let sawJson = false;
  let sawNonJsonFormat = false;

  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (token === '--json') {
      sawJson = true;
      continue;
    }

    if (token !== '--format') {
      continue;
    }

    const value = argv[index + 1];
    if (!value || value.startsWith('-')) {
      continue;
    }

    if (value !== 'json') {
      sawNonJsonFormat = true;
    }

    index += 1;
  }

  return sawJson && sawNonJsonFormat;
}

function resolveRequestedFormat(flags: ParsedGlobalFlags, parsedInvocation?: ParsedCommandInvocation): string | undefined {
  if (flags.json || parsedInvocation?.json) {
    return 'json';
  }

  return parsedInvocation?.format ?? flags.format;
}

function validateRegisteredCommandFormat(
  entry: CommandListing,
  flags: ParsedGlobalFlags,
  parsedInvocation?: ParsedCommandInvocation,
): string | undefined {
  const requestedFormat = resolveRequestedFormat(flags, parsedInvocation);

  if (entry.availability === 'unsupported' && !(flags.json || parsedInvocation?.json) && (!requestedFormat || requestedFormat === 'json')) {
    return `ERROR: ${entry.command} currently requires --json`;
  }

  if (!requestedFormat) {
    return undefined;
  }

  if (entry.supported_formats.includes(requestedFormat)) {
    return undefined;
  }

  return `ERROR: ${entry.command} does not support --format ${requestedFormat}; supported formats: ${entry.supported_formats.join(', ')}`;
}

function createLifecycleInputs(flags: ParsedGlobalFlags): Record<string, unknown> {
  return {
    ...(flags.projectRoot ? { project_root: flags.projectRoot } : {}),
    ...(flags.artifactRoot ? { artifact_root: flags.artifactRoot } : {}),
    ...(flags.appendRunId ? { append_run_id: flags.appendRunId } : {}),
    ...(flags.newRun ? { new_run: true } : {}),
    ...(flags.failOn ? { fail_on: flags.failOn } : {}),
  };
}

function resolveCliRoots(io: CliIo, flags: ParsedGlobalFlags): { projectRoot: string; artifactRoot: string } {
  const projectRoot = resolveSfxProjectRoot(io.cwd, flags.projectRoot);
  return {
    projectRoot,
    artifactRoot: resolveSfxArtifactRoot(projectRoot, flags.artifactRoot),
  };
}

function createRecordedInputs(
  commandInputs: Record<string, unknown>,
  flags: ParsedGlobalFlags,
): Record<string, unknown> {
  return {
    ...commandInputs,
    ...createLifecycleInputs(flags),
  };
}

function findUnexpectedHelpToken(argv: readonly string[], allowedPositionals: readonly string[]): string | undefined {
  return argv.find((token) => !allowedPositionals.includes(token) && token !== '--help' && token !== '-h');
}

function findUnexpectedRootToken(argv: readonly string[]): string | undefined {
  return argv.find((token) => token.startsWith('-'));
}

function createCommandsEnvelope(io: CliIo, flags: ParsedGlobalFlags): { envelopeText: string; status: Status } {
  const command = 'sfx commands --json';
  const commandSlug = commandToSlug(command);
  const runManager = new LocalFileRunManager();
  const roots = resolveCliRoots(io, flags);
  const prepared = runManager.prepareCommandExecution({
    repoRoot: roots.projectRoot,
    artifactRoot: roots.artifactRoot,
    command,
    commandSlug,
    inputs: { format: 'json' },
    runId: flags.appendRunId,
    newRun: flags.newRun,
    outputFormat: 'json',
  });

  const registry = listCommands();
  const meta = createDiscoveryCommandMeta({
    runId: prepared.runId,
    commandExecutionId: prepared.commandExecutionId,
    commandSlug,
    outputArtifactPaths: [prepared.outputArtifactRelativePath],
    evidenceArtifactPaths: [],
    logArtifactPath: prepared.logArtifactRelativePath,
    recommendedNextCommands: ['sfx doctor sf-cli --json'],
    stats: {
      command_count: registry.length,
      supported_command_count: registry.filter((entry) => entry.availability === 'supported').length,
      unsupported_command_count: registry.filter((entry) => entry.availability === 'unsupported').length,
    },
    effectiveFailOn: flags.failOn,
  });

  const envelope = createDiscoveryEnvelope({
    command,
    status: 'ok',
    summary: `Discovered ${registry.length} sfx commands in the registry.`,
    result: {
      commands: registry,
      families: ['doctor', 'discover', 'synth', 'evidence'],
      schema_version_supported: '1.0.0',
      default_format: 'json',
    },
    meta,
  });

  runManager.finalizeCommandExecution({
    prepared,
    status: envelope.status,
    envelope,
    logLines: [
      `command=${command}`,
      `run_id=${prepared.runId}`,
      `command_execution_id=${prepared.commandExecutionId}`,
      `command_count=${registry.length}`,
      `fail_on=${flags.failOn ?? 'default'}`,
    ],
    inputs: createRecordedInputs({ format: 'json' }, flags),
  });

  return { envelopeText: formatJson(envelope), status: envelope.status };
}

function executeUnsupportedCommand(
  io: CliIo,
  flags: ParsedGlobalFlags,
  knownCommand: CommandListing,
  invokedCommand: string,
  inputs: Record<string, unknown>,
): number {
  const runManager = new LocalFileRunManager();
  const commandSlug = commandToSlug(knownCommand.command);
  const roots = resolveCliRoots(io, flags);
  const prepared = runManager.prepareCommandExecution({
    repoRoot: roots.projectRoot,
    artifactRoot: roots.artifactRoot,
    command: invokedCommand,
    commandSlug,
    inputs,
    runId: flags.appendRunId,
    newRun: flags.newRun,
    outputFormat: 'json',
  });

  const summary = `${knownCommand.command} is registered but not implemented in this lane.`;
  const meta = createDiscoveryCommandMeta({
    runId: prepared.runId,
    commandExecutionId: prepared.commandExecutionId,
    commandSlug,
    outputArtifactPaths: [prepared.outputArtifactRelativePath],
    evidenceArtifactPaths: [],
    logArtifactPath: prepared.logArtifactRelativePath,
    recommendedNextCommands: ['sfx commands --json'],
    effectiveFailOn: flags.failOn,
  });

  const envelope = createDiscoveryEnvelope({
    command: invokedCommand,
    status: 'unsupported',
    summary,
    result: {
      implementation_status: 'registered_but_unimplemented',
      command: knownCommand.command,
      availability: knownCommand.availability,
      supported_formats: knownCommand.supported_formats,
      inputs,
    },
    meta,
  });

  runManager.finalizeCommandExecution({
    prepared,
    status: envelope.status,
    envelope,
    logLines: [
      `command=${invokedCommand}`,
      `run_id=${prepared.runId}`,
      `command_execution_id=${prepared.commandExecutionId}`,
      'status=unsupported',
      `fail_on=${flags.failOn ?? 'default'}`,
    ],
    inputs: createRecordedInputs(inputs, flags),
  });

  io.stdout.write(formatJson(envelope));

  return resolveExitCode(envelope.status, flags.failOn);
}

export async function runCli(argv: readonly string[], io: CliIo, dependencies: CliRuntimeDependencies = {}): Promise<number> {
  const matchedCommand = findRegisteredCommand(argv);
  const matchedFamily = matchedCommand ? undefined : findCommandFamily(argv);
  const residualArgv = matchedCommand ? getResidualArgv(argv, matchedCommand) : [...argv];
  const baseFlags = parseGlobalFlags(residualArgv);
  const parsedInvocation = matchedCommand
    ? parseRegisteredCommandInvocation(matchedCommand.entry, baseFlags.remaining, { helpRequested: baseFlags.help })
    : undefined;
  const flags: ParsedGlobalFlags = matchedCommand
    ? {
        help: baseFlags.help || (parsedInvocation?.help ?? false),
        json: baseFlags.json || (parsedInvocation?.json ?? false),
        format: parsedInvocation?.format ?? baseFlags.format,
        projectRoot: baseFlags.projectRoot,
        artifactRoot: baseFlags.artifactRoot,
        appendRunId: parsedInvocation?.appendRunId ?? baseFlags.appendRunId,
        newRun: baseFlags.newRun || (parsedInvocation?.newRun ?? false),
        failOn: parsedInvocation?.failOn ?? baseFlags.failOn,
        error: baseFlags.error,
        remaining: matchedCommand.commandArgv,
      }
    : baseFlags;

  if (flags.error) {
    io.stderr.write(`${flags.error}\n`);
    return 2;
  }

  if (flags.appendRunId && flags.newRun) {
    io.stderr.write('ERROR: --append-run-id conflicts with --new-run\n');
    return 2;
  }

  if (hasExplicitJsonFormatConflict(argv)) {
    io.stderr.write('ERROR: --json conflicts with --format when format is not json\n');
    return 2;
  }

  const format = resolveRequestedFormat(flags, parsedInvocation);

  if ((parsedInvocation?.errors.length ?? 0) > 0) {
    io.stderr.write(`${parsedInvocation?.errors[0]}\n`);
    return 2;
  }

  const unexpectedRootHelpToken = !matchedCommand && !matchedFamily && flags.help ? findUnexpectedHelpToken(baseFlags.remaining, []) : undefined;
  if (unexpectedRootHelpToken) {
    io.stderr.write(`${unexpectedRootHelpToken.startsWith('-') ? `ERROR: unknown flag: ${unexpectedRootHelpToken}` : `ERROR: unexpected positional argument: ${unexpectedRootHelpToken}`}\n`);
    return 2;
  }

  const unexpectedFamilyHelpToken = matchedFamily && flags.help
    ? findUnexpectedHelpToken(baseFlags.remaining, [matchedFamily.family])
    : undefined;
  if (unexpectedFamilyHelpToken) {
    io.stderr.write(`${unexpectedFamilyHelpToken.startsWith('-') ? `ERROR: unknown flag: ${unexpectedFamilyHelpToken}` : `ERROR: unexpected positional argument: ${unexpectedFamilyHelpToken}`}\n`);
    return 2;
  }

  if (flags.help && matchedCommand) {
    io.stdout.write(renderCommandHelp(matchedCommand.entry));
    return 0;
  }

  if (flags.help && matchedFamily) {
    io.stdout.write(renderFamilyHelp(matchedFamily.family, matchedFamily.commands));
    return 0;
  }

  const unexpectedRootToken = !matchedCommand && !matchedFamily ? findUnexpectedRootToken(baseFlags.remaining) : undefined;
  if (unexpectedRootToken) {
    io.stderr.write(`ERROR: unknown flag: ${unexpectedRootToken}\n`);
    return 2;
  }

  if (flags.help || flags.remaining.length === 0) {
    io.stdout.write(renderRootHelp());
    return 0;
  }

  const roots = resolveCliRoots(io, flags);

  if (matchedCommand) {

    const formatError = validateRegisteredCommandFormat(matchedCommand.entry, flags, parsedInvocation);
    if (formatError) {
      io.stderr.write(`${formatError}\n`);
      return 2;
    }
  }

  if (matchedCommand?.entry.command === 'sfx commands') {

    try {
      const executed = createCommandsEnvelope(io, flags);
      io.stdout.write(executed.envelopeText);
      return resolveExitCode(executed.status, flags.failOn);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'ERROR: failed to execute sfx commands';
      io.stderr.write(`${message}\n`);
      return 2;
    }
  }

  if (matchedCommand?.entry.command === 'sfx doctor sf-cli') {
    try {
      const executed = executeDoctorSfCli({
        repoRoot: roots.projectRoot,
        artifactRoot: roots.artifactRoot,
        appendRunId: flags.appendRunId,
        newRun: flags.newRun,
        failOn: flags.failOn,
      });
      io.stdout.write(formatJson(executed.envelope));
      return resolveExitCode(executed.envelope.status, flags.failOn);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'ERROR: failed to execute sfx doctor sf-cli';
      io.stderr.write(`${message}\n`);
      return 2;
    }
  }

  if (matchedCommand?.entry.command === 'sfx discover project-inventory') {
    try {
      const commandInvocation = parsedInvocation ?? parseRegisteredCommandInvocation(matchedCommand.entry, baseFlags.remaining);
      if (commandInvocation.errors.length > 0) {
        io.stderr.write(`${commandInvocation.errors[0]}\n`);
        return 2;
      }

      const executed = executeProjectInventory({
        repoRoot: roots.projectRoot,
        artifactRoot: roots.artifactRoot,
        repo: String(commandInvocation.inputs.repo),
        detail: commandInvocation.inputs.detail as 'low' | 'standard' | 'deep' | undefined,
        appendRunId: flags.appendRunId,
        newRun: flags.newRun,
        failOn: flags.failOn,
      });
      io.stdout.write(formatJson(executed.envelope));
      return resolveExitCode(executed.envelope.status, flags.failOn);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'ERROR: failed to execute sfx discover project-inventory';
      io.stderr.write(`${message}\n`);
      return 2;
    }
  }

  if (matchedCommand?.entry.command === 'sfx discover org-baseline') {
    try {
      const commandInvocation = parsedInvocation ?? parseRegisteredCommandInvocation(matchedCommand.entry, baseFlags.remaining);
      if (commandInvocation.errors.length > 0) {
        io.stderr.write(`${commandInvocation.errors[0]}\n`);
        return 2;
      }

      const executed = await executeOrgBaseline({
        repoRoot: roots.projectRoot,
        artifactRoot: roots.artifactRoot,
        org: String(commandInvocation.inputs.org),
        detail: commandInvocation.inputs.detail as 'low' | 'standard' | 'deep' | undefined,
        appendRunId: flags.appendRunId,
        newRun: flags.newRun,
        failOn: flags.failOn,
        runner: dependencies.orgBaselineRunner,
      });
      io.stdout.write(formatJson(executed.envelope));
      return resolveExitCode(executed.envelope.status, flags.failOn);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'ERROR: failed to execute sfx discover org-baseline';
      io.stderr.write(`${message}\n`);
      return 2;
    }
  }

  if (matchedCommand?.entry.command === 'sfx synth discovery-brief') {
    try {
      const commandInvocation = parsedInvocation ?? parseRegisteredCommandInvocation(matchedCommand.entry, baseFlags.remaining);
      if (commandInvocation.errors.length > 0) {
        io.stderr.write(`${commandInvocation.errors[0]}\n`);
        return 2;
      }

      const executed = executeDiscoveryBrief({
        repoRoot: roots.projectRoot,
        artifactRoot: roots.artifactRoot,
        runId: String(commandInvocation.inputs.run_id),
        appendRunId: flags.appendRunId,
        newRun: flags.newRun,
        failOn: flags.failOn,
      });
      io.stdout.write(formatJson(executed.envelope));
      return resolveExitCode(executed.envelope.status, flags.failOn);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'ERROR: failed to execute sfx synth discovery-brief';
      io.stderr.write(`${message}\n`);
      return 2;
    }
  }

  if (matchedCommand?.entry.command === 'sfx evidence show') {
    try {
      const commandInvocation = parsedInvocation ?? parseRegisteredCommandInvocation(matchedCommand.entry, baseFlags.remaining);
      if (commandInvocation.errors.length > 0) {
        io.stderr.write(`${commandInvocation.errors[0]}\n`);
        return 2;
      }

      const executed = executeEvidenceShow({
        repoRoot: roots.projectRoot,
        artifactRoot: roots.artifactRoot,
        runId: String(commandInvocation.inputs.run_id),
        evidenceId: String(commandInvocation.inputs.evidence_id),
        appendRunId: flags.appendRunId,
        newRun: flags.newRun,
        failOn: flags.failOn,
      });
      io.stdout.write(formatJson(executed.envelope));
      return resolveExitCode(executed.envelope.status, flags.failOn);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'ERROR: failed to execute sfx evidence show';
      io.stderr.write(`${message}\n`);
      return 2;
    }
  }

  const invokedCommand = matchedCommand ? `sfx ${argv.join(' ')}` : `sfx ${flags.remaining.join(' ')}`;
  const knownCommand = matchedCommand?.entry;

  if (knownCommand) {
    const commandInvocation = parsedInvocation ?? parseRegisteredCommandInvocation(knownCommand, baseFlags.remaining);
    if (commandInvocation.errors.length > 0) {
      io.stderr.write(`${commandInvocation.errors[0]}\n`);
      return 2;
    }

    if (knownCommand.availability === 'unsupported') {
      try {
        return executeUnsupportedCommand(io, flags, knownCommand, invokedCommand, commandInvocation.inputs);
      } catch (error) {
        const message = error instanceof Error ? error.message : 'ERROR: failed to execute unsupported command handler';
        io.stderr.write(`${message}\n`);
        return 2;
      }
    }
  }

  io.stderr.write(`ERROR: unknown command: ${invokedCommand}\n`);
  return 2;
}
