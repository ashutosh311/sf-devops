import type { Status } from './constants';
import type {
  ExplainErrorDetails,
  ExplainErrorResult,
  PricingCliErrorObject,
} from './types';

export class PricingCliError extends Error {
  readonly code: string;
  readonly details: Record<string, unknown>;
  readonly suggestion: string;
  readonly fatal: boolean;

  constructor(
    code: string,
    message: string,
    details: Record<string, unknown> = {},
    suggestion = '',
    fatal = true,
  ) {
    super(message);
    this.name = 'PricingCliError';
    this.code = code;
    this.details = details;
    this.suggestion = suggestion;
    this.fatal = fatal;
  }

  toErrorObject(): PricingCliErrorObject {
    return {
      code: this.code,
      message: this.message,
      details: this.details,
      suggestion: this.suggestion,
    };
  }
}

export const ERROR_EXPLANATIONS = {
  file_not_found: {
    meaning: 'A required file path does not exist from the CLI working context.',
    likely_causes: [
      'The supplied path is wrong or misspelled.',
      'The file lives in a different repo subdirectory or scratch output folder.',
      'A Windows path was passed without translating it into the current WSL path.',
    ],
    next_checks: [
      'Verify the exact path on disk.',
      'Run discover --repo on the relevant repo subtree if you are not sure where the artifact lives.',
      'If the missing file is a ContextDefinition, provide the actual --context path before running crosswalk or validate.',
    ],
    example_commands: [
      'pricing-procedure discover --repo research-artifacts --json',
      'pricing-procedure doctor --file <procedure-file> --context <context-file> --json',
    ],
    related_statuses: ['error', 'warn'],
  },
  xml_parse_error: {
    meaning: 'The file exists but could not be parsed as valid XML metadata.',
    likely_causes: [
      'The file is truncated or malformed.',
      'The path points to the wrong artifact type or a non-XML file.',
      'Manual edits introduced invalid XML syntax.',
    ],
    next_checks: [
      'Open the file and inspect the malformed area.',
      'Compare against a known-good metadata export.',
      'Use doctor on the same file to confirm the failure mode before deeper analysis.',
    ],
    example_commands: [
      'pricing-procedure doctor --file <procedure-file> --json',
    ],
    related_statuses: ['error', 'warn'],
  },
  wrong_root_tag: {
    meaning: 'The file parsed as XML but the metadata root tag does not match the expected root for the command.',
    likely_causes: [
      'The path points to a different metadata type.',
      'The file was copied or renamed incorrectly.',
    ],
    next_checks: [
      'Confirm whether the file is an ExpressionSetDefinition or ContextDefinition.',
      'Run discover first if you are unsure which artifact family you have.',
    ],
    example_commands: [
      'pricing-procedure discover --file <expression-set-file> --json',
    ],
    related_statuses: ['error', 'warn'],
  },
  not_expression_set_definition: {
    meaning: 'The command expected an ExpressionSetDefinition metadata file but received a different root artifact.',
    likely_causes: [
      'The selected file is not an ExpressionSetDefinition.',
      'A ContextDefinition or another metadata XML file was passed by mistake.',
    ],
    next_checks: [
      'Use discover to classify the artifact family.',
      'Pass the actual *.expressionSetDefinition-meta.xml file to pricing-procedure commands.',
    ],
    example_commands: [
      'pricing-procedure discover --file <expression-set-file> --json',
    ],
    related_statuses: ['error', 'warn'],
  },
  not_pricing_procedure: {
    meaning: 'The file is an ExpressionSetDefinition, but its interfaceSourceType is not PricingProcedure.',
    likely_causes: [
      'The artifact belongs to an adjacent family like DiscoveryProcedure, QualificationProcedure, or RatingDiscoveryProcedure.',
      'The wrong expression-set file was selected from a mixed repo or org retrieval.',
    ],
    next_checks: [
      'Inspect interfaceSourceType and candidate_adjacent_family.',
      'Use discover --repo to inventory nearby ExpressionSetDefinition files and find a true PricingProcedure artifact.',
    ],
    example_commands: [
      'pricing-procedure discover --repo research-artifacts --json',
      'pricing-procedure doctor --file <expression-set-file> --json',
    ],
    related_statuses: ['error', 'warn'],
  },
  invalid_selector_format: {
    meaning: 'The selector syntax is not supported by the canonical CLI contract.',
    likely_causes: [
      'A version selector used an unsupported form instead of active, FULL_NAME, or rank:N.',
      'More than one step selector family was supplied where exactly one is allowed.',
      'Diff mode flags were mixed incorrectly.',
    ],
    next_checks: [
      'Check the subcommand help for the exact selector grammar.',
      'Use doctor to validate the selector against the target artifact before rerunning inspect-step, diff, or crosswalk.',
      'Use discover or summarize to list exact fullName, step-name, and sequence candidates.',
    ],
    example_commands: [
      'pricing-procedure inspect-step --file <procedure-file> --version active --step-name <step-name> --json',
      'pricing-procedure doctor --file <procedure-file> --version active --step-name <step-name> --json',
    ],
    related_statuses: ['error', 'unsupported'],
  },
  missing_context_definition: {
    meaning: 'A required or requested ContextDefinition companion artifact is missing, so exact context checks cannot fully run.',
    likely_causes: [
      'The supplied --context path is wrong or missing.',
      'The repo or retrieval output does not yet include the needed ContextDefinition file.',
      'The procedure was inspected without retrieving its companion context metadata.',
    ],
    next_checks: [
      'Locate the expected ContextDefinition metadata file.',
      'Use doctor with --context to verify the companion path before rerunning crosswalk or validate.',
      'If the context file is genuinely unavailable, treat downstream linkage claims as partial.',
    ],
    example_commands: [
      'pricing-procedure doctor --file <procedure-file> --context <context-file> --json',
      'pricing-procedure crosswalk --procedure <procedure-file> --context <context-file> --version active --json',
    ],
    related_statuses: ['error', 'warn', 'partial'],
  },
  context_parse_error: {
    meaning: 'The supplied context file is not a valid ContextDefinition metadata artifact for exact crosswalk checks.',
    likely_causes: [
      'The file is malformed XML.',
      'The file is a different metadata type.',
      'The wrong companion artifact was selected.',
    ],
    next_checks: [
      'Verify the file is a *.contextDefinition-meta.xml artifact.',
      'Use doctor with the same --context path to confirm the failure mode.',
    ],
    example_commands: [
      'pricing-procedure doctor --file <procedure-file> --context <context-file> --json',
    ],
    related_statuses: ['error', 'warn', 'partial'],
  },
  unsupported_analysis_mode: {
    meaning: 'The requested flag or analysis mode is not supported for that command.',
    likely_causes: [
      'A diff-only flag like --fail-on changed was used with a non-diff command.',
      'The command contract does not allow that option combination.',
    ],
    next_checks: [
      'Check the subcommand help for allowed flag combinations.',
      'Use explain-error on the returned code if you need the command-family rule in plain language.',
    ],
    example_commands: [
      'pricing-procedure diff --file <procedure-file> --version-left <left-version> --version-right <right-version> --json',
      'pricing-procedure explain-error --code unsupported_analysis_mode --json',
    ],
    related_statuses: ['error', 'unsupported'],
  },
  repo_scan_root_not_found: {
    meaning: 'The repo scan root path does not exist.',
    likely_causes: [
      'The wrong repo path was passed to --repo.',
      'The command was run from a different working directory than expected.',
    ],
    next_checks: [
      'Confirm the root path exists from the current shell.',
      'Rerun doctor or discover with the correct repo subtree.',
    ],
    example_commands: [
      'pricing-procedure doctor --repo . --json',
      'pricing-procedure discover --repo . --json',
    ],
    related_statuses: ['error', 'warn'],
  },
  internal_contract_error: {
    meaning: 'The CLI violated its own result or status contract unexpectedly.',
    likely_causes: [
      'A bug exists in the canonical CLI implementation.',
      'An output schema or status/exit path drifted from the shared contract.',
    ],
    next_checks: [
      'Capture the command, arguments, and emitted output.',
      'Inspect the shared io/render/status logic before trusting downstream automation.',
    ],
    example_commands: [
      'pricing-procedure explain-error --code internal_contract_error --json',
    ],
    related_statuses: ['error'],
  },
  version_not_found: {
    meaning: 'The selector syntax was valid, but no versions matched it in the current scope.',
    likely_causes: [
      'The version fullName is wrong.',
      'No active version exists for active.',
      'The selector was applied to the wrong file or artifact.',
    ],
    next_checks: [
      'Use discover or summarize to list available version fullName values and active states.',
      'Use doctor with the same selector to get candidate versions before rerunning the main command.',
    ],
    example_commands: [
      'pricing-procedure summarize --file <procedure-file> --json',
      'pricing-procedure doctor --file <procedure-file> --version active --json',
    ],
    related_statuses: ['no_match', 'warn'],
  },
  step_not_found: {
    meaning: 'The step selector syntax was valid, but no steps matched it in the selected version scope.',
    likely_causes: [
      'The step name or sequence number is wrong.',
      'The chosen version scope excluded the step you expected.',
    ],
    next_checks: [
      'Use summarize to inspect available step names or sequence numbers.',
      'Use doctor with the same version and step selector to get candidate alternatives.',
    ],
    example_commands: [
      'pricing-procedure summarize --file <procedure-file> --version active --json',
      'pricing-procedure doctor --file <procedure-file> --version active --step-name <step-name> --json',
    ],
    related_statuses: ['no_match', 'warn'],
  },
  symbol_not_found: {
    meaning: 'The requested context tag or lower-level parameter filter did not match any extracted procedure or crosswalk rows.',
    likely_causes: [
      'The requested context tag is named differently in the pricing procedure or context definition.',
      'The requested parameter or context tag exists in a different step or version than the current scope.',
    ],
    next_checks: [
      'Inspect the target step first to confirm parameter names and context-tag values.',
      'Use summarize --focus-tag or trace-tag to confirm the context-tag family before narrowing with crosswalk.',
      'Relax the crosswalk --name filter or rerun without it to inspect all rows.',
    ],
    example_commands: [
      'pricing-procedure summarize --file <procedure-file> --focus-tag <context-tag> --json',
      'pricing-procedure trace-tag --file <procedure-file> --tag <context-tag> --json',
      'pricing-procedure crosswalk --procedure <procedure-file> --context <context-file> --tag <context-tag> --include-mappings --json',
    ],
    related_statuses: ['no_match', 'warn'],
  },
  multiple_active_versions: {
    meaning: 'More than one version is marked Active, which may make edits and comparisons ambiguous.',
    likely_causes: [
      'Version statuses drifted during metadata or org-side activation work.',
      'The artifact was retrieved from an unexpected org state.',
    ],
    next_checks: [
      'Review version statuses, rank, and startDate before editing or diffing.',
      'Use summarize to inspect version state, then narrow diff or validation to the intended version.',
    ],
    example_commands: [
      'pricing-procedure summarize --file <procedure-file> --json',
      'pricing-procedure validate --file <procedure-file> --json',
    ],
    related_statuses: ['warn'],
  },
  repo_scan_truncated: {
    meaning: 'The repo scan hit the configured candidate-file limit before completing.',
    likely_causes: [
      'The repo path is too broad for the v1 scan limit.',
      'The metadata files live in a large monorepo subtree.',
    ],
    next_checks: [
      'Rerun discover or doctor on a narrower repo subtree.',
      'Point the command directly at the metadata package or research-artifacts directory.',
    ],
    example_commands: [
      'pricing-procedure discover --repo research-artifacts --json',
      'pricing-procedure doctor --repo research-artifacts --json',
    ],
    related_statuses: ['partial', 'warn'],
  },
  symlink_skipped: {
    meaning: 'A symlink was encountered during repo scan and skipped by the v1 scan policy.',
    likely_causes: [
      'The repo uses symlinked metadata directories.',
      'The scan path traverses a linked scratch or generated tree.',
    ],
    next_checks: [
      'Point the command at the real directory path instead of the symlink.',
      'Use direct file mode if you already know the actual metadata file path.',
    ],
    example_commands: [
      'pricing-procedure discover --file <procedure-file> --json',
    ],
    related_statuses: ['warn', 'partial'],
  },
} as const satisfies Record<string, ExplainErrorDetails>;

