import { makeEnvelope, makeNotice, makeSummary } from './contracts/envelope';
import { PricingCliError } from './contracts/errors';
import type {
  Envelope,
  NormalizedProcedureArtifact,
  NormalizedProcedureParameter,
  NormalizedProcedureStep,
  NormalizedProcedureVersion,
  Notice,
} from './contracts/types';
import {
  requireExactOneStepSelectorFamily,
  resolveVersionSelectorWithActiveDefault,
  selectVersionsWithActiveDefault,
  type StepSelectorKind,
} from './domain/selectors';
import type { EffectiveOrderMetadata } from './parsing/effective_order';
import { loadExpressionSet } from './parsing/normalize/procedure';

export interface InspectStepArgs {
  file: string;
  version?: string;
  activeOnly: boolean;
  stepName?: string;
  sequence?: string;
  actionType?: string;
  parentStep?: string;
  listCandidates: boolean;
  stepNameContains?: string;
  compact: boolean;
  verbose: boolean;
  json: boolean;
  failOn: 'none' | 'warn' | 'changed' | 'partial' | 'no_match' | 'unsupported';
}

interface CandidateStepRow {
  step_name: string;
  match_count: number;
  versions: string[];
  action_types: string[];
  sequence_numbers: string[];
}

interface MatchedStepRow {
  step_identity: {
    version: string | null;
    name: string | null;
    sequence_number: string | null;
  };
  xml_index: number | null;
  effective_order: EffectiveOrderMetadata | null;
  parent_step: string | null;
  action_type: string | null;
  step_type: string | null;
  parameter_summary: {
    parameter_count: number;
    input_count: number;
    output_count: number;
    input_values: string[];
    output_values: string[];
    parameters: NormalizedProcedureParameter[];
  };
}

interface InspectStepSelector {
  kind: string;
  value: string | null;
  version: string | null;
  active_only: boolean;
  [key: string]: unknown;
}

interface InspectStepResult {
  selector: InspectStepSelector;
  candidate_steps?: CandidateStepRow[];
  matched_steps?: MatchedStepRow[];
  match_count: number;
}



function requirePricingProcedure(artifact: NormalizedProcedureArtifact, commandName: string): void {
  if (!artifact.is_pricing_procedure) {
    throw new PricingCliError(
      'not_pricing_procedure',
      `${commandName} requires a pricing procedure artifact.`,
      {
        path: artifact.path,
        interface_source_type: artifact.interface_source_type,
        artifact_family: artifact.artifact_family,
      },
      'Use discover first, or provide an ExpressionSetDefinition whose interfaceSourceType includes PricingProcedure.',
    );
  }
}

function parseStepSelector(args: InspectStepArgs): readonly [StepSelectorKind, string] {
  const selector = requireExactOneStepSelectorFamily({
    stepName: args.stepName,
    sequence: args.sequence,
    actionType: args.actionType,
    parentStep: args.parentStep,
  });
  return [selector.kind, selector.value];
}

function collectStepCandidates(
  versions: readonly NormalizedProcedureVersion[],
  containsText?: string,
): CandidateStepRow[] {
  const containsKey = (containsText ?? '').toLowerCase();
  const candidates = new Map<
    string,
    { step_name: string; match_count: number; versions: Set<string>; action_types: Set<string>; sequence_numbers: Set<string> }
  >();

  for (const version of versions) {
    for (const step of version.steps) {
      const name = step.name;
      if (!name) {
        continue;
      }
      if (containsKey && !name.toLowerCase().includes(containsKey)) {
        continue;
      }
      const entry = candidates.get(name) ?? {
        step_name: name,
        match_count: 0,
        versions: new Set<string>(),
        action_types: new Set<string>(),
        sequence_numbers: new Set<string>(),
      };
      entry.match_count += 1;
      if (version.fullName) {
        entry.versions.add(version.fullName);
      }
      if (step.actionType) {
        entry.action_types.add(step.actionType);
      }
      if (step.sequenceNumber != null) {
        entry.sequence_numbers.add(String(step.sequenceNumber));
      }
      candidates.set(name, entry);
    }
  }

  return Array.from(candidates.values())
    .map((entry) => ({
      step_name: entry.step_name,
      match_count: entry.match_count,
      versions: Array.from(entry.versions).sort(),
      action_types: Array.from(entry.action_types).sort(),
      sequence_numbers: Array.from(entry.sequence_numbers).sort((left, right) => {
        const leftNumber = /^\d+$/.test(left) ? Number(left) : Number.MAX_SAFE_INTEGER;
        const rightNumber = /^\d+$/.test(right) ? Number(right) : Number.MAX_SAFE_INTEGER;
        return leftNumber - rightNumber || left.localeCompare(right);
      }),
    }))
    .sort((left, right) => right.match_count - left.match_count || left.step_name.localeCompare(right.step_name));
}

