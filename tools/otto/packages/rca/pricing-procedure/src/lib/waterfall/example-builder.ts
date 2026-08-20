import { readFileSync } from 'node:fs';

import { makeEnvelope, makeNotice, makeSummary } from '../contracts/envelope';
import { PricingCliError } from '../contracts/errors';
import type { Envelope } from '../contracts/types';
import { normalizedContextKey } from '../domain/context_families';
import { evaluateFormula } from './formula-parser';
import type { WaterfallBar, WaterfallExample, WaterfallLane, WaterfallModel, WaterfallOverwrite } from './schema';

export interface WaterfallExampleArgs {
  model: string;
  values?: string;
  runtimeWaterfall?: string;
  json: boolean;
  failOn: 'none' | 'warn' | 'changed' | 'partial' | 'no_match' | 'unsupported';
}

function readJsonFile<T>(path: string): T {
  try {
    return JSON.parse(readFileSync(path, 'utf8')) as T;
  } catch (error) {
    throw new PricingCliError(
      'json_parse_error',
      `Could not parse JSON file: ${path}`,
      { path, error: error instanceof Error ? error.message : String(error) },
      'Check that the file contains valid JSON.',
    );
  }
}

function unwrapEnvelopeResult<T>(payload: unknown): T {
  if (payload && typeof payload === 'object' && 'result' in payload) {
    return (payload as { result: T }).result;
  }
  return payload as T;
}

function asNumber(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === 'string' && value.trim() !== '' && Number.isFinite(Number(value))) {
    return Number(value);
  }
  return null;
}

function valuesFromFile(path: string | undefined): Record<string, number> {
  if (!path) {
    return {};
  }
  const payload = readJsonFile<Record<string, unknown>>(path);
  const rawValues = payload.values && typeof payload.values === 'object'
    ? payload.values as Record<string, unknown>
    : payload;
  return Object.fromEntries(
    Object.entries(rawValues)
      .map(([key, value]) => [key, asNumber(value)] as const)
      .filter((entry): entry is readonly [string, number] => typeof entry[1] === 'number'),
  );
}

function stepLabel(model: WaterfallModel, stepId: string | null): string {
  if (!stepId) {
    return 'Unmapped Runtime Step';
  }
  return model.graph.nodes.find((node) => node.id === stepId)?.label ?? stepId.replace(/^step:/, '');
}

function operationFor(inputValue: number | null, outputValue: number | null, isOverwrite: boolean): WaterfallBar['operation'] {
  if (inputValue === null || outputValue === null) {
    return inputValue === null && outputValue !== null ? 'base' : 'set';
  }
  const delta = outputValue - inputValue;
  if (delta > 0) {
    return 'increase';
  }
  if (delta < 0) {
    return 'decrease';
  }
  if (isOverwrite) {
    return 'overwrite';
  }
  return 'set';
}

function sameStepIdFromName(model: WaterfallModel, name: string | null): string | null {
  if (!name) {
    return null;
  }
  const normalized = name.replace(/[^A-Za-z0-9_.:-]+/g, '_').toLowerCase();
  return model.graph.nodes.find((node) => node.kind === 'procedure_step' && node.id.toLowerCase() === `step:${normalized}`)?.id
    ?? model.graph.nodes.find((node) => node.kind === 'procedure_step' && node.label.toLowerCase() === name.toLowerCase())?.id
    ?? null;
}

function extractRuntimeElements(payload: unknown): RuntimeElement[] {
  const result = unwrapEnvelopeResult<Record<string, unknown>>(payload);
  const waterfall = result.waterfall as Record<string, unknown> | undefined;
  const normalized = waterfall?.normalized_elements;
  if (Array.isArray(normalized)) {
    return normalized.flatMap((item, index) => {
      if (!item || typeof item !== 'object') {
        return [];
      }
      const record = item as Record<string, unknown>;
      return [{
        sequence: asNumber(record.sequence) ?? index + 1,
        name: typeof record.name === 'string' ? record.name : null,
        writes: Array.isArray(record.writes) ? record.writes.filter((value): value is string => typeof value === 'string') : [],
        inputs: Array.isArray(record.inputs) ? record.inputs : [],
        outputs: Array.isArray(record.outputs) ? record.outputs : [],
        calculation_formula: typeof record.calculation_formula === 'string' ? record.calculation_formula : null,
      }];
    }).sort((left, right) => left.sequence - right.sequence);
  }
  return [];
}