export const ERROR_CODE_ALIASES = {
  no_matching_steps: 'step_not_found',
  no_steps_found: 'step_not_found',
  missing_step: 'step_not_found',
  unknown_version: 'version_not_found',
  no_matching_versions: 'version_not_found',
  missing_context: 'missing_context_definition',
  tag_not_found: 'symbol_not_found',
  parameter_not_found: 'symbol_not_found',
} as const satisfies Record<string, keyof typeof ERROR_EXPLANATIONS>;

export type CanonicalErrorCode = keyof typeof ERROR_EXPLANATIONS;
export type ErrorCodeAlias = keyof typeof ERROR_CODE_ALIASES;
export type KnownErrorCode = CanonicalErrorCode | ErrorCodeAlias;

export function knownErrorCodes(): CanonicalErrorCode[] {
  return Object.keys(ERROR_EXPLANATIONS).sort() as CanonicalErrorCode[];
}

export function resolveErrorCode(code: string): CanonicalErrorCode | null {
  if (code in ERROR_EXPLANATIONS) {
    return code as CanonicalErrorCode;
  }
  if (code in ERROR_CODE_ALIASES) {
    return ERROR_CODE_ALIASES[code as ErrorCodeAlias];
  }
  return null;
}

interface MatchSpan {
  leftStart: number;
  rightStart: number;
  size: number;
}

