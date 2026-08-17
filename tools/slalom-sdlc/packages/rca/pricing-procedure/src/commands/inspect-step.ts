import { FAIL_CHOICES, FAIL_DEFAULTS } from '../lib/contracts/constants';
import type { FailChoice } from '../lib/contracts/constants';
import { PricingCliError } from '../lib/contracts/errors';
import { runInspectStep, type InspectStepArgs } from '../lib/inspect_step';
import type { CommandModule, MinCommandArgs } from '../cli/dispatch';

const HELP =
  'Inspect exactly one step selector family and return matched step details.';

const DESCRIPTION =
  'Answer: what does one exact step instance contain in the selected version scope?';

const EPILOG =
  'Workflow examples: inspect-step --version active --step-name PricingSetting, or inspect-step --list-candidates --step-name-contains Subscription. Defaults to all matched versions unless you pass --version or --active-only. Use --version active for most workflow questions when you want one edit target instead of cross-version aggregation.';

const HELP_TEXT = [
  DESCRIPTION,
  '',
  'Usage:',
  '  pricing-procedure inspect-step --file <path> [options]',
  '',
  'Options:',
  '  --file <path>               Path to one pricing-procedure ExpressionSetDefinition file.',
  '  --version <selector>        Optional version selector: active, exact fullName, or rank:N. Defaults to all matched versions unless --active-only is set.',
  '  --active-only               Shortcut for --version active when no explicit --version selector is supplied.',
  '  --step-name <name>          Exact step name selector.',
  '  --sequence <value>          Exact sequenceNumber selector.',
  '  --action-type <type>        Exact actionType selector.',
  '  --parent-step <name>        Exact parentStep selector.',
  '  --list-candidates           List compact candidate step selectors instead of requiring an exact selector match.',
  '  --step-name-contains <text> Optional substring filter for --list-candidates candidate discovery.',
  '  --compact                   Return compact step summaries (default).',
  '  --verbose                   Include full parameter payloads for matched steps.',
  '  --json                      Emit the canonical machine-readable JSON envelope.',
  `  --fail-on <value>           Exit threshold. Default: ${FAIL_DEFAULTS['inspect-step']}.`,
  `                              Choices: ${FAIL_CHOICES.join(', ')}`,
  '',
  EPILOG,
].join('\n');

function parseInspectStepArgs(argv: string[]): InspectStepArgs {
  const parsed: InspectStepArgs = {
    file: '',
    json: false,
    failOn: FAIL_DEFAULTS['inspect-step'],
    activeOnly: false,
    listCandidates: false,
    compact: false,
    verbose: false,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    const next = argv[index + 1];
    if (token === '--json') {
      parsed.json = true;
      continue;
    }
    if (token === '--active-only') {
      parsed.activeOnly = true;
      continue;
    }
    if (token === '--list-candidates') {
      parsed.listCandidates = true;
      continue;
    }
    if (token === '--compact') {
      if (parsed.verbose) {
        throw new PricingCliError(
          'invalid_selector_format',
          'inspect-step accepts at most one verbosity flag.',
          { compact: true, verbose: true },
          'Use either --compact or --verbose.',
        );
      }
      parsed.compact = true;
      continue;
    }
    if (token === '--verbose') {
      if (parsed.compact) {
        throw new PricingCliError(
          'invalid_selector_format',
          'inspect-step accepts at most one verbosity flag.',
          { compact: true, verbose: true },
          'Use either --compact or --verbose.',
        );
      }
      parsed.verbose = true;
      continue;
    }
    if (token === '--fail-on') {
      if (!next || next.startsWith('--')) {
        throw new PricingCliError(
          'invalid_selector_format',
          'inspect-step requires a value for --fail-on when the flag is supplied.',
          { command: 'inspect-step' },
          `Use one of: ${FAIL_CHOICES.join(', ')}.`,
        );
      }
      if (!(FAIL_CHOICES as readonly string[]).includes(next)) {
        throw new PricingCliError(
          'invalid_selector_format',
          `Invalid --fail-on value: ${next}`,
          { command: 'inspect-step', fail_on: next, allowed_values: FAIL_CHOICES },
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
          'inspect-step requires a value for --file.',
          {},
          'Pass --file <path>.',
        );
      }
      parsed.file = next;
      index += 1;
      continue;
    }
    if (token === '--version') {
      if (!next || next.startsWith('--')) {
        throw new PricingCliError(
          'invalid_selector_format',
          'inspect-step requires a value for --version.',
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
          'inspect-step requires a value for --step-name.',
          {},
          'Pass one exact step name.',
        );
      }
      parsed.stepName = next;
      index += 1;
      continue;
    }
    if (token === '--sequence') {
      if (!next || next.startsWith('--')) {
        throw new PricingCliError(
          'invalid_selector_format',
          'inspect-step requires a value for --sequence.',
          {},
          'Pass one exact sequence number.',
        );
      }
      parsed.sequence = next;
      index += 1;
      continue;
    }
    if (token === '--action-type') {
      if (!next || next.startsWith('--')) {
        throw new PricingCliError(
          'invalid_selector_format',
          'inspect-step requires a value for --action-type.',
          {},
          'Pass one exact action type.',
        );
      }
      parsed.actionType = next;
      index += 1;
      continue;
    }
    if (token === '--parent-step') {
      if (!next || next.startsWith('--')) {
        throw new PricingCliError(
          'invalid_selector_format',
          'inspect-step requires a value for --parent-step.',
          {},
          'Pass one exact parent step name.',
        );
      }
      parsed.parentStep = next;
      index += 1;
      continue;
    }
    if (token === '--step-name-contains') {
      if (!next || next.startsWith('--')) {
        throw new PricingCliError(
          'invalid_selector_format',
          'inspect-step requires a value for --step-name-contains.',
          {},
          'Pass one substring when using --list-candidates.',
        );
      }
      parsed.stepNameContains = next;
      index += 1;
      continue;
    }
    throw new PricingCliError(
      'invalid_selector_format',
      `Unknown inspect-step option: ${token}`,
      { token },
      'Use inspect-step --help to review supported flags.',
    );
  }

  if (!parsed.file) {
    throw new PricingCliError(
      'invalid_selector_format',
      'inspect-step requires --file.',
      {},
      'Pass --file <path>.',
    );
  }

  if (parsed.stepNameContains && !parsed.listCandidates) {
    throw new PricingCliError(
      'invalid_selector_format',
      '--step-name-contains is supported only with --list-candidates.',
      { step_name_contains: parsed.stepNameContains },
      'Add --list-candidates, or use --step-name for an exact selector.',
    );
  }

  return parsed;
}

function sourceFiles(argv: string[]): string[] {
  const result: string[] = [];
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (token === '--file' && index + 1 < argv.length) {
      const next = argv[index + 1];
      if (next && !next.startsWith('--')) {
        result.push(next);
      }
    }
  }
  return result;
}

export const inspectStepCommand: CommandModule = {
  name: 'inspect-step',
  help: HELP,
  helpText: HELP_TEXT,
  parseArgs(argv): MinCommandArgs {
    return parseInspectStepArgs(argv);
  },
  run(args: MinCommandArgs, startedAt): ReturnType<typeof runInspectStep> {
    return runInspectStep(args as InspectStepArgs, startedAt);
  },
  sourceFiles,
};