function outputValueFor(outputs: readonly unknown[], write: string | null): number | null {
  for (const output of outputs) {
    if (asNumber(output) !== null && !write) {
      return asNumber(output);
    }
    if (!output || typeof output !== 'object') {
      continue;
    }
    const record = output as Record<string, unknown>;
    const target = record.target ?? record.name ?? record.fieldName ?? record.field;
    if (write && typeof target === 'string' && normalizedContextKey(target) !== normalizedContextKey(write)) {
      continue;
    }
    for (const key of ['value', 'outputValue', 'amount', 'result']) {
      const candidate = asNumber(record[key]);
      if (candidate !== null) {
        return candidate;
      }
    }
  }
  return null;
}

interface RuntimeOutputSelection {
  tag: string | null;
  value: number | null;
}

function outputTarget(output: unknown): string | null {
  if (!output || typeof output !== 'object') {
    return null;
  }
  const record = output as Record<string, unknown>;
  const target = record.target ?? record.name ?? record.fieldName ?? record.field;
  return typeof target === 'string' ? target : null;
}

function outputNumericValue(output: unknown): number | null {
  if (asNumber(output) !== null) {
    return asNumber(output);
  }
  if (!output || typeof output !== 'object') {
    return null;
  }
  const record = output as Record<string, unknown>;
  for (const key of ['value', 'outputValue', 'amount', 'result']) {
    const candidate = asNumber(record[key]);
    if (candidate !== null) {
      return candidate;
    }
  }
  return null;
}

function priceTargetRank(target: string | null, focusTag: string | null, isFirstElement: boolean): number {
  if (!target) {
    return 999;
  }
  const key = normalizedContextKey(target);
  if (isFirstElement && key === normalizedContextKey('ListPrice')) {
    return 0;
  }
  if (focusTag && key === normalizedContextKey(focusTag)) {
    return 1;
  }
  const ranks = [
    'NetUnitPrice',
    'SubscriptionNetUnitPrice',
    'TotalSubscriptionPrice',
    'Subtotal',
    'ListPrice',
    'ItemNetTotalPrice',
    'Output Variable',
    'section-0-output',
    'section-1-output',
  ];
  const matchIndex = ranks.findIndex((candidate) => key === normalizedContextKey(candidate));
  return matchIndex >= 0 ? matchIndex + 2 : 500;
}

function selectRuntimeOutput(
  outputs: readonly unknown[],
  writes: readonly string[],
  focusTag: string | null,
  isFirstElement: boolean,
): RuntimeOutputSelection {
  const candidates = outputs
    .map((output, index) => ({
      tag: outputTarget(output),
      value: outputNumericValue(output),
      index,
    }))
    .filter((candidate) => candidate.value !== null);
  if (candidates.length === 0) {
    const fallbackWrite = writes[0] ?? null;
    return { tag: fallbackWrite, value: outputValueFor(outputs, fallbackWrite) };
  }
  candidates.sort((left, right) =>
    priceTargetRank(left.tag, focusTag, isFirstElement) - priceTargetRank(right.tag, focusTag, isFirstElement)
    || left.index - right.index,
  );
  const selected = candidates[0] as { tag: string | null; value: number; index: number };
  return { tag: selected.tag, value: selected.value };
}