function buildIndex(value: string): Map<string, number[]> {
  const index = new Map<string, number[]>();
  for (let i = 0; i < value.length; i += 1) {
    const char = value[i];
    const matches = index.get(char);
    if (matches) {
      matches.push(i);
    } else {
      index.set(char, [i]);
    }
  }
  return index;
}

function findLongestMatch(
  left: string,
  leftStart: number,
  leftEnd: number,
  right: string,
  rightStart: number,
  rightEnd: number,
): MatchSpan {
  const rightIndexByChar = buildIndex(right);
  let bestLeftStart = leftStart;
  let bestRightStart = rightStart;
  let bestSize = 0;
  let previousLengths = new Map<number, number>();

  for (let leftIndex = leftStart; leftIndex < leftEnd; leftIndex += 1) {
    const currentLengths = new Map<number, number>();
    const matchingRightIndexes = rightIndexByChar.get(left[leftIndex]) ?? [];
    for (const rightIndex of matchingRightIndexes) {
      if (rightIndex < rightStart || rightIndex >= rightEnd) {
        continue;
      }

      const matchSize = (previousLengths.get(rightIndex - 1) ?? 0) + 1;
      currentLengths.set(rightIndex, matchSize);
      if (matchSize > bestSize) {
        bestLeftStart = leftIndex - matchSize + 1;
        bestRightStart = rightIndex - matchSize + 1;
        bestSize = matchSize;
      }
    }
    previousLengths = currentLengths;
  }

  while (
    bestLeftStart > leftStart &&
    bestRightStart > rightStart &&
    left[bestLeftStart - 1] === right[bestRightStart - 1]
  ) {
    bestLeftStart -= 1;
    bestRightStart -= 1;
    bestSize += 1;
  }

  while (
    bestLeftStart + bestSize < leftEnd &&
    bestRightStart + bestSize < rightEnd &&
    left[bestLeftStart + bestSize] === right[bestRightStart + bestSize]
  ) {
    bestSize += 1;
  }

  return {
    leftStart: bestLeftStart,
    rightStart: bestRightStart,
    size: bestSize,
  };
}

