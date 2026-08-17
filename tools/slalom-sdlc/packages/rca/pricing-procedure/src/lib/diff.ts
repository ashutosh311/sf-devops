import { makeEnvelope, makeNotice, makeSummary } from './contracts/envelope';
import { PricingCliError } from './contracts/errors';
import type {
  Envelope,
  Notice,
  NormalizedProcedureArtifact,
  NormalizedProcedureParameter,
  NormalizedProcedureStep,
  NormalizedProcedureVersion,
} from './contracts/types';
import { normalizedContextKey, relatedFamilyMembers } from './domain/context_families';
import { selectVersions } from './domain/selectors';
import { loadExpressionSet } from './parsing/normalize/procedure';

type DiffMode = 'two_files' | 'single_file_two_versions';

type FailChoice = 'none' | 'warn' | 'changed' | 'partial' | 'no_match' | 'unsupported';

export interface DiffArgs {
  file?: string;
  left?: string;
  right?: string;
  versionLeft?: string;
  versionRight?: string;
  tag?: string;
  compact: boolean;
  verbose: boolean;
  includeChangeBuckets: boolean;
  includeRaw: boolean;
  json: boolean;
  failOn: FailChoice;
}

interface StepSignature {
  label: string | null;
  description: string | null;
  actionType: string | null;
  stepType: string | null;
  sequenceNumber: string | null;
  parentStep: string | null;
  resultIncluded: string | null;
}

interface ParameterSignature {
  name: string | null;
  type: string | null;
  input: string | null;
  output: string | null;
  value: string | null;
}

interface ParameterChange {
  kind: 'added' | 'removed';
  left?: ParameterSignature;
  right?: ParameterSignature;
}

interface VersionMetadataChange {
  field: string;
  left: string | null;
  right: string | null;
}

interface StepSide<T> {
  step: string;
  left?: T;
  right?: T;
}

interface ParameterChangesByStep {
  step: string;
  changes: ParameterChange[];
}

interface SymbolChangesByStep {
  step: string;
  left: string[];
  right: string[];
}

interface DiffChangeBuckets {
  version_metadata_changes: VersionMetadataChange[];
  step_additions: Array<StepSide<StepSignature>>;
  step_removals: Array<StepSide<StepSignature>>;
  step_shell_changes: Array<{ step: string; left: StepSignature; right: StepSignature }>;
  parameter_changes: ParameterChangesByStep[];
  output_symbol_changes: SymbolChangesByStep[];
  context_surface_changes: SymbolChangesByStep[];
  lookup_surface_changes: SymbolChangesByStep[];
}

interface ValueCountRow {
  value: string;
  reference_count: number;
}

interface CompactSummary {
  version_metadata_summary: {
    left_version: VersionMetadataSummaryRow;
    right_version: VersionMetadataSummaryRow;
    changed_fields: string[];
  };
  changed_steps_summary: {
    step_additions: string[];
    step_removals: string[];
    changed_step_names: string[];
    changed_step_categories: string[];
  };
  changed_context_tag_summary: {
    top_left_values: ValueCountRow[];
    top_right_values: ValueCountRow[];
  };
  changed_lookup_surface_summary: {
    top_left_lookup_names: ValueCountRow[];
    top_right_lookup_names: ValueCountRow[];
  };
}

interface VersionMetadataSummaryRow {
  fullName: string | null;
  status: string | null;
  rank: string | null;
  startDate: string | null;
}

interface TraceFormulaDetail {
  parameter_name: string | null;
  expression: string;
  output_context_tags: string[];
}

interface TraceElement {
  element_name: string | null;
  role: string;
  action_type: string | null;
  step_type: string | null;
  effective_order_index: number | null;
  reads_context_tags: string[];
  writes_context_tags: string[];
  formula_details: TraceFormulaDetail[];
  parent_step: string | null;
}

interface TraceResult {
  producer_elements: TraceElement[];
  consumer_elements: TraceElement[];
  formula_elements: TraceElement[];
  related_context_tags: string[];
}

interface TagFlowSummary {
  changed_steps_touching_requested_tag: string[];
  changed_formula_expressions_touching_requested_tag: Array<{
    element_name: string | null;
    parameter_name: string | null;
    change_kind: 'added_or_removed_formula_reference';
  }>;
  changed_related_context_tags: Array<{
    context_tag: string;
    change_kind: 'added' | 'removed' | 'changed_nearby_surface';
  }>;
  adjacent_semantic_impacts: Array<{
    changed_surface: string;
    impact_kind:
      | 'nearby_formula_change'
      | 'nearby_total_family_change'
      | 'nearby_discount_metadata_change'
      | 'nearby_lookup_binding_change'
      | 'nearby_related_surface_change';
    why_it_matters: string;
    recommended_inspect_step: string;
  }>;
  unchanged_trace_shape: boolean;
  recommended_follow_up: string[];
}

