import { makeEnvelope, makeNotice, makeSummary } from './contracts/envelope';
import { PricingCliError } from './contracts/errors';
import type {
  Envelope,
  NormalizedProcedureArtifact,
  NormalizedProcedureStep,
  NormalizedProcedureVersion,
} from './contracts/types';
import { familyMatches, normalizedContextKey, relatedFamilyMembers } from './domain/context_families';
import { resolveVersionSelectorWithActiveDefault, selectVersionsWithActiveDefault } from './domain/selectors';
import { loadExpressionSet } from './parsing/normalize/procedure';

const FORMULA_PARAMETER_NAME_HINTS = ['sectionjsonstring', 'conditionjsonstring', 'expression', 'formula'] as const;

const SHARED_SURFACE_FAMILIES = {
  price_waterfall_family: ['PriceWaterfall', 'PriceWaterFall', 'price_water_fall', 'PriceWaterfallIdentifier'],
  subtotal_total_family: ['Subtotal', 'SubTotal', 'ItemNetTotalPrice', 'ItemGrossTotalPrice', 'ItemTotalPrice'],
  price_input_output_family: [
    'InputUnitPrice',
    'ListPrice',
    'NetUnitPrice',
    'RegularUnitPrice',
    'CustomerUnitPrice',
    'SubscriptionNetUnitPrice',
  ],
} as const;

export interface TraceTagArgs {
  file: string;
  tag: string;
  version?: string;
  activeOnly: boolean;
  producerOnly: boolean;
  consumerOnly: boolean;
  includeFormulas: boolean;
  includeFormulaDetails: boolean;
  includeAllElements: boolean;
  includeWaterfallSlice: boolean;
  includeRelatedTags: boolean;
  includeContextHints: boolean;
  maxElements?: number;
  json: boolean;
  failOn: 'none' | 'warn' | 'changed' | 'partial' | 'no_match' | 'unsupported';
}

interface FormulaDetail {
  parameter_name: string | null;
  expression: string;
  output_context_tags: string[];
}

interface TraceElement {
  element_type: 'pricing_procedure_step';
  element_name: string | null;
  step_type: string | null;
  action_type: string | null;
  version_full_name: string | null;
  effective_order_index: number | null;
  effective_order_confidence: {
    basis: string | null;
    uncertainty: string | null;
  };
  role: 'passthrough' | 'transformer' | 'producer' | 'consumer';
  reads_context_tags: string[];
  writes_context_tags: string[];
  formula_details: FormulaDetail[];
  parent_step: string | null;
  step_context_values: string[];
}

interface CompactFlowElement {
  element_name: string | null;
  action_type: string | null;
  effective_order_index: number | null;
  parent_step: string | null;
}

export interface FlowSummary {
  initialized_by: CompactFlowElement[];
  explicit_assignment_steps: CompactFlowElement[];
  late_producers: CompactFlowElement[];
  terminal_consumers: CompactFlowElement[];
  passthrough_hotspots: CompactFlowElement[];
  ordered_waterfall_snippet: Array<CompactFlowElement & { stage: string }>;
}

export interface TraceSummary {
  matched_element_count: number;
  scoped_element_count: number;
  producer_count: number;
  consumer_count: number;
  formula_count: number;
  related_context_tag_count: number;
  requested_tag_exact_match: boolean;
  family_relationships: ReturnType<typeof familyMatches>;
  scope: 'producer_only' | 'consumer_only' | 'full';
  returned_key_element_count?: number;
}

interface FormulaDetailRow {
  element_name: string | null;
  parameter_name: string | null;
  expression: string;
  output_context_tags: string[];
}

export interface SharedEditSurface {
  element_name: string | null;
  action_type: string | null;
  effective_order_index: number | null;
  shared_context_tags: string[];
}

export interface ContextHint {
  hint_type: 'ambiguity_family' | 'context_definition_reference';
  family?: string;
  related_context_tags?: string[];
  context_definition?: string;
  note: string;
}