function getMatchingBlocks(left: string, right: string): MatchSpan[] {
  const queue: Array<[number, number, number, number]> = [[0, left.length, 0, right.length]];
  const blocks: MatchSpan[] = [];

  while (queue.length > 0) {
    const [leftStart, leftEnd, rightStart, rightEnd] = queue.pop()!;
    const match = findLongestMatch(left, leftStart, leftEnd, right, rightStart, rightEnd);
    if (match.size === 0) {
      continue;
    }

    blocks.push(match);

    if (leftStart < match.leftStart && rightStart < match.rightStart) {
      queue.push([leftStart, match.leftStart, rightStart, match.rightStart]);
    }

    const leftMatchEnd = match.leftStart + match.size;
    const rightMatchEnd = match.rightStart + match.size;
    if (leftMatchEnd < leftEnd && rightMatchEnd < rightEnd) {
      queue.push([leftMatchEnd, leftEnd, rightMatchEnd, rightEnd]);
    }
  }

  blocks.sort((first, second) => first.leftStart - second.leftStart || first.rightStart - second.rightStart);

  const collapsed: MatchSpan[] = [];
  let currentLeftStart = 0;
  let currentRightStart = 0;
  let currentSize = 0;

  for (const block of blocks) {
    if (
      currentSize > 0 &&
      currentLeftStart + currentSize === block.leftStart &&
      currentRightStart + currentSize === block.rightStart
    ) {
      currentSize += block.size;
      continue;
    }

    if (currentSize > 0) {
      collapsed.push({
        leftStart: currentLeftStart,
        rightStart: currentRightStart,
        size: currentSize,
      });
    }

    currentLeftStart = block.leftStart;
    currentRightStart = block.rightStart;
    currentSize = block.size;
  }

  if (currentSize > 0) {
    collapsed.push({
      leftStart: currentLeftStart,
      rightStart: currentRightStart,
      size: currentSize,
    });
  }

  collapsed.push({
    leftStart: left.length,
    rightStart: right.length,
    size: 0,
  });

  return collapsed;
}