interface DiffResult {
  left: string;
  right: string;
  diff_mode: DiffMode;
  requested_tag: string | null;
  change_counts: Record<keyof DiffChangeBuckets, number> | Record<string, never>;
  version_metadata_summary: CompactSummary['version_metadata_summary'] | Record<string, never>;
  changed_steps_summary: CompactSummary['changed_steps_summary'] | Record<string, never>;
  changed_context_tag_summary: CompactSummary['changed_context_tag_summary'] | Record<string, never>;
  changed_lookup_surface_summary: CompactSummary['changed_lookup_surface_summary'] | Record<string, never>;
  tag_flow_summary: TagFlowSummary | null;
  evidence_expansion_paths: string[];
  recommended_next_commands: string[];
  change_buckets?: DiffChangeBuckets;
  tag_filtered_change_buckets?: DiffChangeBuckets;
  verbose_payloads?: {
    left_version: NormalizedProcedureVersion;
    right_version: NormalizedProcedureVersion;
  };
}

const LOOKUP_PARAMETER_NAMES = new Set(['LookUpApiName', 'LookUpName', 'LookupApiName', 'LookupName']);
const TOTAL_FAMILY_HINTS = ['total', 'subtotal'] as const;
const FORMULA_PARAMETER_NAME_HINTS = ['sectionjsonstring', 'conditionjsonstring', 'expression', 'formula'] as const;

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

function stepSignature(step: NormalizedProcedureStep): StepSignature {
  return {
    label: step.label,
    description: step.description,
    actionType: step.actionType,
    stepType: step.stepType,
    sequenceNumber: step.sequenceNumber,
    parentStep: step.parentStep,
    resultIncluded: step.resultIncluded,
  };
}

function parameterSignature(parameter: NormalizedProcedureParameter): ParameterSignature {
  return {
    name: parameter.name,
    type: parameter.type,
    input: parameter.input,
    output: parameter.output,
    value: parameter.value,
  };
}

function topCounts(values: readonly string[], limit = 10): ValueCountRow[] {
  const counts = new Map<string, number>();
  for (const value of values) {
    if (!value) {
      continue;
    }
    counts.set(value, (counts.get(value) ?? 0) + 1);
  }

  return Array.from(counts.entries())
    .sort((left, right) => {
      const countDelta = right[1] - left[1];
      if (countDelta !== 0) {
        return countDelta;
      }
      return left[0].localeCompare(right[0]);
    })
    .slice(0, limit)
    .map(([value, reference_count]) => ({ value, reference_count }));
}

function summarizeChangeBuckets(
  changeBuckets: DiffChangeBuckets,
  leftVersion: NormalizedProcedureVersion,
  rightVersion: NormalizedProcedureVersion,
): CompactSummary {
  const metadataFields = changeBuckets.version_metadata_changes.map((row) => row.field);
  const stepAdditions = changeBuckets.step_additions.map((row) => row.step);
  const stepRemovals = changeBuckets.step_removals.map((row) => row.step);

  const changedStepNames = Array.from(
    new Set(
      [
        ...changeBuckets.step_shell_changes,
        ...changeBuckets.parameter_changes,
        ...changeBuckets.output_symbol_changes,
        ...changeBuckets.context_surface_changes,
        ...changeBuckets.lookup_surface_changes,
      ].map((row) => row.step),
    ),
  ).sort((left, right) => left.localeCompare(right));

  const changedStepCategories = [
    ['step_shell_changes', 'step_shell'],
    ['parameter_changes', 'parameter'],
    ['output_symbol_changes', 'output_context_tag'],
    ['context_surface_changes', 'context_surface'],
    ['lookup_surface_changes', 'lookup_surface'],
  ]
    .flatMap(([bucketName, category]) =>
      changeBuckets[bucketName as keyof DiffChangeBuckets].length > 0 ? [category] : [],
    )
    .sort((left, right) => left.localeCompare(right));

  const leftContextTags: string[] = [];
  const rightContextTags: string[] = [];
  for (const row of [...changeBuckets.output_symbol_changes, ...changeBuckets.context_surface_changes]) {
    leftContextTags.push(...row.left);
    rightContextTags.push(...row.right);
  }

  const leftLookupNames: string[] = [];
  const rightLookupNames: string[] = [];
  for (const row of changeBuckets.lookup_surface_changes) {
    leftLookupNames.push(...row.left);
    rightLookupNames.push(...row.right);
  }

  return {
    version_metadata_summary: {
      left_version: {
        fullName: leftVersion.fullName,
        status: leftVersion.status,
        rank: leftVersion.rank,
        startDate: leftVersion.startDate,
      },
      right_version: {
        fullName: rightVersion.fullName,
        status: rightVersion.status,
        rank: rightVersion.rank,
        startDate: rightVersion.startDate,
      },
      changed_fields: metadataFields,
    },
    changed_steps_summary: {
      step_additions: stepAdditions,
      step_removals: stepRemovals,
      changed_step_names: changedStepNames,
      changed_step_categories: changedStepCategories,
    },
    changed_context_tag_summary: {
      top_left_values: topCounts(leftContextTags),
      top_right_values: topCounts(rightContextTags),
    },
    changed_lookup_surface_summary: {
      top_left_lookup_names: topCounts(leftLookupNames),
      top_right_lookup_names: topCounts(rightLookupNames),
    },
  };
}

