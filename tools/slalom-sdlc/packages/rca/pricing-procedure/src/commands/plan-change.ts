import { FAIL_CHOICES, FAIL_DEFAULTS } from '../lib/contracts/constants';
import type { FailChoice } from '../lib/contracts/constants';
import { PricingCliError } from '../lib/contracts/errors';
import { runPlanChange, type PlanChangeArgs } from '../lib/plan_change';
import type { CommandModule, MinCommandArgs } from '../cli/dispatch';

const HELP =
  'Plan likely edit surfaces, compact inspection order, downstream impacts, and validation targets.';

const DESCRIPTION =
  'Answer: what are the likely primary edit surfaces, compact inspection order, and downstream validation targets?';

const EPILOG =
  'Workflow example: plan-change --version active --tag NetUnitPrice --context <context-file> --object QuoteLineItem to rank final-calculation surfaces ahead of waterfall exposure review and downstream validation. Defaults to all matched versions. Use --version active for most workflow questions when you want one edit target instead of cross-version aggregation.';

function versionScopeHelpText(defaultAllVersions = true): string {
  const defaultNote = defaultAllVersions
    ? 'Defaults to all matched versions.'
    : 'Defaults to the active version when available.';
  return `${defaultNote} Use --version active for most workflow questions when you want one edit target instead of cross-version aggregation.`;
}

const HELP_TEXT = [
  DESCRIPTION,
  '',
  'Usage:',
  '  pricing-procedure plan-change --file <path> (--tag <context-tag> | --step-name <name>) [options]',
  '',
  'Options:',
  '  --file <path>               Path to one pricing-procedure ExpressionSetDefinition file.',
  '  --tag <context-tag>         Requested context tag to plan around.',
  '  --step-name <name>          Exact step name to plan around when the change request is step-centered.',
  `  --version <selector>        Optional version selector: active, exact fullName, or rank:N. ${versionScopeHelpText()}`,
  '  --active-only               Shortcut for --version active when no explicit --version selector is supplied.',
  '  --context <path>            Optional ContextDefinition companion file for object-layer validation targets.',
  '  --object <name>             Optional object-layer target filter, such as Quote or QuoteLineItem.',
  '  --include-impacts           Include extra compact downstream impact rows such as formula-assignment touches.',
  '  --json                      Emit the canonical machine-readable JSON envelope.',
  `  --fail-on <value>           Exit threshold. Default: ${FAIL_DEFAULTS['plan-change']}.`,
  `                              Choices: ${FAIL_CHOICES.join(', ')}`,
  '',
  EPILOG,
].join('\n');

function parsePlanChangeArgs(argv: string[]): PlanChangeArgs {
  const parsed: PlanChangeArgs = {
    file: '',
    activeOnly: false,
    includeImpacts: false,
    json: false,
    failOn: FAIL_DEFAULTS['plan-change'],
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
    if (token === '--include-impacts') {
      parsed.includeImpacts = true;
      continue;
    }
    if (token === '--fail-on') {
      if (!next || next.startsWith('--')) {
        throw new PricingCliError('invalid_selector_format', 'plan-change requires a value for --fail-on when the flag is supplied.', { command: 'plan-change' }, `Use one of: ${FAIL_CHOICES.join(', ')}.`);
      }
      if (!(FAIL_CHOICES as readonly string[]).includes(next)) {
        throw new PricingCliError('invalid_selector_format', `Invalid --fail-on value: ${next}`, { command: 'plan-change', fail_on: next, allowed_values: FAIL_CHOICES }, `Use one of: ${FAIL_CHOICES.join(', ')}.`);
      }
      parsed.failOn = next as FailChoice;
      index += 1;
      continue;
    }
    if (token === '--file') {
      if (!next || next.startsWith('--')) {
        throw new PricingCliError('invalid_selector_format', 'plan-change requires a value for --file.', {}, 'Pass --file <path>.');
      }
      parsed.file = next;
      index += 1;
      continue;
    }
    if (token === '--tag') {
      if (!next || next.startsWith('--')) {
        throw new PricingCliError('invalid_selector_format', 'plan-change requires a value for --tag.', {}, 'Pass one exact context tag.');
      }
      parsed.tag = next;
      index += 1;
      continue;
    }
    if (token === '--step-name') {
      if (!next || next.startsWith('--')) {
        throw new PricingCliError('invalid_selector_format', 'plan-change requires a value for --step-name.', {}, 'Pass one exact step name.');
      }
      parsed.stepName = next;
      index += 1;
      continue;
    }
    if (token === '--version') {
      if (!next || next.startsWith('--')) {
        throw new PricingCliError('invalid_selector_format', 'plan-change requires a value for --version.', {}, 'Use one of: active, FULL_NAME, or rank:N.');
      }
      parsed.version = next;
      index += 1;
      continue;
    }
    if (token === '--context') {
      if (!next || next.startsWith('--')) {
        throw new PricingCliError('invalid_selector_format', 'plan-change requires a value for --context.', {}, 'Pass --context <path> when you want object-layer validation targets.');
      }
      parsed.context = next;
      index += 1;
      continue;
    }
    if (token === '--object') {
      if (!next || next.startsWith('--')) {
        throw new PricingCliError('invalid_selector_format', 'plan-change requires a value for --object.', {}, 'Pass one object-layer target name.');
      }
      parsed.object = next;
      index += 1;
      continue;
    }
    throw new PricingCliError('invalid_selector_format', `Unknown plan-change option: ${token}`, { token }, 'Use plan-change --help to review supported flags.');
  }

  if (!parsed.file) {
    throw new PricingCliError('invalid_selector_format', 'plan-change requires --file.', {}, 'Pass --file <path>.');
  }
  if ((parsed.tag ? 1 : 0) + (parsed.stepName ? 1 : 0) !== 1) {
    throw new PricingCliError(
      'invalid_selector_format',
      'plan-change requires exactly one of --tag or --step-name.',
      { tag: parsed.tag ?? null, step_name: parsed.stepName ?? null },
      'Pass either --tag <context-tag> or --step-name <name>.',
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

export const planChangeCommand: CommandModule = {
  name: 'plan-change',
  help: HELP,
  helpText: HELP_TEXT,
  parseArgs(argv): MinCommandArgs {
    return parsePlanChangeArgs(argv);
  },
  run(args: MinCommandArgs, startedAt): ReturnType<typeof runPlanChange> {
    return runPlanChange(args as PlanChangeArgs, startedAt);
  },
  sourceFiles,
};