export interface TraceTagResult {
  requested_tag: string;
  trace_summary: TraceSummary | Record<string, never>;
  flow_summary: FlowSummary;
  key_elements: CompactFlowElement[];
  key_formulas: FormulaDetailRow[];
  related_context_tags: string[];
  shared_edit_surfaces: SharedEditSurface[];
  context_hints: ContextHint[];
  evidence_expansion_paths: string[];
  recommended_next_commands: string[];
  producer_elements?: TraceElement[];
  consumer_elements?: TraceElement[];
  waterfall_slice?: TraceElement[];
  formula_elements?: TraceElement[];
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

function isJsonLike(value: string | null | undefined): boolean {
  const trimmed = (value ?? '').trim();
  return trimmed.startsWith('{') || trimmed.startsWith('[');
}

function collectStringLeaves(payload: unknown, collector: string[]): void {
  if (Array.isArray(payload)) {
    for (const item of payload) {
      collectStringLeaves(item, collector);
    }
    return;
  }

  if (payload && typeof payload === 'object') {
    for (const item of Object.values(payload as Record<string, unknown>)) {
      collectStringLeaves(item, collector);
    }
    return;
  }

  if (typeof payload === 'string') {
    collector.push(payload);
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
  ).sort();
}

function extractFormulaDetails(step: NormalizedProcedureStep, requestedTag: string): FormulaDetail[] {
  const details: FormulaDetail[] = [];
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
        collectStringLeaves(JSON.parse(parameterValue) as unknown, candidateTags);
      } catch {
        // Preserve Python behavior: ignore malformed JSON-like formula payloads.
      }
    }

    const outputContextTags = matchingContextTags(candidateTags, requestedTag);
    if (outputContextTags.length === 0) {
      continue;
    }
    details.push({
      parameter_name: parameter.name,
      expression: parameterValue,
      output_context_tags: outputContextTags,
    });
  }
  return details;
}

function stepContextValues(step: NormalizedProcedureStep): string[] {
  const values = new Set<string>();
  for (const parameter of step.parameters) {
    const value = parameter.value;
    if (!value || value.length < 4) {
      continue;
    }
    if (value[0] === '{' || value[0] === '[') {
      continue;
    }
    if (!normalizedContextKey(value)) {
      continue;
    }
    const lowered = value.toLowerCase();
    if (['price', 'total', 'subtotal', 'waterfall'].some((token) => lowered.includes(token))) {
      values.add(value);
    }
  }
  return Array.from(values).sort();
}