function buildOverwrites(bars: readonly WaterfallBar[]): WaterfallOverwrite[] {
  const seen = new Map<string, WaterfallBar>();
  const overwrites: WaterfallOverwrite[] = [];
  for (const bar of bars) {
    if (!bar.tag) {
      continue;
    }
    const key = normalizedContextKey(bar.tag);
    const prior = seen.get(key);
    if (prior) {
      overwrites.push({
        tag: bar.tag,
        first_step_id: prior.step_id,
        later_step_id: bar.step_id,
        note: 'Later step writes the same output family.',
      });
    }
    seen.set(key, bar);
  }
  return overwrites;
}

interface RuntimeElement {
  sequence: number;
  name: string | null;
  writes: string[];
  outputs: unknown[];
  calculation_formula: string | null;
  inputs?: unknown[];
}

interface RuntimeLaneSpec {
  id: string;
  label: string;
  trackedTag: string;
  targets: string[];
  seedTargets: string[];
}

const RUNTIME_LANE_SPECS: RuntimeLaneSpec[] = [
  {
    id: 'net-unit-price',
    label: 'Net Unit Price',
    trackedTag: 'NetUnitPrice',
    targets: ['NetUnitPrice'],
    seedTargets: ['ListPrice', 'InputUnitPrice', 'Subtotal'],
  },
  {
    id: 'subscription-net-unit-price',
    label: 'Subscription Net Unit Price',
    trackedTag: 'SubscriptionNetUnitPrice',
    targets: ['SubscriptionNetUnitPrice'],
    seedTargets: ['NetUnitPrice', 'ListPrice'],
  },
  {
    id: 'total-subscription-price',
    label: 'Total Subscription Price',
    trackedTag: 'TotalSubscriptionPrice',
    targets: ['TotalSubscriptionPrice'],
    seedTargets: ['SubscriptionNetUnitPrice', 'NetUnitPrice'],
  },
  {
    id: 'subtotal',
    label: 'Subtotal',
    trackedTag: 'Subtotal',
    targets: ['Subtotal'],
    seedTargets: ['ListPrice', 'InputUnitPrice'],
  },
];

function targetMatches(target: string | null, candidates: readonly string[]): boolean {
  if (!target) {
    return false;
  }
  const normalized = normalizedContextKey(target);
  return candidates.some((candidate) => normalized === normalizedContextKey(candidate));
}

function numericOutputForTarget(outputs: readonly unknown[], targets: readonly string[]): RuntimeOutputSelection {
  const targetRank = (target: string | null): number => {
    if (!target) {
      return 999;
    }
    const normalized = normalizedContextKey(target);
    const index = targets.findIndex((candidate) => normalized === normalizedContextKey(candidate));
    return index >= 0 ? index : 999;
  };
  const match = outputs
    .map((output, index) => ({
      tag: outputTarget(output),
      value: outputNumericValue(output),
      index,
    }))
    .filter((candidate) => candidate.value !== null && targetMatches(candidate.tag, targets))
    .sort((left, right) => targetRank(left.tag) - targetRank(right.tag) || left.index - right.index)[0];
  return match ? { tag: match.tag, value: match.value } : { tag: null, value: null };
}

function seedBarFromPriorOutput(
  model: WaterfallModel,
  elements: readonly RuntimeElement[],
  spec: RuntimeLaneSpec,
  beforeSequence: number,
): WaterfallBar | null {
  for (let index = elements.length - 1; index >= 0; index -= 1) {
    const element = elements[index] as RuntimeElement;
    if (element.sequence >= beforeSequence) {
      continue;
    }
    const selected = numericOutputForTarget(element.outputs, spec.seedTargets);
    if (selected.value === null) {
      continue;
    }
    const stepId = sameStepIdFromName(model, element.name);
    return {
      id: `lane:${spec.id}:seed`,
      step_id: stepId,
      label: element.name ?? stepLabel(model, stepId),
      tag: selected.tag,
      operation: 'base',
      input_value: null,
      delta: selected.value,
      output_value: selected.value,
      ...(element.calculation_formula ? { formula: element.calculation_formula } : {}),
      source: 'runtime_output',
    };
  }
  return null;
}

