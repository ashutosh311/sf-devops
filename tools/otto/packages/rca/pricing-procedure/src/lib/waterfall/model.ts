import { makeEnvelope, makeNotice, makeSummary } from '../contracts/envelope';
import { PricingCliError } from '../contracts/errors';
import type {
  Envelope,
  NormalizedContextDefinition,
  NormalizedProcedureArtifact,
  NormalizedProcedureParameter,
  NormalizedProcedureStep,
  NormalizedProcedureVersion,
} from '../contracts/types';
import { normalizedContextKey, relatedFamilyMembers } from '../domain/context_families';
import { resolveVersionSelectorWithActiveDefault, selectVersionsWithActiveDefault } from '../domain/selectors';
import { loadContextDefinition } from '../parsing/normalize/context';
import { loadExpressionSet } from '../parsing/normalize/procedure';
import { extractFormulaIdentifiers } from './formula-parser';
import type {
  WaterfallContextMapping,
  WaterfallFormula,
  WaterfallGraphEdge,
  WaterfallGraphNode,
  WaterfallModel,
} from './schema';

export interface WaterfallModelArgs {
  file: string;
  context?: string;
  version?: string;
  focusTag?: string;
  includeFormulaDetails: boolean;
  includeAllElements: boolean;
  json: boolean;
  failOn: 'none' | 'warn' | 'changed' | 'partial' | 'no_match' | 'unsupported';
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

function stableId(prefix: string, value: string | null | undefined, fallback: string): string {
  return `${prefix}:${(value ?? fallback).replace(/[^A-Za-z0-9_.:-]+/g, '_')}`;
}

function effectiveOrder(step: NormalizedProcedureStep): number | null {
  const order = (step.effective_order ?? {}) as Record<string, unknown>;
  return typeof order.index === 'number' ? order.index : null;
}

function parameterValues(step: NormalizedProcedureStep, predicate: (parameter: NormalizedProcedureParameter) => boolean): string[] {
  return Array.from(
    new Set(
      step.parameters
        .filter(predicate)
        .map((parameter) => parameter.value)
        .filter((value): value is string => Boolean(value)),
    ),
  ).sort();
}

function collectStringLeaves(payload: unknown, collector: string[]): void {
  if (Array.isArray(payload)) {
    for (const item of payload) {
      collectStringLeaves(item, collector);
    }
    return;
  }
  if (payload && typeof payload === 'object') {
    for (const value of Object.values(payload as Record<string, unknown>)) {
      collectStringLeaves(value, collector);
    }
    return;
  }
  if (typeof payload === 'string') {
    collector.push(payload);
  }
}

function formulaCandidates(step: NormalizedProcedureStep): string[] {
  const formulas = new Set<string>();
  for (const parameter of step.parameters) {
    const name = (parameter.name ?? '').toLowerCase();
    const value = parameter.value?.trim();
    if (!value) {
      continue;
    }
    const stringLeaves: string[] = [];
    if (value.startsWith('{') || value.startsWith('[')) {
      try {
        collectStringLeaves(JSON.parse(value) as unknown, stringLeaves);
      } catch {
        stringLeaves.push(value);
      }
    } else if (name.includes('formula') || name.includes('expression') || name.includes('sectionjsonstring')) {
      stringLeaves.push(value);
    }
    for (const leaf of stringLeaves) {
      if (/^section-\d+-(input|output)/i.test(leaf)) {
        continue;
      }
      const hasArithmeticOperator = /[+*/]/.test(leaf) || /\s-\s/.test(leaf);
      if (hasArithmeticOperator && (/[A-Za-z_][A-Za-z0-9_]*\s*[-+*/]\s*[A-Za-z0-9_(]/.test(leaf) || /\d+\s*[-+*/]\s*[A-Za-z_]/.test(leaf))) {
        formulas.add(leaf);
      }
    }
  }
  return Array.from(formulas).sort();
}

function isContextTagCandidate(value: string): boolean {
  const trimmed = value.trim();
  if (trimmed.length < 3 || trimmed.startsWith('{') || trimmed.startsWith('[')) {
    return false;
  }
  if (/^(true|false|get|set|null)$/i.test(trimmed)) {
    return false;
  }
  if (/^-?\d+(\.\d+)?$/.test(trimmed)) {
    return false;
  }
  if (/^[A-Za-z0-9]{15,18}$/.test(trimmed)) {
    return false;
  }
  if (trimmed.includes(' ')) {
    return false;
  }
  if (/^(constant_|.*_decision_table$|.*_entries$)/i.test(trimmed)) {
    return false;
  }
  return /price|total|quantity|amount|discount|waterfall|lineitem|unit|subtotal|iscontracted/i.test(trimmed);
}

function stepTags(step: NormalizedProcedureStep): { reads: string[]; writes: string[] } {
  const reads = parameterValues(
    step,
    (parameter) => parameter.input === 'true' && Boolean(parameter.value) && isContextTagCandidate(parameter.value as string),
  );
  const writes = parameterValues(
    step,
    (parameter) => parameter.output === 'true' && Boolean(parameter.value) && isContextTagCandidate(parameter.value as string),
  );
  return { reads, writes };
}

function matchesFocus(step: NormalizedProcedureStep, focusTag: string | undefined): boolean {
  if (!focusTag) {
    return true;
  }
  const focusKeys = new Set(relatedFamilyMembers(focusTag).map((member) => normalizedContextKey(member)));
  const { reads, writes } = stepTags(step);
  const formulaTags = formulaCandidates(step).flatMap((formula) => extractFormulaIdentifiers(formula));
  return [...reads, ...writes, ...formulaTags].some((tag) => focusKeys.has(normalizedContextKey(tag)));
}

function pushUnique<T>(items: T[], item: T, key: (value: T) => string): void {
  if (!items.some((existing) => key(existing) === key(item))) {
    items.push(item);
  }
}

function buildContextMappings(context: NormalizedContextDefinition | null, tags: readonly string[]): WaterfallContextMapping[] {
  if (!context) {
    return [];
  }
  const mappings: WaterfallContextMapping[] = [];
  for (const tag of tags) {
    for (const candidate of relatedFamilyMembers(tag)) {
      for (const mapping of context.tag_mapping_index[candidate] ?? []) {
        if (mapping.hydration_details.length === 0) {
          mappings.push({
            context_tag: candidate,
            context_node: mapping.context_node,
            object_name: mapping.context_node_object,
            object_field: mapping.context_input_attribute_name ?? mapping.context_attribute,
          });
          continue;
        }
        for (const detail of mapping.hydration_details) {
          mappings.push({
            context_tag: candidate,
            context_node: mapping.context_node,
            object_name: detail.object_name ?? mapping.context_node_object,
            object_field: detail.query_attribute ?? mapping.context_input_attribute_name ?? mapping.context_attribute,
          });
        }
      }
    }
  }
  return Array.from(
    new Map(
      mappings.map((mapping) => [
        JSON.stringify([mapping.context_tag, mapping.context_node, mapping.object_name, mapping.object_field]),
        mapping,
      ]),
    ).values(),
  ).sort((left, right) => left.context_tag.localeCompare(right.context_tag));
}

export function buildWaterfallModel(input: {
  artifact: NormalizedProcedureArtifact;
  versions: readonly NormalizedProcedureVersion[];
  context: NormalizedContextDefinition | null;
  versionSelector: string | null;
  focusTag?: string;
  includeFormulaDetails: boolean;
  includeAllElements: boolean;
}): WaterfallModel {
  const nodes: WaterfallGraphNode[] = [];
  const edges: WaterfallGraphEdge[] = [];
  const formulas: WaterfallFormula[] = [];
  const touchedTags = new Set<string>();
  const limitations: string[] = [];

  for (const version of input.versions) {
    const steps = version.steps.filter((step) => input.includeAllElements || matchesFocus(step, input.focusTag));
    for (const step of steps) {
      const stepId = stableId('step', step.name, `xml_${step.xml_index}`);
      const { reads, writes } = stepTags(step);
      for (const tag of [...reads, ...writes]) {
        touchedTags.add(tag);
      }
      const stepFormulaCandidates = formulaCandidates(step);
      const formulaRefs: string[] = [];

      for (const [index, source] of stepFormulaCandidates.entries()) {
        const formulaId = `${stableId('formula', step.name, `xml_${step.xml_index}`)}:${index + 1}`;
        formulaRefs.push(formulaId);
        const formulaReads = extractFormulaIdentifiers(source);
        for (const tag of formulaReads) {
          touchedTags.add(tag);
        }
        formulas.push({
          id: formulaId,
          step_id: stepId,
          source: input.includeFormulaDetails ? source : source.slice(0, 240),
          reads: formulaReads,
          writes,
          confidence: 'metadata_formula',
        });
        pushUnique(edges, { from: stepId, to: formulaId, kind: 'formula' }, (edge) => JSON.stringify(edge));
      }

      pushUnique(
        nodes,
        {
          id: stepId,
          label: step.label ?? step.name ?? `Step ${step.xml_index}`,
          kind: 'procedure_step',
          action_type: step.actionType,
          order: effectiveOrder(step),
          reads,
          writes,
          formula_refs: formulaRefs,
        },
        (node) => node.id,
      );

      for (const tag of reads) {
        const tagId = stableId('tag', tag, tag);
        pushUnique(nodes, { id: tagId, label: tag, kind: 'context_tag' }, (node) => node.id);
        pushUnique(edges, { from: tagId, to: stepId, kind: 'read' }, (edge) => JSON.stringify(edge));
      }
      for (const tag of writes) {
        const tagId = stableId('tag', tag, tag);
        pushUnique(nodes, { id: tagId, label: tag, kind: 'context_tag' }, (node) => node.id);
        pushUnique(edges, { from: stepId, to: tagId, kind: 'write' }, (edge) => JSON.stringify(edge));
      }
      for (const formula of formulas.filter((candidate) => candidate.step_id === stepId)) {
        pushUnique(nodes, { id: formula.id, label: formula.source, kind: 'formula' }, (node) => node.id);
      }
    }
  }

  const mappings = buildContextMappings(input.context, Array.from(touchedTags));
  for (const mapping of mappings) {
    if (!mapping.object_field) {
      continue;
    }
    const tagId = stableId('tag', mapping.context_tag, mapping.context_tag);
    const fieldId = stableId('field', `${mapping.object_name ?? 'Object'}.${mapping.object_field}`, mapping.object_field);
    pushUnique(nodes, { id: fieldId, label: `${mapping.object_name ?? 'Object'}.${mapping.object_field}`, kind: 'object_field' }, (node) => node.id);
    pushUnique(edges, { from: tagId, to: fieldId, kind: 'maps_to' }, (edge) => JSON.stringify(edge));
  }

  const writesByTag = new Map<string, string[]>();
  for (const node of nodes.filter((node) => node.kind === 'procedure_step')) {
    for (const tag of node.writes ?? []) {
      const key = normalizedContextKey(tag);
      writesByTag.set(key, [...(writesByTag.get(key) ?? []), node.id]);
    }
  }
  for (const [tag, stepIds] of writesByTag.entries()) {
    if (stepIds.length < 2) {
      continue;
    }
    limitations.push(`Multiple steps write output family ${tag}; later writes may overwrite earlier values.`);
    for (let index = 1; index < stepIds.length; index += 1) {
      pushUnique(edges, { from: stepIds[index - 1] as string, to: stepIds[index] as string, kind: 'overwrites' }, (edge) => JSON.stringify(edge));
    }
  }

  return {
    procedure: {
      file: input.artifact.path,
      version: input.versionSelector,
      active_version: input.artifact.versions.find((version) => version.status === 'Active')?.fullName ?? null,
      focus_tag: input.focusTag ?? null,
    },
    graph: {
      nodes: nodes.sort((left, right) => (left.order ?? 999999) - (right.order ?? 999999) || left.id.localeCompare(right.id)),
      edges,
    },
    formulas,
    context_mappings: mappings,
    limitations,
  };
}

export function runWaterfallModel(args: WaterfallModelArgs, startedAt: number): Envelope<WaterfallModel> {
  const artifact = loadExpressionSet(args.file);
  requirePricingProcedure(artifact, 'waterfall-model');
  const versionSelector = resolveVersionSelectorWithActiveDefault(args.version, true);
  const versions = selectVersionsWithActiveDefault(artifact.versions, versionSelector, false);
  const context = args.context ? loadContextDefinition(args.context) : null;

  if (versions.length === 0) {
    return makeEnvelope(
      'waterfall-model',
      makeSummary(args.file, 'No versions matched the requested selector.', {}, 'discover'),
      {
        procedure: { file: args.file, version: versionSelector ?? null, active_version: null, focus_tag: args.focusTag ?? null },
        graph: { nodes: [], edges: [] },
        formulas: [],
        context_mappings: [],
        limitations: [],
      },
      {
        status: 'no_match',
        source_files: [args.file, ...(args.context ? [args.context] : [])],
        warnings: [
          makeNotice(
            'version_not_found',
            'No versions matched the requested selector.',
            { selector: versionSelector ?? null },
            'Use discover to list available versions.',
          ),
        ],
        selector_input: { version: versionSelector ?? null, focus_tag: args.focusTag ?? null },
        started_at: startedAt,
      },
    );
  }

  const model = buildWaterfallModel({
    artifact,
    versions,
    context,
    versionSelector: versionSelector ?? null,
    focusTag: args.focusTag,
    includeFormulaDetails: args.includeFormulaDetails,
    includeAllElements: args.includeAllElements,
  });

  const warnings = model.graph.nodes.length === 0
    ? [
        makeNotice(
          'waterfall_model_empty',
          'No graph nodes were produced for the requested selector.',
          { focus_tag: args.focusTag ?? null },
          'Rerun with --include-all-elements or a different --focus-tag.',
        ),
      ]
    : [];

  return makeEnvelope(
    'waterfall-model',
    makeSummary(
      args.file,
      warnings.length > 0 ? 'Waterfall model completed with no matched graph nodes.' : 'Waterfall model completed.',
      {
        node_count: model.graph.nodes.length,
        edge_count: model.graph.edges.length,
        formula_count: model.formulas.length,
        context_mapping_count: model.context_mappings.length,
      },
      'waterfall-example',
    ),
    model,
    {
      status: warnings.length > 0 ? 'no_match' : 'ok',
      warnings,
      source_files: [args.file, ...(args.context ? [args.context] : [])],
      selector_input: { version: versionSelector ?? null, focus_tag: args.focusTag ?? null },
      started_at: startedAt,
    },
  );
}