function classifyRole(
  readsContextTags: readonly string[],
  writesContextTags: readonly string[],
  formulaDetails: readonly FormulaDetail[],
): TraceElement['role'] {
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

function buildElement(
  version: NormalizedProcedureVersion,
  step: NormalizedProcedureStep,
  role: TraceElement['role'],
  readsContextTags: string[],
  writesContextTags: string[],
  formulaDetails: FormulaDetail[],
): TraceElement {
  const effectiveOrder = (step.effective_order ?? {}) as Record<string, unknown>;
  return {
    element_type: 'pricing_procedure_step',
    element_name: step.name,
    step_type: step.stepType,
    action_type: step.actionType,
    version_full_name: version.fullName,
    effective_order_index: (effectiveOrder.index as number | null | undefined) ?? null,
    effective_order_confidence: {
      basis: (effectiveOrder.basis as string | null | undefined) ?? null,
      uncertainty: (effectiveOrder.uncertainty as string | null | undefined) ?? null,
    },
    role,
    reads_context_tags: readsContextTags,
    writes_context_tags: writesContextTags,
    formula_details: formulaDetails,
    parent_step: step.parentStep,
    step_context_values: stepContextValues(step),
  };
}

function compactFlowElement(element: TraceElement): CompactFlowElement {
  return {
    element_name: element.element_name,
    action_type: element.action_type,
    effective_order_index: element.effective_order_index,
    parent_step: element.parent_step,
  };
}

function isAssignmentStyle(element: TraceElement): boolean {
  return element.action_type === 'AssignmentElement' || (element.formula_details.length > 0 && element.writes_context_tags.length > 0);
}

function orderedWaterfallSnippet(flowSummary: Omit<FlowSummary, 'ordered_waterfall_snippet'>): FlowSummary['ordered_waterfall_snippet'] {
  const snippetCandidates: FlowSummary['ordered_waterfall_snippet'] = [];
  const stageSources: Array<[string, CompactFlowElement[]]> = [
    ['entry', flowSummary.initialized_by.slice(0, 1)],
    ['assignment', flowSummary.explicit_assignment_steps.slice(0, 1)],
    ['late_producer', flowSummary.late_producers.slice(-1)],
    ['terminal', flowSummary.terminal_consumers.slice(-1)],
  ];
  const seen = new Set<string>();

  for (const [stage, items] of stageSources) {
    for (const item of items) {
      const marker = item.element_name;
      if (!marker || seen.has(marker)) {
        continue;
      }
      seen.add(marker);
      snippetCandidates.push({ ...item, stage });
    }
  }

  return snippetCandidates
    .sort(
      (left, right) =>
        (left.effective_order_index ?? 999999) - (right.effective_order_index ?? 999999)
        || (left.element_name ?? '').localeCompare(right.element_name ?? ''),
    )
    .slice(0, 4);
}

function flowSummary(allElements: readonly TraceElement[], requestedTag: string): FlowSummary {
  if (allElements.length === 0) {
    return {
      initialized_by: [],
      explicit_assignment_steps: [],
      late_producers: [],
      terminal_consumers: [],
      passthrough_hotspots: [],
      ordered_waterfall_snippet: [],
    };
  }

  const ordered = [...allElements];
  const requestedKey = normalizedContextKey(requestedTag);
  const base = {
    initialized_by: ordered.filter((item) => item.writes_context_tags.length > 0).slice(0, 2).map(compactFlowElement),
    explicit_assignment_steps: ordered
      .filter((item) => isAssignmentStyle(item) && item.writes_context_tags.length > 0)
      .slice(0, 4)
      .map(compactFlowElement),
    late_producers: ordered
      .slice()
      .reverse()
      .filter((item) => item.writes_context_tags.length > 0 && ['producer', 'transformer', 'passthrough'].includes(item.role))
      .slice(0, 3)
      .reverse()
      .map(compactFlowElement),
    terminal_consumers: ordered
      .slice()
      .reverse()
      .filter(
        (item) =>
          item.reads_context_tags.length > 0
          && (item.writes_context_tags.length === 0
            || !new Set(item.writes_context_tags.map((tag) => normalizedContextKey(tag))).has(requestedKey)),
      )
      .slice(0, 3)
      .reverse()
      .map(compactFlowElement),
    passthrough_hotspots: ordered.filter((item) => item.role === 'passthrough').slice(0, 4).map(compactFlowElement),
  };

  return {
    ...base,
    ordered_waterfall_snippet: orderedWaterfallSnippet(base),
  };
}

function compactFormulaRows(elements: readonly TraceElement[]): FormulaDetailRow[] {
  const rows: FormulaDetailRow[] = [];
  const seen = new Set<string>();
  for (const element of elements) {
    for (const detail of element.formula_details) {
      const marker = JSON.stringify([
        element.version_full_name,
        element.element_name,
        detail.parameter_name,
        detail.expression,
      ]);
      if (seen.has(marker)) {
        continue;
      }
      seen.add(marker);
      rows.push({
        element_name: element.element_name,
        parameter_name: detail.parameter_name,
        expression: detail.expression,
        output_context_tags: detail.output_context_tags,
      });
    }
  }
  return rows;
}

function sharedEditSurfaces(allElements: readonly TraceElement[], requestedTag: string): SharedEditSurface[] {
  const requestedFamily = new Set(relatedFamilyMembers(requestedTag).map((member) => normalizedContextKey(member)));
  const shared: SharedEditSurface[] = [];
  const seen = new Set<string>();
  for (const element of allElements) {
    const sharedContextTags: string[] = [];
    for (const members of Object.values(SHARED_SURFACE_FAMILIES)) {
      const familyNorms = new Set(members.map((member) => normalizedContextKey(member)));
      const matched = Array.from(
        new Set(
          element.step_context_values.filter(
            (value) => familyNorms.has(normalizedContextKey(value)) && !requestedFamily.has(normalizedContextKey(value)),
          ),
        ),
      ).sort();
      if (matched.length > 0) {
        sharedContextTags.push(...matched);
      }
    }
    const deduped = Array.from(new Set(sharedContextTags)).sort();
    if (deduped.length === 0) {
      continue;
    }
    const marker = JSON.stringify([element.element_name, deduped]);
    if (seen.has(marker)) {
      continue;
    }
    seen.add(marker);
    shared.push({
      element_name: element.element_name,
      action_type: element.action_type,
      effective_order_index: element.effective_order_index,
      shared_context_tags: deduped.slice(0, 3),
    });
  }
  return shared.slice(0, 4);
}

function recommendedCommands(requestedTag: string, elements: readonly TraceElement[], includeFormulaDetails = false): string[] {
  const recommended: string[] = [];
  if (elements.length > 0 && elements[0].element_name) {
    recommended.push(`inspect-step --step-name ${elements[0].element_name}`);
  }
  recommended.push(`crosswalk --tag ${requestedTag} --include-mappings`);
  if (includeFormulaDetails) {
    recommended.push(`trace-tag --tag ${requestedTag} --include-formula-details`);
  }
  if (recommended.length === 0) {
    recommended.push('summarize --focus-tag <context-tag>');
  }
  return recommended.slice(0, 3);
}

function defaultKeyElements(scopedElements: readonly TraceElement[], requestedTag: string): CompactFlowElement[] {
  const flow = flowSummary(scopedElements, requestedTag);
  const orderedGroups = [
    flow.initialized_by,
    flow.explicit_assignment_steps,
    flow.late_producers,
    flow.terminal_consumers,
    flow.passthrough_hotspots,
  ];
  const selected: CompactFlowElement[] = [];
  const seen = new Set<string>();
  for (const group of orderedGroups) {
    for (const item of group) {
      const marker = item.element_name;
      if (!marker || seen.has(marker)) {
        continue;
      }
      seen.add(marker);
      selected.push(item);
    }
  }
  if (selected.length === 0) {
    for (const element of scopedElements.slice(0, 6)) {
      const marker = element.element_name;
      if (!marker || seen.has(marker)) {
        continue;
      }
      seen.add(marker);
      selected.push(compactFlowElement(element));
    }
  }
  return selected.slice(0, 8);
}

function evidenceExpansionPaths(requestedTag: string, includeFormulaDetails = false): string[] {
  const paths = [
    `trace-tag --tag ${requestedTag} --include-all-elements`,
    `trace-tag --tag ${requestedTag} --include-waterfall-slice`,
  ];
  if (includeFormulaDetails) {
    paths.push(`trace-tag --tag ${requestedTag} --include-formula-details`);
  }
  return paths;
}

export function traceContextTag(
  artifact: NormalizedProcedureArtifact,
  versions: readonly NormalizedProcedureVersion[],
  requestedTag: string,
  options: {
    producerOnly: boolean;
    consumerOnly: boolean;
    includeFormulaDetails: boolean;
    includeRelatedTags: boolean;
    includeContextHints: boolean;
    includeAllElements: boolean;
    includeWaterfallSlice: boolean;
    maxElements?: number;
  },
): { result: TraceTagResult; warnings: ReturnType<typeof makeNotice>[]; truncated: boolean } {
  const requestedKey = normalizedContextKey(requestedTag);
  const familyMembers = relatedFamilyMembers(requestedTag);
  const familyMemberSet = new Set(familyMembers);
  const familyMemberKeys = new Set(familyMembers.map((member) => normalizedContextKey(member)));
  const producerElements: TraceElement[] = [];
  const consumerElements: TraceElement[] = [];
  const formulaElements: TraceElement[] = [];
  const allElements: TraceElement[] = [];
  const relatedContextTags = new Set<string>();

  for (const version of versions) {
    for (const step of version.steps) {
      const reads = Array.from(
        new Set(
          step.parameters
            .filter(
              (parameter) =>
                parameter.input === 'true'
                && Boolean(parameter.value)
                && familyMemberKeys.has(normalizedContextKey(parameter.value)),
            )
            .map((parameter) => parameter.value as string),
        ),
      ).sort();
      const writes = Array.from(
        new Set(
          step.parameters
            .filter(
              (parameter) =>
                parameter.output === 'true'
                && Boolean(parameter.value)
                && familyMemberKeys.has(normalizedContextKey(parameter.value)),
            )
            .map((parameter) => parameter.value as string),
        ),
      ).sort();
      const formulaDetails = extractFormulaDetails(step, requestedTag);
      if (reads.length === 0 && writes.length === 0 && formulaDetails.length === 0) {
        continue;
      }

      const role = classifyRole(reads, writes, formulaDetails);
      const element = buildElement(version, step, role, reads, writes, formulaDetails);
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
  }

  const byOrder = (left: TraceElement, right: TraceElement): number =>
    (left.effective_order_index ?? 999999) - (right.effective_order_index ?? 999999)
    || (left.element_name ?? '').localeCompare(right.element_name ?? '');
  allElements.sort(byOrder);
  producerElements.sort(byOrder);
  consumerElements.sort(byOrder);
  formulaElements.sort(byOrder);

  let scopedElements = [...allElements];
  if (options.producerOnly) {
    scopedElements = allElements.filter((item) => ['producer', 'transformer', 'passthrough'].includes(item.role));
  } else if (options.consumerOnly) {
    scopedElements = allElements.filter((item) => ['consumer', 'transformer', 'passthrough'].includes(item.role));
  }

  const warnings: ReturnType<typeof makeNotice>[] = [];
  let truncated = false;
  let waterfallSlice = [...scopedElements];
  let keyElementsSource = [...scopedElements];
  if (typeof options.maxElements === 'number' && options.maxElements >= 0 && scopedElements.length > options.maxElements) {
    truncated = true;
    keyElementsSource = scopedElements.slice(0, options.maxElements);
    if (options.includeWaterfallSlice) {
      waterfallSlice = scopedElements.slice(0, options.maxElements);
    }
    warnings.push(
      makeNotice(
        'trace_truncated',
        'trace-tag truncated the requested element evidence to the requested max element count.',
        { max_elements: options.maxElements },
        'Increase --max-elements or rerun with a narrower selector mode.',
      ),
    );
  } else if (options.includeWaterfallSlice) {
    waterfallSlice = [...scopedElements];
  }

  const relatedContextTagList = options.includeRelatedTags
    ? Array.from(relatedContextTags).sort()
    : Array.from(familyMemberSet).filter((member) => normalizedContextKey(member) !== requestedKey).sort();

  const contextHints: ContextHint[] = [];
  if (options.includeContextHints) {
    for (const family of familyMatches(requestedTag)) {
      contextHints.push({
        hint_type: 'ambiguity_family',
        family: family.family,
        related_context_tags: family.members,
        note: 'The context definition may expose adjacent context tags in this family across different nodes or object-layer mappings.',
      });
    }
    for (const contextDefinition of artifact.context_definitions) {
      contextHints.push({
        hint_type: 'context_definition_reference',
        context_definition: contextDefinition,
        note: 'Use crosswalk with this context definition to inspect node and object-layer mappings.',
      });
    }
  }

  const result: TraceTagResult = {
    requested_tag: requestedTag,
    trace_summary: {
      matched_element_count: allElements.length,
      scoped_element_count: scopedElements.length,
      producer_count: producerElements.length,
      consumer_count: consumerElements.length,
      formula_count: formulaElements.length,
      related_context_tag_count: relatedContextTagList.length,
      requested_tag_exact_match: allElements.some(
        (element) =>
          [...element.reads_context_tags, ...element.writes_context_tags].some(
            (tag) => normalizedContextKey(tag) === requestedKey,
          ),
      ),
      family_relationships: familyMatches(requestedTag),
      scope: options.producerOnly ? 'producer_only' : options.consumerOnly ? 'consumer_only' : 'full',
      ...(truncated ? { returned_key_element_count: keyElementsSource.length } : {}),
    },
    flow_summary: flowSummary(scopedElements, requestedTag),
    key_elements: defaultKeyElements(scopedElements, requestedTag),
    key_formulas: compactFormulaRows(keyElementsSource).slice(0, 4),
    related_context_tags: relatedContextTagList.slice(0, 6),
    shared_edit_surfaces: sharedEditSurfaces(scopedElements, requestedTag),
    context_hints: contextHints.slice(0, 1),
    evidence_expansion_paths: evidenceExpansionPaths(requestedTag, true),
    recommended_next_commands: recommendedCommands(requestedTag, keyElementsSource.length > 0 ? keyElementsSource : allElements, true),
  };

  if (options.includeAllElements) {
    result.producer_elements = producerElements;
    result.consumer_elements = consumerElements;
  }
  if (options.includeWaterfallSlice) {
    result.waterfall_slice = waterfallSlice;
  }
  if (options.includeFormulaDetails) {
    result.formula_elements = formulaElements;
  }

  return { result, warnings, truncated };
}

function emptyFlowSummary(): FlowSummary {
  return {
    initialized_by: [],
    explicit_assignment_steps: [],
    late_producers: [],
    terminal_consumers: [],
    passthrough_hotspots: [],
    ordered_waterfall_snippet: [],
  };
}

export function runTraceTag(args: TraceTagArgs, startedAt: number): Envelope<TraceTagResult> {
  const artifact = loadExpressionSet(args.file);
  requirePricingProcedure(artifact, 'trace-tag');
  const versionSelector = resolveVersionSelectorWithActiveDefault(args.version, args.activeOnly);
  const versions = selectVersionsWithActiveDefault(artifact.versions, versionSelector, args.activeOnly);

  if (versions.length === 0) {
    return makeEnvelope(
      'trace-tag',
      makeSummary(args.file, 'No versions matched the requested selector.', {}, 'discover'),
      {
        requested_tag: args.tag,
        trace_summary: {},
        flow_summary: emptyFlowSummary(),
        key_elements: [],
        key_formulas: [],
        related_context_tags: [],
        shared_edit_surfaces: [],
        context_hints: [],
        evidence_expansion_paths: [],
        recommended_next_commands: ['discover'],
      },
      {
        warnings: [
          makeNotice(
            'version_not_found',
            'No versions matched the requested selector.',
            { selector: versionSelector ?? null },
            'Use discover to list available versions.',
          ),
        ],
        status: 'no_match',
        source_files: [args.file],
        selector_input: {
          version: versionSelector ?? null,
          tag: args.tag,
          active_only: args.activeOnly,
        },
        started_at: startedAt,
      },
    );
  }

  const { result, warnings, truncated } = traceContextTag(artifact, versions, args.tag, {
    producerOnly: args.producerOnly,
    consumerOnly: args.consumerOnly,
    includeFormulaDetails: args.includeFormulaDetails || args.includeFormulas,
    includeRelatedTags: args.includeRelatedTags,
    includeContextHints: args.includeContextHints,
    includeAllElements: args.includeAllElements,
    includeWaterfallSlice: args.includeWaterfallSlice,
    maxElements: args.maxElements,
  });

  let status: 'ok' | 'no_match' | 'partial' = 'ok';
  if ((result.trace_summary as TraceSummary).matched_element_count === 0) {
    status = 'no_match';
    warnings.push(
      makeNotice(
        'symbol_not_found',
        'No pricing-procedure elements matched the requested context tag.',
        { tag: args.tag },
        'Use summarize --focus-tag first or inspect nearby context-tag family names.',
      ),
    );
  } else if (truncated) {
    status = 'partial';
  }

  return makeEnvelope(
    'trace-tag',
    makeSummary(
      args.file,
      status === 'no_match' ? 'No pricing-procedure elements matched the requested context tag.' : 'Trace completed.',
      {
        matched_element_count: (result.trace_summary as TraceSummary).matched_element_count ?? 0,
        producer_count: (result.trace_summary as TraceSummary).producer_count ?? 0,
        consumer_count: (result.trace_summary as TraceSummary).consumer_count ?? 0,
      },
      result.key_elements.length > 0 ? 'inspect-step' : 'summarize',
    ),
    result,
    {
      warnings,
      status,
      source_files: [args.file],
      selector_input: {
        version: versionSelector ?? null,
        tag: args.tag,
        active_only: args.activeOnly,
      },
      partial_reason: truncated ? 'trace-tag result truncated by --max-elements' : undefined,
      started_at: startedAt,
    },
  );
}