function sequenceMatcherRatio(left: string, right: string): number {
  if (left === right) {
    return 1;
  }

  const totalLength = left.length + right.length;
  if (totalLength === 0) {
    return 1;
  }

  const blocks = getMatchingBlocks(left, right);
  const matches = blocks.reduce((sum, block) => sum + block.size, 0);
  return (2 * matches) / totalLength;
}

function closestKnownCodes(code: string): string[] {
  const candidates = [...knownErrorCodes(), ...Object.keys(ERROR_CODE_ALIASES)];

  return candidates
    .map((candidate, index) => ({
      candidate,
      index,
      score: sequenceMatcherRatio(code, candidate),
    }))
    .filter(({ score }) => score >= 0.45)
    .sort((left, right) => right.score - left.score || left.index - right.index)
    .slice(0, 5)
    .map(({ candidate }) => candidate);
}

export function explainErrorCode(
  code: string,
): [ExplainErrorResult, null] | [null, ExplainErrorResult] {
  const canonicalCode = resolveErrorCode(code);
  if (!canonicalCode) {
    const closest = closestKnownCodes(code);
    const suggestedCanonicalCode = closest.length > 0 ? resolveErrorCode(closest[0]) : null;
    return [
      null,
      {
        error_code: code,
        canonical_error_code: null,
        meaning: '',
        likely_causes: [],
        next_checks: [],
        example_commands: [],
        related_statuses: [] as Status[],
        closest_known_codes: closest,
        suggested_canonical_code: suggestedCanonicalCode,
        alias_matched: false,
      },
    ];
  }

  const details = ERROR_EXPLANATIONS[canonicalCode];
  return [
    {
      error_code: code,
      canonical_error_code: canonicalCode,
      meaning: details.meaning,
      likely_causes: [...details.likely_causes],
      next_checks: [...details.next_checks],
      example_commands: [...details.example_commands],
      related_statuses: [...details.related_statuses],
      closest_known_codes: [],
      suggested_canonical_code: canonicalCode,
      alias_matched: canonicalCode !== code,
    },
    null,
  ];
}