function appendFinalLaneBar(bars: WaterfallBar[], laneId: string, trackedTag: string, label: string): void {
  const lastBar = bars[bars.length - 1];
  if (!lastBar || lastBar.output_value === null) {
    return;
  }
  bars.push({
    id: `lane:${laneId}:final`,
    step_id: null,
    label: `Final ${label}`,
    tag: trackedTag,
    operation: 'final',
    input_value: lastBar.output_value,
    delta: 0,
    output_value: lastBar.output_value,
    source: 'calculated',
  });
}

function buildRuntimeLane(model: WaterfallModel, elements: readonly RuntimeElement[], spec: RuntimeLaneSpec): WaterfallLane | null {
  const matchingElements = elements
    .map((element, index) => ({ element, index, selected: numericOutputForTarget(element.outputs, spec.targets) }))
    .filter((entry) => entry.selected.value !== null);

  if (matchingElements.length === 0) {
    return null;
  }

  const bars: WaterfallBar[] = [];
  const seed = seedBarFromPriorOutput(model, elements, spec, matchingElements[0]?.element.sequence ?? 0);
  let previousValue: number | null = null;
  if (seed) {
    bars.push(seed);
    previousValue = seed.output_value;
  }

  for (const entry of matchingElements) {
    const stepId = sameStepIdFromName(model, entry.element.name);
    const outputValue = entry.selected.value;
    const inputValue = previousValue;
    const duplicate = Boolean(entry.selected.tag && bars.some((bar) => bar.tag && normalizedContextKey(bar.tag) === normalizedContextKey(entry.selected.tag)));
    bars.push({
      id: `lane:${spec.id}:${entry.index + 1}`,
      step_id: stepId,
      label: entry.element.name ?? stepLabel(model, stepId),
      tag: entry.selected.tag ?? spec.trackedTag,
      operation: operationFor(inputValue, outputValue, duplicate),
      input_value: inputValue,
      delta: inputValue !== null && outputValue !== null ? outputValue - inputValue : outputValue,
      output_value: outputValue,
      ...(entry.element.calculation_formula ? { formula: entry.element.calculation_formula } : {}),
      source: 'runtime_output',
    });
    previousValue = outputValue;
  }

  appendFinalLaneBar(bars, spec.id, spec.trackedTag, spec.label);
  const sourceTags = Array.from(new Set(bars.map((bar) => bar.tag).filter((tag): tag is string => Boolean(tag))));
  return {
    id: spec.id,
    label: spec.label,
    tracked_tag: spec.trackedTag,
    bars,
    source_tags: sourceTags,
    excluded_raw_step_count: Math.max(0, elements.length - matchingElements.length - (seed ? 1 : 0)),
    warnings: bars.some((bar) => bar.tag && !targetMatches(bar.tag, [spec.trackedTag, ...spec.targets]))
      ? ['Lane starts from an upstream source value before the tracked field is first assigned.']
      : [],
  };
}

function latestRuntimeOutputBar(
  model: WaterfallModel,
  elements: readonly RuntimeElement[],
  targets: readonly string[],
  laneId: string,
  label: string,
): WaterfallBar | null {
  for (const target of targets) {
    for (let index = elements.length - 1; index >= 0; index -= 1) {
      const element = elements[index] as RuntimeElement;
      const selected = numericOutputForTarget(element.outputs, [target]);
      if (selected.value === null) {
        continue;
      }
      const stepId = sameStepIdFromName(model, element.name);
      return {
        id: `lane:${laneId}:seed`,
        step_id: stepId,
        label,
        tag: selected.tag ?? target,
        operation: 'base',
        input_value: null,
        delta: selected.value,
        output_value: selected.value,
        ...(element.calculation_formula ? { formula: element.calculation_formula } : {}),
        source: 'runtime_output',
      };
    }
  }
  return null;
}