function diffVersions(
  left: NormalizedProcedureVersion,
  right: NormalizedProcedureVersion,
): {
  changeBuckets: DiffChangeBuckets;
  changeCounts: Record<keyof DiffChangeBuckets, number>;
  compactSummary: CompactSummary;
} {
  const buckets: DiffChangeBuckets = {
    version_metadata_changes: [],
    step_additions: [],
    step_removals: [],
    step_shell_changes: [],
    parameter_changes: [],
    output_symbol_changes: [],
    context_surface_changes: [],
    lookup_surface_changes: [],
  };

  const leftMeta = {
    fullName: left.fullName,
    status: left.status,
    rank: left.rank,
    startDate: left.startDate,
    label: left.label,
    description: left.description,
    processType: left.processType,
    interfaceSourceType: left.interfaceSourceType,
    decimalScale: left.decimalScale,
  };
  const rightMeta = {
    fullName: right.fullName,
    status: right.status,
    rank: right.rank,
    startDate: right.startDate,
    label: right.label,
    description: right.description,
    processType: right.processType,
    interfaceSourceType: right.interfaceSourceType,
    decimalScale: right.decimalScale,
  };

  for (const key of Array.from(new Set([...Object.keys(leftMeta), ...Object.keys(rightMeta)])).sort((a, b) => a.localeCompare(b))) {
    const leftValue = leftMeta[key as keyof typeof leftMeta] ?? null;
    const rightValue = rightMeta[key as keyof typeof rightMeta] ?? null;
    if (leftValue !== rightValue) {
      buckets.version_metadata_changes.push({ field: key, left: leftValue, right: rightValue });
    }
  }

  const leftSteps = new Map(left.steps.map((step) => [step.name ?? `xml#${step.xml_index}`, step]));
  const rightSteps = new Map(right.steps.map((step) => [step.name ?? `xml#${step.xml_index}`, step]));
  const stepNames = Array.from(
    new Set([...Array.from(leftSteps.keys()), ...Array.from(rightSteps.keys())]),
  ).sort((a, b) => a.localeCompare(b));

  for (const name of stepNames) {
    const leftStep = leftSteps.get(name);
    const rightStep = rightSteps.get(name);
    if (!leftStep && rightStep) {
      buckets.step_additions.push({ step: name, right: stepSignature(rightStep) });
      continue;
    }
    if (leftStep && !rightStep) {
      buckets.step_removals.push({ step: name, left: stepSignature(leftStep) });
      continue;
    }
    if (!leftStep || !rightStep) {
      continue;
    }

    const leftShell = stepSignature(leftStep);
    const rightShell = stepSignature(rightStep);
    if (JSON.stringify(leftShell) !== JSON.stringify(rightShell)) {
      buckets.step_shell_changes.push({ step: name, left: leftShell, right: rightShell });
    }

    const leftParams = new Map(
      leftStep.parameters.map((parameter) => [
        JSON.stringify([
          parameter.name,
          parameter.value,
          parameter.type,
          parameter.input,
          parameter.output,
        ]),
        parameter,
      ]),
    );
    const rightParams = new Map(
      rightStep.parameters.map((parameter) => [
        JSON.stringify([
          parameter.name,
          parameter.value,
          parameter.type,
          parameter.input,
          parameter.output,
        ]),
        parameter,
      ]),
    );

    const paramChanges: ParameterChange[] = [];
    const parameterKeys = Array.from(
      new Set([...Array.from(leftParams.keys()), ...Array.from(rightParams.keys())]),
    ).sort((a, b) => a.localeCompare(b));
    for (const key of parameterKeys) {
      const leftParameter = leftParams.get(key);
      const rightParameter = rightParams.get(key);
      if (!leftParameter && rightParameter) {
        paramChanges.push({ kind: 'added', right: parameterSignature(rightParameter) });
      } else if (leftParameter && !rightParameter) {
        paramChanges.push({ kind: 'removed', left: parameterSignature(leftParameter) });
      }
    }
    if (paramChanges.length > 0) {
      buckets.parameter_changes.push({ step: name, changes: paramChanges });
    }

    const leftOutputs = Array.from(
      new Set(leftStep.parameters.filter((parameter) => parameter.output === 'true' && parameter.value).map((parameter) => parameter.value!)),
    ).sort((a, b) => a.localeCompare(b));
    const rightOutputs = Array.from(
      new Set(rightStep.parameters.filter((parameter) => parameter.output === 'true' && parameter.value).map((parameter) => parameter.value!)),
    ).sort((a, b) => a.localeCompare(b));
    if (JSON.stringify(leftOutputs) !== JSON.stringify(rightOutputs)) {
      buckets.output_symbol_changes.push({ step: name, left: leftOutputs, right: rightOutputs });
    }

    const leftContextValues = Array.from(
      new Set(
        leftStep.parameters
          .map((parameter) => parameter.value)
          .filter((value): value is string => {
            if (!value) {
              return false;
            }
            return value.includes('Price') || value.includes('Subtotal') || value.includes('Waterfall');
          }),
      ),
    ).sort((a, b) => a.localeCompare(b));
    const rightContextValues = Array.from(
      new Set(
        rightStep.parameters
          .map((parameter) => parameter.value)
          .filter((value): value is string => {
            if (!value) {
              return false;
            }
            return value.includes('Price') || value.includes('Subtotal') || value.includes('Waterfall');
          }),
      ),
    ).sort((a, b) => a.localeCompare(b));
    if (JSON.stringify(leftContextValues) !== JSON.stringify(rightContextValues)) {
      buckets.context_surface_changes.push({ step: name, left: leftContextValues, right: rightContextValues });
    }

    const leftLookupNames = Array.from(
      new Set(
        leftStep.parameters
          .filter((parameter) => parameter.value && LOOKUP_PARAMETER_NAMES.has(parameter.name ?? ''))
          .map((parameter) => parameter.value!),
      ),
    ).sort((a, b) => a.localeCompare(b));
    const rightLookupNames = Array.from(
      new Set(
        rightStep.parameters
          .filter((parameter) => parameter.value && LOOKUP_PARAMETER_NAMES.has(parameter.name ?? ''))
          .map((parameter) => parameter.value!),
      ),
    ).sort((a, b) => a.localeCompare(b));
    if (JSON.stringify(leftLookupNames) !== JSON.stringify(rightLookupNames)) {
      buckets.lookup_surface_changes.push({ step: name, left: leftLookupNames, right: rightLookupNames });
    }
  }

  const changeCounts = Object.fromEntries(
    Object.entries(buckets).map(([bucketName, rows]) => [bucketName, rows.length]),
  ) as Record<keyof DiffChangeBuckets, number>;
  const compactSummary = summarizeChangeBuckets(buckets, left, right);
  return { changeBuckets: buckets, changeCounts, compactSummary };
}

