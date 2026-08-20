import { FAIL_CHOICES, FAIL_DEFAULTS } from '../lib/contracts/constants';
import type { FailChoice } from '../lib/contracts/constants';
import { PricingCliError } from '../lib/contracts/errors';
import { runDiscover, type DiscoverArgs } from '../lib/discover';
import type { CommandModule, MinCommandArgs } from '../cli/dispatch';

const HELP =
  'Discover expression-set candidates and classify pricing procedures.';

const DESCRIPTION =
  'Answer: is this file or repo subtree a pricing procedure, and what versions or step filters match?';

const EPILOG =
  'Use discover first when you are not sure whether the file is a pricing procedure. Next commands: summarize, inspect-step, or doctor.';

const HELP_TEXT = [
  DESCRIPTION,
  '',
  'Usage:',
  '  pricing-procedure discover (--file <path> | --repo <path>) [options]',
  '',
  'Options:',
  '  --file <path>               Path to one *.expressionSetDefinition-meta.xml file.',
  '  --repo <path>               Repo subtree to scan recursively for *.expressionSetDefinition-meta.xml files.',
  '  --interface-source-type <v> Optional exact interfaceSourceType filter applied after classification.',
  '  --version <selector>        Version selector: active, exact fullName, or rank:N.',
  '  --step-name <name>          Exact step name filter inside the selected version scope.',
  '  --action-type <type>        Exact actionType filter inside the selected version scope.',
  '  --sequence <value>          Exact sequenceNumber filter inside the selected version scope.',
  '  --json                      Emit the canonical machine-readable JSON envelope.',
  `  --fail-on <value>           Exit threshold hint. Default: ${FAIL_DEFAULTS.discover}.`,
  `                              Choices: ${FAIL_CHOICES.join(', ')}`,
  '',
  EPILOG,
].join('\n');

function parseDiscoverArgs(argv: string[]): DiscoverArgs {
  const parsed: DiscoverArgs = {
    json: false,
    failOn: FAIL_DEFAULTS.discover,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    const next = argv[index + 1];
    if (token === '--json') {
      parsed.json = true;
      continue;
    }
    if (token === '--fail-on') {
      if (!next || next.startsWith('--')) {
        throw new PricingCliError(
          'invalid_selector_format',
          'discover requires a value for --fail-on when the flag is supplied.',
          { command: 'discover' },
          `Use one of: ${FAIL_CHOICES.join(', ')}.`,
        );
      }
      if (!(FAIL_CHOICES as readonly string[]).includes(next)) {
        throw new PricingCliError(
          'invalid_selector_format',
          `Invalid --fail-on value: ${next}`,
          { command: 'discover', fail_on: next, allowed_values: FAIL_CHOICES },
          `Use one of: ${FAIL_CHOICES.join(', ')}.`,
        );
      }
      parsed.failOn = next as FailChoice;
      index += 1;
      continue;
    }
    if (token === '--file') {
      if (!next || next.startsWith('--')) {
        throw new PricingCliError(
          'invalid_selector_format',
          'discover requires a value for --file.',
          {},
          'Pass --file <path> or use --repo <path>.',
        );
      }
      if (parsed.repo) {
        throw new PricingCliError(
          'invalid_selector_format',
          'discover accepts exactly one of --file or --repo.',
          { file: next, repo: parsed.repo },
          'Pass one input mode only.',
        );
      }
      parsed.file = next;
      index += 1;
      continue;
    }
    if (token === '--repo') {
      if (!next || next.startsWith('--')) {
        throw new PricingCliError(
          'invalid_selector_format',
          'discover requires a value for --repo.',
          {},
          'Pass --repo <path> or use --file <path>.',
        );
      }
      if (parsed.file) {
        throw new PricingCliError(
          'invalid_selector_format',
          'discover accepts exactly one of --file or --repo.',
          { file: parsed.file, repo: next },
          'Pass one input mode only.',
        );
      }
      parsed.repo = next;
      index += 1;
      continue;
    }
    if (token === '--interface-source-type') {
      if (!next || next.startsWith('--')) {
        throw new PricingCliError(
          'invalid_selector_format',
          'discover requires a value for --interface-source-type.',
          {},
          'Pass one exact interface source type.',
        );
      }
      parsed.interfaceSourceType = next;
      index += 1;
      continue;
    }
    if (token === '--version') {
      if (!next || next.startsWith('--')) {
        throw new PricingCliError(
          'invalid_selector_format',
          'discover requires a value for --version.',
          {},
          'Use one of: active, FULL_NAME, or rank:N.',
        );
      }
      parsed.version = next;
      index += 1;
      continue;
    }
    if (token === '--step-name') {
      if (!next || next.startsWith('--')) {
        throw new PricingCliError(
          'invalid_selector_format',
          'discover requires a value for --step-name.',
          {},
          'Pass one exact step name.',
        );
      }
      parsed.stepName = next;
      index += 1;
      continue;
    }
    if (token === '--action-type') {
      if (!next || next.startsWith('--')) {
        throw new PricingCliError(
          'invalid_selector_format',
          'discover requires a value for --action-type.',
          {},
          'Pass one exact action type.',
        );
      }
      parsed.actionType = next;
      index += 1;
      continue;
    }
    if (token === '--sequence') {
      if (!next || next.startsWith('--')) {
        throw new PricingCliError(
          'invalid_selector_format',
          'discover requires a value for --sequence.',
          {},
          'Pass one exact sequence number.',
        );
      }
      parsed.sequence = next;
      index += 1;
      continue;
    }
    throw new PricingCliError(
      'invalid_selector_format',
      `Unknown discover option: ${token}`,
      { token },
      'Use discover --help to review supported flags.',
    );
  }

  if ((!parsed.file && !parsed.repo) || (parsed.file && parsed.repo)) {
    throw new PricingCliError(
      'invalid_selector_format',
      'discover requires exactly one of --file or --repo.',
      { file: parsed.file ?? null, repo: parsed.repo ?? null },
      'Pass one input mode only.',
    );
  }

  return parsed;
}

function sourceFiles(argv: string[]): string[] {
  const result: string[] = [];
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if ((token === '--file' || token === '--repo') && index + 1 < argv.length) {
      const next = argv[index + 1];
      if (next && !next.startsWith('--')) {
        result.push(next);
      }
    }
  }
  return result;
}

export const discoverCommand: CommandModule = {
  name: 'discover',
  help: HELP,
  helpText: HELP_TEXT,
  parseArgs(argv): MinCommandArgs {
    return parseDiscoverArgs(argv);
  },
  run(args: MinCommandArgs, startedAt): ReturnType<typeof runDiscover> {
    return runDiscover(args as DiscoverArgs, startedAt);
  },
  sourceFiles,
};