function numericInputForTarget(inputs: readonly unknown[] | undefined, targets: readonly string[]): number | null {
  if (!Array.isArray(inputs)) {
    return null;
  }
  return numericOutputForTarget(inputs, targets).value;
}

function latestRuntimeInputValue(elements: readonly RuntimeElement[], targets: readonly string[]): number | null {
  for (let index = elements.length - 1; index >= 0; index -= 1) {
    const value = numericInputForTarget((elements[index] as RuntimeElement).inputs, targets);
    if (value !== null) {
      return value;
    }
  }
  return null;
}

function numericAnchorValue(anchor: Record<string, unknown> | undefined, keys: readonly string[]): number | null {
  if (!anchor) {
    return null;
  }
  for (const key of keys) {
    const value = asNumber(anchor[key]);
    if (value !== null) {
      return value;
    }
  }
  return null;
}

function buildNetTotalLane(
  model: WaterfallModel,
  elements: readonly RuntimeElement[],
  persistedAnchor: Record<string, unknown> | undefined,
): WaterfallLane | null {
  const unitSeed = latestRuntimeOutputBar(
    model,
    elements,
    ['NetUnitPrice', 'SubscriptionNetUnitPrice', 'ListPrice'],
    'net-total-price',
    'Net Unit Price',
  );
  const quantity = latestRuntimeInputValue(elements, ['Quantity', 'LineItemQuantity']) ?? 1;
  const persistedTotal = numericAnchorValue(persistedAnchor, ['net_total_price', 'total_price', 'total_line_amount']);
  const computedTotal = unitSeed?.output_value !== null && unitSeed?.output_value !== undefined ? unitSeed.output_value * quantity : null;
  const finalTotal = persistedTotal ?? computedTotal;

  if (!unitSeed || finalTotal === null) {
    return null;
  }

  const quantityOutput = unitSeed.output_value === null ? null : unitSeed.output_value * quantity;
  const bars: WaterfallBar[] = [
    unitSeed,
    {
      id: 'lane:net-total-price:quantity',
      step_id: null,
      label: `Quantity x ${quantity}`,
      tag: 'Quantity',
      operation: operationFor(unitSeed.output_value, quantityOutput, false),
      input_value: unitSeed.output_value,
      delta: unitSeed.output_value !== null && quantityOutput !== null ? quantityOutput - unitSeed.output_value : quantityOutput,
      output_value: quantityOutput,
      formula: `${unitSeed.tag ?? 'NetUnitPrice'} * Quantity`,
      source: 'calculated',
    },
    {
      id: 'lane:net-total-price:final',
      step_id: null,
      label: persistedTotal !== null ? 'Persisted Net Total Price' : 'Calculated Net Total Price',
      tag: persistedTotal !== null ? 'NetTotalPrice' : 'CalculatedNetTotalPrice',
      operation: 'final',
      input_value: quantityOutput,
      delta: quantityOutput !== null ? finalTotal - quantityOutput : finalTotal,
      output_value: finalTotal,
      source: persistedTotal !== null ? 'persisted_line' : 'calculated',
    },
  ];

  return {
    id: 'net-total-price',
    label: 'Net Total Price',
    tracked_tag: 'NetTotalPrice',
    bars,
    source_tags: Array.from(new Set(bars.map((bar) => bar.tag).filter((tag): tag is string => Boolean(tag)))),
    excluded_raw_step_count: elements.length,
    warnings: persistedTotal !== null && computedTotal !== null && persistedTotal !== computedTotal
      ? [`Persisted line total ${persistedTotal} does not equal ${unitSeed.output_value} * ${quantity}.`]
      : ['Built from line-level quantity and persisted line total because runtime total outputs are internal section variables.'],
  };
}