function isJsonLike(value: string): boolean {
  const trimmed = value.trim();
  return trimmed.startsWith('{') || trimmed.startsWith('[');
}

function collectStringLeaves(payload: unknown, collector: string[]): void {
  if (typeof payload === 'string') {
    collector.push(payload);
    return;
  }
  if (Array.isArray(payload)) {
    for (const item of payload) {
      collectStringLeaves(item, collector);
    }
    return;
  }
  if (payload && typeof payload === 'object') {
    for (const value of Object.values(payload)) {
      collectStringLeaves(value, collector);
    }
  }
}

function matchingContextTags(values: readonly string[], requestedTag: string): string[] {
  const requestedKey = normalizedContextKey(requestedTag);
  const familyKeys = new Set(relatedFamilyMembers(requestedTag).map((member) => normalizedContextKey(member)));
  return Array.from(
    new Set(
      values.filter((value) => {
        const normalized = normalizedContextKey(value);
        return normalized === requestedKey || familyKeys.has(normalized);
      }),
    ),
  ).sort((left, right) => left.localeCompare(right));
}

function extractFormulaDetails(step: NormalizedProcedureStep, requestedTag: string): TraceFormulaDetail[] {
  const details: TraceFormulaDetail[] = [];
  for (const parameter of step.parameters) {
    const parameterName = (parameter.name ?? '').toLowerCase();
    const parameterValue = parameter.value ?? '';
    if (!parameterValue) {
      continue;
    }
    if (!FORMULA_PARAMETER_NAME_HINTS.some((hint) => parameterName.includes(hint)) && !isJsonLike(parameterValue)) {
      continue;
    }

    const candidateTags: string[] = [];
    if (isJsonLike(parameterValue)) {
      try {
        collectStringLeaves(JSON.parse(parameterValue), candidateTags);
      } catch {
        // Ignore malformed JSON-like payloads to preserve Python behavior.
      }
    }

    const outputContextTags = matchingContextTags(candidateTags, requestedTag);
    if (outputContextTags.length > 0) {
      details.push({
        parameter_name: parameter.name,
        expression: parameterValue,
        output_context_tags: outputContextTags,
      });
    }
  }
  return details;
}

function classifyRole(readsContextTags: readonly string[], writesContextTags: readonly string[], formulaDetails: readonly TraceFormulaDetail[]): string {
  if (readsContextTags.length > 0 && writesContextTags.length > 0) {
    if (JSON.stringify([...readsContextTags].sort()) === JSON.stringify([...writesContextTags].sort())) {
      return 'passthrough';
    }
    return 'transformer';
  }
  if (writesContextTags.length > 0) {
    return 'producer';
  }
  if (readsContextTags.length > 0 || formulaDetails.length > 0) {
    return 'consumer';
  }
  return 'consumer';
}

