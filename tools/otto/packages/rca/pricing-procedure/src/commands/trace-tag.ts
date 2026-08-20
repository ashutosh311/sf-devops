import { FAIL_CHOICES, FAIL_DEFAULTS } from '../lib/contracts/constants';
import type { FailChoice } from '../lib/contracts/constants';
import { PricingCliError } from '../lib/contracts/errors';
import { runTraceTag, type TraceTagArgs } from '../lib/trace_tag';
import type { CommandModule, MinCommandArgs } from '../cli/dispatch';

const HELP =
  'Trace how one context tag flows through the pricing procedure.';

const DESCRIPTION =
  'Answer: which pricing-procedure elements read, write, transform, or carry forward this context tag?';

const EPILOG =
  'Workflow example: trace-tag --version active --tag NetUnitPrice to answer how NetUnitPrice gets calculated. Defaults to all matched versions. Use --version active for most workflow questions when you want one edit target instead of cross-version aggregation.';

const HELP_TEXT = [
  DESCRIPTION,
  '',
  'Usage:',
  '  pricing-procedure trace-tag --file <path> --tag <context-tag> [options]',
  '',
  'Options:',
  '  --file <path>                    Path to one pricing-procedure ExpressionSetDefinition file.',
  '  --tag <context-tag>             Requested context tag to trace through the pricing procedure.',
  '  --version <selector>            Optional version selector: active, exact fullName, or rank:N. Defaults to all matched versions.',
  '  --active-only                   Shortcut for --version active when no explicit --version selector is supplied.',
  '  --producer-only                 Return only producer/transformer-heavy waterfall elements.',
  '  --consumer-only                 Return only consumer/transformer-heavy waterfall elements.',
  '  --include-formulas              Deprecated alias for --include-formula-details.',
  '  --include-formula-details       Include full formula evidence arrays for matched elements that reference the requested context tag.',
  '  --include-all-elements          Include full producer_elements and consumer_elements evidence arrays in addition to compact key_elements.',
  '  --include-waterfall-slice       Include the full scoped waterfall_slice evidence array in addition to compact key_elements.',
  '  --include-related-tags          Expand related_context_tags from matched elements instead of only returning family aliases.',
  '  --include-context-hints         Include ambiguity-family and context-definition routing hints for the requested context tag.',
  '  --max-elements <count>          Maximum number of returned evidence elements to include before truncating deterministically.',
  '  --json                          Emit the canonical machine-readable JSON envelope.',
  `  --fail-on <value>               Exit threshold. Default: ${FAIL_DEFAULTS['trace-tag']}.`,
  `                                  Choices: ${FAIL_CHOICES.join(', ')}`,
  '',
  EPILOG,
].join('\n');

function parseTraceTagArgs(argv: string[]): TraceTagArgs {
  const parsed: TraceTagArgs = {
    file: '',
    tag: '',
    activeOnly: false,
    producerOnly: false,
    consumerOnly: false,
    includeFormulas: false,
    includeFormulaDetails: false,
    includeAllElements: false,
    includeWaterfallSlice: false,
    includeRelatedTags: false,
    includeContextHints: false,
    json: false,
    failOn: FAIL_DEFAULTS['trace-tag'],
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
    if (token === '--producer-only') {
      if (parsed.consumerOnly) {
        throw new PricingCliError(
          'invalid_selector_format',
          'trace-tag accepts at most one scope flag.',
          { producer_only: true, consumer_only: true },
          'Use either --producer-only or --consumer-only.',
        );
      }
      parsed.producerOnly = true;
      continue;
    }
    if (token === '--consumer-only') {
      if (parsed.producerOnly) {
        throw new PricingCliError(
          'invalid_selector_format',
          'trace-tag accepts at most one scope flag.',
          { producer_only: true, consumer_only: true },
          'Use either --producer-only or --consumer-only.',
        );
      }
      parsed.consumerOnly = true;
      continue;
    }
    if (token === '--include-formulas') {
      parsed.includeFormulas = true;
      continue;
    }
    if (token === '--include-formula-details') {
      parsed.includeFormulaDetails = true;
      continue;
    }
    if (token === '--include-all-elements') {
      parsed.includeAllElements = true;
      continue;
    }
    if (token === '--include-waterfall-slice') {
      parsed.includeWaterfallSlice = true;
      continue;
    }
    if (token === '--include-related-tags') {
      parsed.includeRelatedTags = true;
      continue;
    }
    if (token === '--include-context-hints') {
      parsed.includeContextHints = true;
      continue;
    }
    if (token === '--fail-on') {
      if (!next || next.startsWith('--')) {
        throw new PricingCliError(
          'invalid_selector_format',
          'trace-tag requires a value for --fail-on when the flag is supplied.',
          { command: 'trace-tag' },
          `Use one of: ${FAIL_CHOICES.join(', ')}.`,
        );
      }
      if (!(FAIL_CHOICES as readonly string[]).includes(next)) {
        throw new PricingCliError(
          'invalid_selector_format',
          `Invalid --fail-on value: ${next}`,
          { command: 'trace-tag', fail_on: next, allowed_values: FAIL_CHOICES },
          `Use one of: ${FAIL_CHOICES.join(', ')}.`,
        );
      }
      parsed.failOn = next as FailChoice;
      index += 1;
      continue;
    }
    if (token === '--file') {
      if (!next || next.startsWith('--')) {
        throw new PricingCliError('invalid_selector_format', 'trace-tag requires a value for --file.', {}, 'Pass --file <path>.');
      }
      parsed.file = next;
      index += 1;
      continue;
    }
    if (token === '--tag') {
      if (!next || next.startsWith('--')) {
        throw new PricingCliError('invalid_selector_format', 'trace-tag requires a value for --tag.', {}, 'Pass one context tag value.');
      }
      parsed.tag = next;
      index += 1;
      continue;
    }
    if (token === '--version') {
      if (!next || next.startsWith('--')) {
        throw new PricingCliError('invalid_selector_format', 'trace-tag requires a value for --version.', {}, 'Use one of: active, FULL_NAME, or rank:N.');
      }
      parsed.version = next;
      index += 1;
      continue;
    }
    if (token === '--max-elements') {
      if (!next || next.startsWith('--')) {
        throw new PricingCliError('invalid_selector_format', 'trace-tag requires a value for --max-elements.', {}, 'Pass a non-negative integer.');
      }
      if (!/^\d+$/.test(next)) {
        throw new PricingCliError('invalid_selector_format', 'trace-tag requires a non-negative integer for --max-elements.', { max_elements: next }, 'Pass a non-negative integer such as 5 or 20.');
      }
      parsed.maxElements = Number.parseInt(next, 10);
      index += 1;
      continue;
    }
    throw new PricingCliError(
      'invalid_selector_format',
      `Unknown trace-tag option: ${token}`,
      { token },
      'Use trace-tag --help to review supported flags.',
    );
  }

  if (!parsed.file) {
    throw new PricingCliError('invalid_selector_format', 'trace-tag requires --file.', {}, 'Pass --file <path>.');
  }
  if (!parsed.tag) {
    throw new PricingCliError('invalid_selector_format', 'trace-tag requires --tag.', {}, 'Pass --tag <context-tag>.');
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

export const traceTagCommand: CommandModule = {
  name: 'trace-tag',
  help: HELP,
  helpText: HELP_TEXT,
  parseArgs(argv): MinCommandArgs {
    return parseTraceTagArgs(argv);
  },
  run(args: MinCommandArgs, startedAt): ReturnType<typeof runTraceTag> {
    return runTraceTag(args as TraceTagArgs, startedAt);
  },
  sourceFiles,
};