interface MatchSpan {
  leftStart: number;
  rightStart: number;
  size: number;
}

function findLongestMatch(
  left: string,
  leftStart: number,
  leftEnd: number,
  right: string,
  rightStart: number,
  rightEnd: number,
): MatchSpan {
  const rightIndex = new Map<string, number[]>();
  for (let index = rightStart; index < rightEnd; index += 1) {
    const char = right[index]!;
    const indexes = rightIndex.get(char);
    if (indexes) {
      indexes.push(index);
    } else {
      rightIndex.set(char, [index]);
    }
  }

  let bestLeftStart = leftStart;
  let bestRightStart = rightStart;
  let bestSize = 0;
  let previous = new Map<number, number>();

  for (let leftIndex = leftStart; leftIndex < leftEnd; leftIndex += 1) {
    const next = new Map<number, number>();
    for (const rightIndexValue of rightIndex.get(left[leftIndex]!) ?? []) {
      if (rightIndexValue < rightStart || rightIndexValue >= rightEnd) {
        continue;
      }
      const size = (previous.get(rightIndexValue - 1) ?? 0) + 1;
      next.set(rightIndexValue, size);
      if (size > bestSize) {
        bestLeftStart = leftIndex - size + 1;
        bestRightStart = rightIndexValue - size + 1;
        bestSize = size;
      }
    }
    previous = next;
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

function suggestStepNames(
  versions: readonly NormalizedProcedureVersion[],
  requestedName: string,
  limit = 5,
): string[] {
  const names = Array.from(
    new Set(
      versions.flatMap((version) => version.steps.map((step) => step.name).filter((name): name is string => Boolean(name))),
    ),
  ).sort();
  if (!requestedName) {
    return [];
  }
  const requestedLower = requestedName.toLowerCase();
  const close = names
    .map((name) => ({ name, score: sequenceMatcherRatio(requestedName, name) }))
    .filter((entry) => entry.score >= 0.45)
    .sort((left, right) => right.score - left.score || left.name.localeCompare(right.name))
    .map((entry) => entry.name);
  const contains = names.filter((name) => name.toLowerCase().includes(requestedLower));
  const combined: string[] = [];
  const seen = new Set<string>();
  for (const name of [...close, ...contains]) {
    if (seen.has(name)) {
      continue;
    }
    seen.add(name);
    combined.push(name);
    if (combined.length >= limit) {
      break;
    }
  }
  return combined;
}

function matchesSelector(step: NormalizedProcedureStep, selectorKind: StepSelectorKind, selectorValue: string): boolean {
  if (selectorKind === 'step_name') {
    return step.name === selectorValue;
  }
  if (selectorKind === 'sequence') {
    return String(step.sequenceNumber) === String(selectorValue);
  }
  if (selectorKind === 'action_type') {
    return (step.actionType ?? '') === selectorValue;
  }
  return (step.parentStep ?? '') === selectorValue;
}

function buildMatchedStepRow(
  version: NormalizedProcedureVersion,
  step: NormalizedProcedureStep,
  verbose: boolean,
): MatchedStepRow {
  const inputs = step.parameters.filter((parameter) => parameter.input === 'true');
  const outputs = step.parameters.filter((parameter) => parameter.output === 'true');
  return {
    step_identity: {
      version: version.fullName,
      name: step.name,
      sequence_number: step.sequenceNumber,
    },
    xml_index: step.xml_index ?? null,
    effective_order: (step.effective_order as EffectiveOrderMetadata | undefined) ?? null,
    parent_step: step.parentStep,
    action_type: step.actionType,
    step_type: step.stepType,
    parameter_summary: {
      parameter_count: step.parameters.length,
      input_count: inputs.length,
      output_count: outputs.length,
      input_values: inputs.map((parameter) => parameter.value).filter((value): value is string => Boolean(value)),
      output_values: outputs.map((parameter) => parameter.value).filter((value): value is string => Boolean(value)),
      parameters: verbose ? step.parameters : [],
    },
  };
}

export function runInspectStep(args: InspectStepArgs, startedAt: number): Envelope<InspectStepResult> {
  const artifact = loadExpressionSet(args.file);
  requirePricingProcedure(artifact, 'inspect-step');
  const versionSelector = resolveVersionSelectorWithActiveDefault(args.version, args.activeOnly);
  const versions = selectVersionsWithActiveDefault(artifact.versions, versionSelector, args.activeOnly);

  if (args.listCandidates) {
    const candidates = collectStepCandidates(versions, args.stepNameContains);
    const warnings: Notice[] = [];
    if (candidates.length === 0) {
      warnings.push(
        makeNotice(
          'step_not_found',
          'No candidate step names matched the requested contains filter.',
          { step_name_contains: args.stepNameContains ?? null },
          'Relax --step-name-contains or remove --list-candidates to inspect exact matches instead.',
        ),
      );
    }
    const result: InspectStepResult = {
      selector: {
        kind: 'candidate_list',
        value: args.stepNameContains ?? null,
        version: versionSelector ?? null,
        active_only: args.activeOnly,
      },
      candidate_steps: candidates.slice(0, 20),
      match_count: candidates.length,
    };
    return makeEnvelope(
      'inspect-step',
      makeSummary(
        args.file,
        candidates.length > 0 ? 'Candidate step listing completed.' : 'No candidate step names matched the requested filter.',
        { match_count: candidates.length },
        candidates.length > 0 ? 'inspect-step' : 'summarize',
      ),
      result,
      {
        warnings,
        status: candidates.length > 0 ? 'ok' : 'no_match',
        source_files: [args.file],
        selector_input: result.selector,
        started_at: startedAt,
      },
    );
  }

  const [selectorKind, selectorValue] = parseStepSelector(args);
  const matchedSteps: MatchedStepRow[] = [];
  for (const version of versions) {
    for (const step of version.steps) {
      if (matchesSelector(step, selectorKind, selectorValue)) {
        matchedSteps.push(buildMatchedStepRow(version, step, args.verbose));
      }
    }
  }

  const warnings: Notice[] = [];
  const result: InspectStepResult = {
    selector: {
      kind: selectorKind,
      value: selectorValue,
      version: versionSelector ?? null,
      active_only: args.activeOnly,
    },
    matched_steps: matchedSteps,
    match_count: matchedSteps.length,
  };

  if (matchedSteps.length === 0) {
    let candidateSteps: CandidateStepRow[] = [];
    if (selectorKind === 'step_name') {
      const suggestedNames = suggestStepNames(versions, selectorValue);
      const suggestedNameSet = new Set(suggestedNames);
      candidateSteps = collectStepCandidates(versions).filter((row) => suggestedNameSet.has(row.step_name)).slice(0, 5);
    } else if (selectorKind === 'sequence') {
      candidateSteps = collectStepCandidates(versions)
        .slice()
        .sort((left, right) => left.step_name.localeCompare(right.step_name))
        .slice(0, 5);
    }
    if (candidateSteps.length > 0) {
      result.candidate_steps = candidateSteps;
    }
    warnings.push(
      makeNotice(
        'step_not_found',
        'No steps matched the requested selector.',
        {
          selector_kind: selectorKind,
          selector_value: selectorValue,
          candidate_step_names: candidateSteps.map((row) => row.step_name),
        },
        'Use inspect-step --list-candidates --step-name-contains <text> for inline selector recovery, or summarize to inspect available step names and sequence numbers.',
      ),
    );
  }

  return makeEnvelope(
    'inspect-step',
    makeSummary(
      args.file,
      matchedSteps.length > 0 ? 'Step inspection completed.' : 'No steps matched the requested selector.',
      { match_count: matchedSteps.length },
      matchedSteps.length > 0 ? 'crosswalk' : 'inspect-step --list-candidates',
    ),
    result,
    {
      warnings,
      status: matchedSteps.length > 0 ? 'ok' : 'no_match',
      source_files: [args.file],
      selector_input: result.selector,
      started_at: startedAt,
    },
  );
}