function traceContextTag(version: NormalizedProcedureVersion, requestedTag: string): TraceResult {
  const requestedKey = normalizedContextKey(requestedTag);
  const familyMemberKeys = new Set(relatedFamilyMembers(requestedTag).map((member) => normalizedContextKey(member)));
  const producerElements: TraceElement[] = [];
  const consumerElements: TraceElement[] = [];
  const formulaElements: TraceElement[] = [];
  const allElements: TraceElement[] = [];
  const relatedContextTags = new Set<string>();

  for (const step of version.steps) {
    const reads = Array.from(
      new Set(
        step.parameters
          .filter(
            (parameter) => parameter.input === 'true' && parameter.value && familyMemberKeys.has(normalizedContextKey(parameter.value)),
          )
          .map((parameter) => parameter.value!),
      ),
    ).sort((a, b) => a.localeCompare(b));
    const writes = Array.from(
      new Set(
        step.parameters
          .filter(
            (parameter) => parameter.output === 'true' && parameter.value && familyMemberKeys.has(normalizedContextKey(parameter.value)),
          )
          .map((parameter) => parameter.value!),
      ),
    ).sort((a, b) => a.localeCompare(b));
    const formulaDetails = extractFormulaDetails(step, requestedTag);
    if (reads.length === 0 && writes.length === 0 && formulaDetails.length === 0) {
      continue;
    }

    const effectiveOrder = (step as NormalizedProcedureStep & { effective_order?: { index?: number } }).effective_order;
    const element: TraceElement = {
      element_name: step.name,
      role: classifyRole(reads, writes, formulaDetails),
      action_type: step.actionType,
      step_type: step.stepType,
      effective_order_index: effectiveOrder?.index ?? null,
      reads_context_tags: reads,
      writes_context_tags: writes,
      formula_details: formulaDetails,
      parent_step: step.parentStep,
    };

    if (writes.length > 0) {
      producerElements.push(element);
    }
    if (reads.length > 0) {
      consumerElements.push(element);
    }
    if (formulaDetails.length > 0) {
      formulaElements.push(element);
    }
    allElements.push(element);

    for (const tag of [...reads, ...writes]) {
      if (normalizedContextKey(tag) !== requestedKey) {
        relatedContextTags.add(tag);
      }
    }
    for (const detail of formulaDetails) {
      for (const tag of detail.output_context_tags) {
        if (normalizedContextKey(tag) !== requestedKey) {
          relatedContextTags.add(tag);
        }
      }
    }
  }

  const sorter = (left: TraceElement, right: TraceElement): number => {
    const leftIndex = left.effective_order_index ?? 999999;
    const rightIndex = right.effective_order_index ?? 999999;
    if (leftIndex !== rightIndex) {
      return leftIndex - rightIndex;
    }
    return (left.element_name ?? '').localeCompare(right.element_name ?? '');
  };

  producerElements.sort(sorter);
  consumerElements.sort(sorter);
  formulaElements.sort(sorter);
  allElements.sort(sorter);

  return {
    producer_elements: producerElements,
    consumer_elements: consumerElements,
    formula_elements: formulaElements,
    related_context_tags: Array.from(relatedContextTags).sort((a, b) => a.localeCompare(b)),
  };
}

function elementsByName(traceResult: TraceResult): Map<string, TraceElement> {
  const rows = new Map<string, TraceElement>();
  for (const bucketName of ['producer_elements', 'consumer_elements'] as const) {
    for (const element of traceResult[bucketName]) {
      if (element.element_name) {
        rows.set(element.element_name, element);
      }
    }
  }
  return rows;
}

function elementSignature(element?: TraceElement): Record<string, unknown> {
  return {
    element_name: element?.element_name ?? null,
    role: element?.role ?? null,
    action_type: element?.action_type ?? null,
    step_type: element?.step_type ?? null,
    effective_order_index: element?.effective_order_index ?? null,
    reads_context_tags: [...(element?.reads_context_tags ?? [])],
    writes_context_tags: [...(element?.writes_context_tags ?? [])],
    parent_step: element?.parent_step ?? null,
  };
}

function looksLikeContextTag(value: string | null | undefined): value is string {
  if (!value || value.length < 4) {
    return false;
  }
  if (value.startsWith('{') || value.startsWith('[') || value.includes(' ')) {
    return false;
  }
  if (value.includes('Decision') || value.startsWith('Constant_')) {
    return false;
  }
  return ['Price', 'Total', 'Subtotal', 'Waterfall'].some((token) => value.includes(token));
}

function formulaMarkers(traceResult: TraceResult): Map<string, { element_name: string | null; parameter_name: string | null }> {
  const markers = new Map<string, { element_name: string | null; parameter_name: string | null }>();
  for (const element of traceResult.formula_elements) {
    for (const detail of element.formula_details) {
      const marker = JSON.stringify([element.element_name, detail.parameter_name, detail.expression]);
      markers.set(marker, {
        element_name: element.element_name,
        parameter_name: detail.parameter_name,
      });
    }
  }
  return markers;
}

function tagFilteredChangeBuckets(changeBuckets: DiffChangeBuckets, changedSteps: readonly string[]): DiffChangeBuckets {
  const changedStepSet = new Set(changedSteps);
  return {
    version_metadata_changes: changeBuckets.version_metadata_changes,
    step_additions: changeBuckets.step_additions.filter((row) => changedStepSet.has(row.step)),
    step_removals: changeBuckets.step_removals.filter((row) => changedStepSet.has(row.step)),
    step_shell_changes: changeBuckets.step_shell_changes.filter((row) => changedStepSet.has(row.step)),
    parameter_changes: changeBuckets.parameter_changes.filter((row) => changedStepSet.has(row.step)),
    output_symbol_changes: changeBuckets.output_symbol_changes.filter((row) => changedStepSet.has(row.step)),
    context_surface_changes: changeBuckets.context_surface_changes.filter((row) => changedStepSet.has(row.step)),
    lookup_surface_changes: changeBuckets.lookup_surface_changes.filter((row) => changedStepSet.has(row.step)),
  };
}

function impactKindForRow(row: { parameter_changes: ParameterChange[]; lookup_changes?: SymbolChangesByStep }, relatedValues: readonly string[]): TagFlowSummary['adjacent_semantic_impacts'][number]['impact_kind'] {
  if (
    row.parameter_changes.some(
      (change) => change.left?.type === 'Formula' || change.right?.type === 'Formula',
    )
  ) {
    return 'nearby_formula_change';
  }
  if (relatedValues.some((value) => TOTAL_FAMILY_HINTS.some((hint) => normalizedContextKey(value).includes(hint)))) {
    return 'nearby_total_family_change';
  }
  if (relatedValues.some((value) => value.toLowerCase().includes('discount'))) {
    return 'nearby_discount_metadata_change';
  }
  if (row.lookup_changes) {
    return 'nearby_lookup_binding_change';
  }
  return 'nearby_related_surface_change';
}