function buildRuntimeLanes(
  model: WaterfallModel,
  elements: readonly RuntimeElement[],
  persistedAnchor: Record<string, unknown> | undefined,
): WaterfallLane[] {
  const standardLanes = RUNTIME_LANE_SPECS
    .map((spec) => buildRuntimeLane(model, elements, spec))
    .filter((lane): lane is WaterfallLane => Boolean(lane))
    .filter((lane) => lane.bars.length > 0);
  const netTotalLane = buildNetTotalLane(model, elements, persistedAnchor);
  if (!netTotalLane) {
    return standardLanes;
  }
  const insertAfter = standardLanes.findIndex((lane) => lane.id === 'net-unit-price');
  if (insertAfter < 0) {
    return [netTotalLane, ...standardLanes];
  }
  return [
    ...standardLanes.slice(0, insertAfter + 1),
    netTotalLane,
    ...standardLanes.slice(insertAfter + 1),
  ];
}

function buildRuntimeExample(model: WaterfallModel, runtimePayload: unknown): WaterfallExample {
  const result = unwrapEnvelopeResult<Record<string, unknown>>(runtimePayload);
  const selectorResolution = result.selector_resolution as Record<string, unknown> | undefined;
  const persistedAnchor = result.persisted_anchor as Record<string, unknown> | undefined;
  const elements = extractRuntimeElements(runtimePayload);
  const bars: WaterfallBar[] = [];
  let previousValue: number | null = null;

  for (const [index, element] of elements.entries()) {
    const selectedOutput = selectRuntimeOutput(
      element.outputs,
      element.writes,
      model.procedure.focus_tag,
      index === 0,
    );
    const tag = selectedOutput.tag;
    const outputValue = selectedOutput.value;
    const stepId = sameStepIdFromName(model, element.name);
    const inputValue = previousValue;
    const delta = inputValue !== null && outputValue !== null ? outputValue - inputValue : outputValue;
    const duplicate = Boolean(tag && bars.some((bar) => bar.tag && normalizedContextKey(bar.tag) === normalizedContextKey(tag)));
    bars.push({
      id: `bar:${index + 1}`,
      step_id: stepId,
      label: element.name ?? stepLabel(model, stepId),
      tag,
      operation: operationFor(inputValue, outputValue, duplicate),
      input_value: inputValue,
      delta,
      output_value: outputValue,
      ...(element.calculation_formula ? { formula: element.calculation_formula } : {}),
      source: outputValue === null ? 'unresolved' : 'runtime_output',
    });
    if (outputValue !== null) {
      previousValue = outputValue;
    }
  }
  const overwrites = buildOverwrites(bars);
  const lanes = buildRuntimeLanes(model, elements, persistedAnchor);

  return {
    scenario: {
      source: 'runtime_waterfall',
      quote_id: typeof selectorResolution?.quote_id === 'string' ? selectorResolution.quote_id : null,
      line_id: typeof selectorResolution?.resolved_line_id === 'string' ? selectorResolution.resolved_line_id : null,
    },
    procedure: model.procedure,
    bars,
    lanes,
    overwrites,
    context_mappings: model.context_mappings,
    unresolved: bars.filter((bar) => bar.source === 'unresolved').map((bar) => `${bar.label}: no numeric output value found`),
  };
}