function whyItMatters(requestedTag: string, relatedValues: readonly string[], unchangedTraceShape: boolean): string {
  if (relatedValues.length > 0) {
    const leading = relatedValues.slice(0, 2).join(', ');
    if (unchangedTraceShape) {
      return `Direct ${requestedTag} trace shape is unchanged, but ${leading} changed nearby and can still alter the same pricing outcome.`;
    }
    return `${leading} changed on a nearby surface that still affects the requested pricing outcome.`;
  }
  if (unchangedTraceShape) {
    return `Direct ${requestedTag} trace shape is unchanged, but the nearby changed surface still warrants review before treating the pricing outcome as stable.`;
  }
  return 'Nearby semantic drift still matters for the requested pricing outcome.';
}

function buildAdjacentSemanticImpacts(
  changeBuckets: DiffChangeBuckets | null,
  requestedTag: string,
  unchangedTraceShape: boolean,
): TagFlowSummary['adjacent_semantic_impacts'] {
  if (!changeBuckets) {
    return [];
  }

  const parameterChangesByStep = new Map(changeBuckets.parameter_changes.map((row) => [row.step, row.changes]));
  const contextChangesByStep = new Map<string, { left: string[]; right: string[] }>();
  for (const bucketName of ['context_surface_changes', 'output_symbol_changes'] as const) {
    for (const row of changeBuckets[bucketName]) {
      const existing = contextChangesByStep.get(row.step) ?? { left: [], right: [] };
      existing.left.push(...row.left);
      existing.right.push(...row.right);
      contextChangesByStep.set(row.step, existing);
    }
  }
  const lookupChangesByStep = new Map(changeBuckets.lookup_surface_changes.map((row) => [row.step, row]));

  const requestedFamily = new Set(relatedFamilyMembers(requestedTag).map((member) => normalizedContextKey(member)));
  const candidateSteps = Array.from(
    new Set([
      ...Array.from(parameterChangesByStep.keys()),
      ...Array.from(contextChangesByStep.keys()),
      ...Array.from(lookupChangesByStep.keys()),
    ]),
  ).sort((a, b) => a.localeCompare(b));

  return candidateSteps
    .flatMap((stepName) => {
      const contextChanges = contextChangesByStep.get(stepName) ?? { left: [], right: [] };
      const nearbyValues = Array.from(
        new Set(
          [...contextChanges.left, ...contextChanges.right].filter(
            (value): value is string => looksLikeContextTag(value) && !requestedFamily.has(normalizedContextKey(value)),
          ),
        ),
      ).sort((a, b) => a.localeCompare(b));
      const parameterChanges = parameterChangesByStep.get(stepName) ?? [];
      const lookupChange = lookupChangesByStep.get(stepName);
      const hasFormulaChange = parameterChanges.some(
        (change) => change.left?.type === 'Formula' || change.right?.type === 'Formula',
      );
      if (nearbyValues.length === 0 && !lookupChange && !hasFormulaChange) {
        return [];
      }
      const impactKind = impactKindForRow(
        { parameter_changes: parameterChanges, lookup_changes: lookupChange },
        nearbyValues,
      );
      return [
        {
          changed_surface: stepName,
          impact_kind: impactKind,
          why_it_matters: whyItMatters(requestedTag, nearbyValues, unchangedTraceShape),
          recommended_inspect_step: `inspect-step --step-name ${stepName}`,
          _rank: [impactKind === 'nearby_formula_change' ? 0 : 1, nearbyValues.length > 0 ? 0 : 1, stepName] as const,
        },
      ];
    })
    .sort((left, right) => {
      if (left._rank[0] !== right._rank[0]) {
        return left._rank[0] - right._rank[0];
      }
      if (left._rank[1] !== right._rank[1]) {
        return left._rank[1] - right._rank[1];
      }
      return left._rank[2].localeCompare(right._rank[2]);
    })
    .slice(0, 3)
    .map(({ _rank, ...rest }) => rest);
}

function summarizeTagFlowDiff(
  leftVersion: NormalizedProcedureVersion,
  rightVersion: NormalizedProcedureVersion,
  requestedTag: string,
  includeChangeBuckets: boolean,
  changeBuckets: DiffChangeBuckets,
): {
  tagFlowSummary: TagFlowSummary;
  tagFilteredChangeBuckets: DiffChangeBuckets | null;
} {
  const leftTrace = traceContextTag(leftVersion, requestedTag);
  const rightTrace = traceContextTag(rightVersion, requestedTag);

  const leftElements = elementsByName(leftTrace);
  const rightElements = elementsByName(rightTrace);
  const changedSteps = Array.from(
    new Set([...Array.from(leftElements.keys()), ...Array.from(rightElements.keys())]),
  )
    .filter((name) => JSON.stringify(elementSignature(leftElements.get(name))) !== JSON.stringify(elementSignature(rightElements.get(name))))
    .sort((a, b) => a.localeCompare(b));

  const leftFormulas = formulaMarkers(leftTrace);
  const rightFormulas = formulaMarkers(rightTrace);
  const changedFormulaSteps = Array.from(
    new Set([...Array.from(leftFormulas.keys()), ...Array.from(rightFormulas.keys())]),
  )
    .filter((marker) => !leftFormulas.has(marker) || !rightFormulas.has(marker))
    .map((marker) => {
      const payload = leftFormulas.get(marker) ?? rightFormulas.get(marker)!;
      return {
        element_name: payload.element_name,
        parameter_name: payload.parameter_name,
        change_kind: 'added_or_removed_formula_reference' as const,
      };
    });

  const leftRelated = new Map(leftTrace.related_context_tags.map((tag) => [normalizedContextKey(tag), tag]));
  const rightRelated = new Map(rightTrace.related_context_tags.map((tag) => [normalizedContextKey(tag), tag]));
  const changedRelated: TagFlowSummary['changed_related_context_tags'] = Array.from(
    new Set([...Array.from(leftRelated.keys()), ...Array.from(rightRelated.keys())]),
  )
    .filter((key) => leftRelated.has(key) !== rightRelated.has(key))
    .sort((a, b) => a.localeCompare(b))
    .map((key) => ({
      context_tag: leftRelated.get(key) ?? rightRelated.get(key)!,
      change_kind: rightRelated.has(key) && !leftRelated.has(key) ? 'added' : 'removed',
    }));

  const requestedFamily = new Set(relatedFamilyMembers(requestedTag).map((member) => normalizedContextKey(member)));
  for (const bucketName of ['output_symbol_changes', 'context_surface_changes'] as const) {
    for (const row of changeBuckets[bucketName]) {
      const nearbyValues = Array.from(
        new Set(
          [...row.left, ...row.right].filter(
            (value): value is string => looksLikeContextTag(value) && !requestedFamily.has(normalizedContextKey(value)),
          ),
        ),
      ).sort((a, b) => a.localeCompare(b));
      for (const value of nearbyValues) {
        if (!changedRelated.some((entry) => entry.context_tag === value && entry.change_kind === 'changed_nearby_surface')) {
          changedRelated.push({ context_tag: value, change_kind: 'changed_nearby_surface' });
        }
      }
    }
  }

  const leftShape = Array.from(leftElements.values())
    .map((element) => [
      element.element_name,
      element.role,
      [...element.reads_context_tags],
      [...element.writes_context_tags],
      element.parent_step,
    ])
    .sort((left, right) => JSON.stringify(left).localeCompare(JSON.stringify(right)));
  const rightShape = Array.from(rightElements.values())
    .map((element) => [
      element.element_name,
      element.role,
      [...element.reads_context_tags],
      [...element.writes_context_tags],
      element.parent_step,
    ])
    .sort((left, right) => JSON.stringify(left).localeCompare(JSON.stringify(right)));
  const unchangedTraceShape = JSON.stringify(leftShape) === JSON.stringify(rightShape);
  const adjacentSemanticImpacts = buildAdjacentSemanticImpacts(changeBuckets, requestedTag, unchangedTraceShape);

  const recommendedFollowUp: string[] = [];
  if (changedSteps.length > 0) {
    recommendedFollowUp.push(`inspect-step --step-name ${changedSteps[0]}`);
  } else if (adjacentSemanticImpacts.length > 0) {
    recommendedFollowUp.push(adjacentSemanticImpacts[0].recommended_inspect_step);
  }
  recommendedFollowUp.push(`trace-tag --tag ${requestedTag} --version ${rightVersion.fullName}`);
  if (!unchangedTraceShape) {
    recommendedFollowUp.push(`trace-tag --tag ${requestedTag} --version ${leftVersion.fullName}`);
  }

  return {
    tagFlowSummary: {
      changed_steps_touching_requested_tag: changedSteps,
      changed_formula_expressions_touching_requested_tag: changedFormulaSteps,
      changed_related_context_tags: changedRelated,
      adjacent_semantic_impacts: adjacentSemanticImpacts,
      unchanged_trace_shape: unchangedTraceShape,
      recommended_follow_up: recommendedFollowUp.slice(0, 3),
    },
    tagFilteredChangeBuckets: includeChangeBuckets ? tagFilteredChangeBuckets(changeBuckets, changedSteps) : null,
  };
}

function emptyDiffResult(
  leftSubject: string,
  rightSubject: string,
  diffMode: DiffMode,
  requestedTag?: string,
): DiffResult {
  return {
    left: leftSubject,
    right: rightSubject,
    diff_mode: diffMode,
    requested_tag: requestedTag ?? null,
    change_counts: {},
    version_metadata_summary: {},
    changed_steps_summary: {},
    changed_context_tag_summary: {},
    changed_lookup_surface_summary: {},
    tag_flow_summary: null,
    evidence_expansion_paths: ['diff --include-change-buckets', 'diff --include-raw'],
    recommended_next_commands: ['discover'],
  };
}