function buildFixtureExample(model: WaterfallModel, valueMap: Record<string, number>): WaterfallExample {
  const mutableValues = { ...valueMap };
  const bars: WaterfallBar[] = [];
  let previousValue: number | null = null;

  for (const [index, formula] of model.formulas.entries()) {
    const evaluation = evaluateFormula(formula.source, mutableValues);
    const tag = formula.writes[0] ?? model.procedure.focus_tag;
    const outputValue = evaluation.value;
    if (tag && outputValue !== null) {
      mutableValues[tag] = outputValue;
    }
    const duplicate = Boolean(tag && bars.some((bar) => bar.tag && normalizedContextKey(bar.tag) === normalizedContextKey(tag)));
    bars.push({
      id: `bar:${index + 1}`,
      step_id: formula.step_id,
      label: stepLabel(model, formula.step_id),
      tag,
      operation: operationFor(previousValue, outputValue, duplicate),
      input_value: previousValue,
      delta: previousValue !== null && outputValue !== null ? outputValue - previousValue : outputValue,
      output_value: outputValue,
      formula: formula.source,
      source: evaluation.ok ? 'calculated' : 'unresolved',
    });
    if (outputValue !== null) {
      previousValue = outputValue;
    }
  }

  if (bars.length === 0) {
    const focusTag = model.procedure.focus_tag;
    const value = focusTag ? mutableValues[focusTag] ?? null : null;
    bars.push({
      id: 'bar:1',
      step_id: null,
      label: focusTag ?? 'Example Value',
      tag: focusTag,
      operation: 'base',
      input_value: null,
      delta: value,
      output_value: value,
      source: value === null ? 'unresolved' : 'fixture_value',
    });
  }
  const overwrites = buildOverwrites(bars);
  const laneBars = [...bars];
  appendFinalLaneBar(
    laneBars,
    normalizedContextKey(model.procedure.focus_tag ?? 'pricing').toLowerCase(),
    model.procedure.focus_tag ?? 'Pricing',
    `${model.procedure.focus_tag ?? 'Pricing'} Waterfall`,
  );

  return {
    scenario: { source: 'fixture_values', quote_id: null, line_id: null },
    procedure: model.procedure,
    bars,
    lanes: [{
      id: normalizedContextKey(model.procedure.focus_tag ?? 'pricing').toLowerCase(),
      label: `${model.procedure.focus_tag ?? 'Pricing'} Waterfall`,
      tracked_tag: model.procedure.focus_tag ?? 'Pricing',
      bars: laneBars,
      source_tags: Array.from(new Set(bars.map((bar) => bar.tag).filter((tag): tag is string => Boolean(tag)))),
      excluded_raw_step_count: 0,
      warnings: [],
    }],
    overwrites,
    context_mappings: model.context_mappings,
    unresolved: bars.filter((bar) => bar.source === 'unresolved').map((bar) => `${bar.label}: could not resolve formula or value`),
  };
}

export function runWaterfallExample(args: WaterfallExampleArgs, startedAt: number): Envelope<WaterfallExample> {
  if (Boolean(args.values) === Boolean(args.runtimeWaterfall)) {
    throw new PricingCliError(
      'invalid_selector_format',
      'waterfall-example requires exactly one of --values or --runtime-waterfall.',
      { values: args.values ?? null, runtime_waterfall: args.runtimeWaterfall ?? null },
      'Pass one value source.',
    );
  }

  const model = unwrapEnvelopeResult<WaterfallModel>(readJsonFile<unknown>(args.model));
  const example = args.runtimeWaterfall
    ? buildRuntimeExample(model, readJsonFile<unknown>(args.runtimeWaterfall))
    : buildFixtureExample(model, valuesFromFile(args.values));
  const warnings = example.unresolved.length > 0
    ? [
        makeNotice(
          'waterfall_values_unresolved',
          'Some waterfall values could not be resolved.',
          { unresolved: example.unresolved },
          'Use runtime waterfall evidence or provide more input values.',
        ),
      ]
    : [];

  return makeEnvelope(
    'waterfall-example',
    makeSummary(
      args.model,
      warnings.length > 0 ? 'Waterfall example completed with unresolved values.' : 'Waterfall example completed.',
      {
        bar_count: example.bars.length,
        overwrite_count: example.overwrites.length,
        unresolved_count: example.unresolved.length,
      },
      'render-waterfall-html',
    ),
    example,
    {
      status: warnings.length > 0 ? 'warn' : 'ok',
      warnings,
      source_files: [args.model, ...(args.values ? [args.values] : []), ...(args.runtimeWaterfall ? [args.runtimeWaterfall] : [])],
      selector_input: { source: example.scenario.source },
      started_at: startedAt,
    },
  );
}