function validateDiffMode(args: DiffArgs): void {
  if (args.file && (args.left || args.right)) {
    throw new PricingCliError(
      'invalid_selector_format',
      'diff accepts either --file mode or --left/--right mode, not both.',
      {
        file: args.file,
        left: args.left ?? null,
        right: args.right ?? null,
      },
      'Use one diff mode only.',
    );
  }
  if (!args.file && !args.left && !args.right) {
    throw new PricingCliError(
      'invalid_selector_format',
      'diff requires --file or the --left/--right pair.',
      {},
      'Pass --file <path>, or pass both --left <path> and --right <path>.',
    );
  }
  if (!args.file && (!args.left || !args.right)) {
    throw new PricingCliError(
      'invalid_selector_format',
      'diff requires both --left and --right in two-file mode.',
      {
        left: args.left ?? null,
        right: args.right ?? null,
      },
      'Pass both --left <path> and --right <path>.',
    );
  }
}

export function runDiff(args: DiffArgs, startedAt: number): Envelope<DiffResult> {
  validateDiffMode(args);

  const warnings: Notice[] = [];
  let leftVersions: NormalizedProcedureVersion[];
  let rightVersions: NormalizedProcedureVersion[];
  let diffMode: DiffMode;
  let sourceFiles: string[];
  let leftSubject: string;
  let rightSubject: string;

  if (args.left && args.right) {
    const leftArtifact = loadExpressionSet(args.left);
    const rightArtifact = loadExpressionSet(args.right);
    requirePricingProcedure(leftArtifact, 'diff');
    requirePricingProcedure(rightArtifact, 'diff');
    leftVersions = leftArtifact.versions;
    rightVersions = rightArtifact.versions;
    diffMode = 'two_files';
    sourceFiles = [args.left, args.right];
    leftSubject = args.left;
    rightSubject = args.right;
  } else {
    const artifact = loadExpressionSet(args.file!);
    requirePricingProcedure(artifact, 'diff');
    leftVersions = selectVersions(artifact.versions, args.versionLeft);
    rightVersions = selectVersions(artifact.versions, args.versionRight);
    diffMode = 'single_file_two_versions';
    sourceFiles = [args.file!];
    leftSubject = args.versionLeft ?? '';
    rightSubject = args.versionRight ?? '';
  }

  if (leftVersions.length !== 1 || rightVersions.length !== 1) {
    warnings.push(
      makeNotice(
        'version_not_found',
        'Diff requires exactly one left version and one right version.',
        {
          left_matches: leftVersions.length,
          right_matches: rightVersions.length,
          version_left: args.versionLeft ?? null,
          version_right: args.versionRight ?? null,
        },
        'Use discover to list exact version fullNames and rerun diff.',
      ),
    );

    return makeEnvelope(
      'diff',
      makeSummary(sourceFiles[0], 'No unique diff subjects matched the requested selectors.', {}, 'discover'),
      emptyDiffResult(leftSubject, rightSubject, diffMode, args.tag),
      {
        warnings,
        status: 'no_match',
        source_files: sourceFiles,
        selector_input: {
          version_left: args.versionLeft ?? null,
          version_right: args.versionRight ?? null,
          tag: args.tag ?? null,
        },
        started_at: startedAt,
      },
    );
  }

  const leftVersion = leftVersions[0];
  const rightVersion = rightVersions[0];
  const { changeBuckets, changeCounts, compactSummary } = diffVersions(leftVersion, rightVersion);
  const status = Object.values(changeCounts).some((count) => count > 0) ? 'changed' : 'no_change';

  let tagFlowSummary: TagFlowSummary | null = null;
  let filteredChangeBuckets: DiffChangeBuckets | null = null;
  if (args.tag) {
    const summary = summarizeTagFlowDiff(
      leftVersion,
      rightVersion,
      args.tag,
      args.includeChangeBuckets || args.verbose,
      changeBuckets,
    );
    tagFlowSummary = summary.tagFlowSummary;
    filteredChangeBuckets = summary.tagFilteredChangeBuckets;
  }

  const result: DiffResult = {
    left: leftSubject,
    right: rightSubject,
    diff_mode: diffMode,
    requested_tag: args.tag ?? null,
    change_counts: changeCounts,
    version_metadata_summary: compactSummary.version_metadata_summary,
    changed_steps_summary: compactSummary.changed_steps_summary,
    changed_context_tag_summary: compactSummary.changed_context_tag_summary,
    changed_lookup_surface_summary: compactSummary.changed_lookup_surface_summary,
    tag_flow_summary: tagFlowSummary,
    evidence_expansion_paths: ['diff --include-change-buckets', 'diff --include-raw'],
    recommended_next_commands:
      tagFlowSummary?.recommended_follow_up
      ?? (Object.values(changeCounts).some((count) => count > 0)
        ? ['inspect-step --step-name <changed-step-name>']
        : ['summarize']),
  };

  if (args.includeChangeBuckets || args.verbose) {
    result.change_buckets = changeBuckets;
    if (filteredChangeBuckets) {
      result.tag_filtered_change_buckets = filteredChangeBuckets;
    }
  }
  if (args.includeRaw || args.verbose) {
    result.verbose_payloads = {
      left_version: leftVersion,
      right_version: rightVersion,
    };
  }

  return makeEnvelope(
    'diff',
    makeSummary(sourceFiles[0], 'Diff completed.', changeCounts, Object.values(changeCounts).some((count) => count > 0) ? 'inspect-step' : 'summarize'),
    result,
    {
      warnings,
      status,
      source_files: sourceFiles,
      selector_input: {
        version_left: args.versionLeft ?? null,
        version_right: args.versionRight ?? null,
        tag: args.tag ?? null,
      },
      started_at: startedAt,
    },
  );
}
