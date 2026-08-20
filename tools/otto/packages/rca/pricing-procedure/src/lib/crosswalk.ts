import * as fs from 'node:fs';

import { makeEnvelope, makeNotice, makeSummary } from './contracts/envelope';
import { PricingCliError } from './contracts/errors';
import type {
  Envelope,
  NormalizedContextAttributeEntry,
  NormalizedContextAttributeMapping,
  NormalizedContextDefinition,
  NormalizedContextQueryAttributeEntry,
  NormalizedContextTagEntry,
  NormalizedProcedureArtifact,
  NormalizedProcedureVersion,
  Notice,
} from './contracts/types';
import { familyMatches, normalizedContextKey, relatedFamilyMembers } from './domain/context_families';
import { resolveVersionSelectorWithActiveDefault, selectVersions } from './domain/selectors';
import { loadContextDefinition } from './parsing/normalize/context';
import { loadExpressionSet } from './parsing/normalize/procedure';

export interface CrosswalkArgs {
  procedure: string;
  context: string;
  version?: string;
  activeOnly: boolean;
  tag?: string;
  name?: string;
  distinct: boolean;
  includeMappings: boolean;
  includeHydration: boolean;
  includeProcedureReferences: boolean;
  includeContextMatchesFull: boolean;
  object?: string;
  compact: boolean;
  verbose: boolean;
  json: boolean;
  failOn: 'none' | 'warn' | 'changed' | 'partial' | 'no_match' | 'unsupported';
}

export interface ProcedureRow {
  version: string | null;
  step: string | null;
  parameter_name: string | null;
  parameter_value: string | null;
}

interface ProcedureReferenceRow {
  version_full_name: string | null;
  element_name: string | null;
  parameter_name: string | null;
  parameter_value: string | null;
}

interface ContextMatchEntry extends Record<string, unknown> {
  match_type: string;
  requested_tag: string;
  matched_value: string;
  attribute_title?: string | null;
  context_attribute?: string | null;
  context_tag?: string | null;
  context_node?: string | null;
  object_name?: string | null;
  query_attribute?: string | null;
}

interface CompactContextMatch {
  match_type?: string;
  matched_value?: string;
  attribute_title?: string | null;
  context_attribute?: string | null;
  context_tag?: string | null;
  context_node?: string | null;
  object_name?: string | null;
  query_attribute?: string | null;
}

interface ContextTagMatchSummary {
  match_count: number;
  by_match_type: Record<string, number>;
  sample_matches: CompactContextMatch[];
}

interface CompactEntityMappingTarget {
  context_attribute: string | null;
  context_input_attribute_name: string | null;
  context_node: string | null;
  context_node_object: string | null;
  inherited_from: string | null;
  hydration_details?: NormalizedContextAttributeMapping['hydration_details'];
}

interface ObjectLayerTarget {
  context_attribute: string | null;
  context_node: string | null;
  object_name: string | null;
  query_attribute: string | null;
  inherited_from: string | null;
}

export interface ResolvedObjectField {
  object_name: string | null;
  resolved_field: string;
  context_node: string | null;
  context_attribute: string | null;
  duplicate_mapping_path_count: number;
  supporting_inherited_from_paths: string[];
}

export interface ProcedureReferenceSummary {
  reference_count: number;
  distinct_element_names: string[];
  distinct_parameter_names: string[];
  matched_procedure_values: string[];
  top_referencing_elements: Array<{ element_name: string; reference_count: number }>;
  references?: ProcedureReferenceRow[];
}

export interface TagCenteredCrosswalkResult {
  requested_tag: string;
  procedure_reference_summary: ProcedureReferenceSummary;
  context_tag_matches: ContextTagMatchSummary | ContextMatchEntry[];
  context_node_matches: Array<{ context_node: string | null; object_name: string | null; inherited_from: string | null }>;
  entity_mapping_targets: CompactEntityMappingTarget[];
  object_layer_targets: ObjectLayerTarget[];
  resolved_object_fields: ResolvedObjectField[];
  ambiguity_notes: Array<{ family: string; related_context_tags: string[]; note: string }>;
  evidence_expansion_paths: string[];
  recommended_next_commands: string[];
}

interface LowerLevelCrosswalkRow extends ProcedureRow {
  match_status: string[];
  match_evidence: {
    value_checked: string | null;
    exact_matching: boolean;
    family_matching: boolean;
  };
  attribute_matches: NormalizedContextAttributeEntry[];
  tag_matches: NormalizedContextTagEntry[];
  query_attribute_matches: NormalizedContextQueryAttributeEntry[];
  family_matches: ReturnType<typeof familyMatches>;
  ambiguity_matches: ReturnType<typeof familyMatches>;
}

interface LowerLevelCrosswalkResult {
  crosswalk_rows: LowerLevelCrosswalkRow[];
  match_summary: {
    exact_match_rows: number;
    family_match_rows: number;
    ambiguous_rows: number;
    no_direct_match_rows: number;
    total_rows: number;
  };
  context_sources: {
    procedure: string;
    context: string;
  };
}

type CrosswalkResult = TagCenteredCrosswalkResult | LowerLevelCrosswalkResult;

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

function dedupeRows<T extends object>(rows: readonly T[], keys: readonly (keyof T)[]): T[] {
  const seen = new Set<string>();
  const deduped: T[] = [];
  for (const row of rows) {
    const record = row as Record<string, unknown>;
    const marker = JSON.stringify(keys.map((key) => record[String(key)] ?? null));
    if (seen.has(marker)) {
      continue;
    }
    seen.add(marker);
    deduped.push(row);
  }
  return deduped;
}

function filterObjectTargets(rows: readonly NormalizedContextAttributeMapping[], objectName?: string): NormalizedContextAttributeMapping[] {
  if (!objectName) {
    return [...rows];
  }
  return rows.filter((row) => {
    if (row.context_node_object === objectName) {
      return true;
    }
    return row.hydration_details.some((detail) => detail.object_name === objectName);
  });
}

function contextEntriesForTag(
  requestedTag: string,
  context: NormalizedContextDefinition,
): {
  attributeEntries: ContextMatchEntry[];
  tagEntries: ContextMatchEntry[];
  queryEntries: ContextMatchEntry[];
  mappingEntries: NormalizedContextAttributeMapping[];
} {
  const candidateTags = relatedFamilyMembers(requestedTag);
  const attributeEntries: ContextMatchEntry[] = [];
  const tagEntries: ContextMatchEntry[] = [];
  const queryEntries: ContextMatchEntry[] = [];
  const mappingEntries: NormalizedContextAttributeMapping[] = [];

  for (const candidate of candidateTags) {
    for (const entry of context.attributes[candidate] ?? []) {
      attributeEntries.push({
        match_type: candidate === requestedTag ? 'exact_attribute_match' : 'family_attribute_match',
        requested_tag: requestedTag,
        matched_value: candidate,
        ...entry,
      });
    }
    for (const entry of context.tags[candidate] ?? []) {
      tagEntries.push({
        match_type: candidate === requestedTag ? 'exact_tag_match' : 'family_tag_match',
        requested_tag: requestedTag,
        matched_value: candidate,
        context_tag: candidate,
        ...entry,
      });
    }
    for (const entry of context.query_attributes[candidate] ?? []) {
      queryEntries.push({
        match_type: candidate === requestedTag ? 'exact_query_attribute_match' : 'family_query_attribute_match',
        requested_tag: requestedTag,
        matched_value: candidate,
        ...entry,
      });
    }
    mappingEntries.push(...(context.attribute_mapping_index[candidate] ?? []));
    mappingEntries.push(...(context.tag_mapping_index[candidate] ?? []));
  }

  return {
    attributeEntries,
    tagEntries,
    queryEntries,
    mappingEntries: dedupeRows(mappingEntries, [
      'context_attribute',
      'context_input_attribute_name',
      'context_node',
      'context_node_object',
      'inherited_from',
    ]),
  };
}

function buildCrosswalkRow(entry: ProcedureRow, context: NormalizedContextDefinition): LowerLevelCrosswalkRow {
  const value = entry.parameter_value;
  const attributeMatches = value ? context.attributes[value] ?? [] : [];
  const tagMatches = value ? context.tags[value] ?? [] : [];
  const queryMatches = value ? context.query_attributes[value] ?? [] : [];
  const familyMatchRows = familyMatches(value);
  const statuses: string[] = [];
  if (attributeMatches.length > 0) {
    statuses.push('exact_attribute_match');
  }
  if (tagMatches.length > 0) {
    statuses.push('exact_tag_match');
  }
  if (queryMatches.length > 0) {
    statuses.push('exact_query_attribute_match');
  }
  if (familyMatchRows.length > 0 && statuses.length === 0) {
    statuses.push('normalized_family_match', 'ambiguous_family_match');
  }
  if (statuses.length === 0) {
    statuses.push('no_direct_match');
  }

  return {
    ...entry,
    match_status: statuses,
    match_evidence: {
      value_checked: value,
      exact_matching: attributeMatches.length > 0 || tagMatches.length > 0 || queryMatches.length > 0,
      family_matching: familyMatchRows.length > 0,
    },
    attribute_matches: attributeMatches,
    tag_matches: tagMatches,
    query_attribute_matches: queryMatches,
    family_matches: familyMatchRows,
    ambiguity_matches: familyMatchRows,
  };
}

function compactContextMatch(entry: ContextMatchEntry): CompactContextMatch {
  const compact: CompactContextMatch = {
    match_type: entry.match_type,
    matched_value: entry.matched_value,
  };
  for (const key of ['attribute_title', 'context_attribute', 'context_tag', 'context_node', 'object_name', 'query_attribute'] as const) {
    const value = entry[key];
    if (value !== undefined) {
      compact[key] = value as string | null;
    }
  }
  return compact;
}

function summarizeContextTagMatches(rawContextTagMatches: readonly ContextMatchEntry[]): ContextTagMatchSummary {
  const counts: Record<string, number> = {};
  const sampleMatches: CompactContextMatch[] = [];
  const seen = new Set<string>();
  for (const entry of rawContextTagMatches) {
    counts[entry.match_type] = (counts[entry.match_type] ?? 0) + 1;
    const compact = compactContextMatch(entry);
    const marker = JSON.stringify(compact);
    if (seen.has(marker)) {
      continue;
    }
    seen.add(marker);
    sampleMatches.push(compact);
  }
  return {
    match_count: rawContextTagMatches.length,
    by_match_type: counts,
    sample_matches: sampleMatches.slice(0, 5),
  };
}

function compactEntityMappingTarget(
  mapping: NormalizedContextAttributeMapping,
  includeHydration: boolean,
): CompactEntityMappingTarget {
  const row: CompactEntityMappingTarget = {
    context_attribute: mapping.context_attribute,
    context_input_attribute_name: mapping.context_input_attribute_name,
    context_node: mapping.context_node,
    context_node_object: mapping.context_node_object,
    inherited_from: mapping.inherited_from,
  };
  if (includeHydration) {
    row.hydration_details = mapping.hydration_details;
  }
  return row;
}

function summarizeProcedureReferences(
  procedureReferenceRows: readonly ProcedureReferenceRow[],
  requestedTag: string,
  includeReferences: boolean,
): ProcedureReferenceSummary {
  const elementCounts = new Map<string, number>();
  const distinctElementNames = new Set<string>();
  const distinctParameterNames = new Set<string>();
  const matchedValues = new Set<string>();
  const normalizedMembers = new Set(relatedFamilyMembers(requestedTag).map((member) => normalizedContextKey(member)));

  for (const row of procedureReferenceRows) {
    if (row.element_name) {
      distinctElementNames.add(row.element_name);
      elementCounts.set(row.element_name, (elementCounts.get(row.element_name) ?? 0) + 1);
    }
    if (row.parameter_name) {
      distinctParameterNames.add(row.parameter_name);
    }
    if (row.parameter_value && normalizedMembers.has(normalizedContextKey(row.parameter_value))) {
      matchedValues.add(row.parameter_value);
    }
  }

  const summary: ProcedureReferenceSummary = {
    reference_count: procedureReferenceRows.length,
    distinct_element_names: Array.from(distinctElementNames).sort(),
    distinct_parameter_names: Array.from(distinctParameterNames).sort(),
    matched_procedure_values: Array.from(matchedValues).sort(),
    top_referencing_elements: Array.from(elementCounts.entries())
      .sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]))
      .slice(0, 5)
      .map(([element_name, reference_count]) => ({ element_name, reference_count })),
  };
  if (includeReferences) {
    summary.references = [...procedureReferenceRows];
  }
  return summary;
}

function evidenceExpansionPaths(requestedTag: string): string[] {
  return [
    `crosswalk --tag ${requestedTag} --include-procedure-references`,
    `crosswalk --tag ${requestedTag} --include-context-matches-full`,
    `crosswalk --tag ${requestedTag} --include-mappings --include-hydration`,
  ];
}

function resolvedObjectFields(
  objectLayerTargets: readonly ObjectLayerTarget[],
  entityMappingTargets: readonly CompactEntityMappingTarget[],
  objectName?: string,
): ResolvedObjectField[] {
  const grouped = new Map<string, ResolvedObjectField>();

  for (const target of objectLayerTargets) {
    const resolvedField = target.query_attribute ?? target.context_attribute;
    if (!resolvedField) {
      continue;
    }
    if (objectName && target.object_name !== objectName) {
      continue;
    }
    const key = JSON.stringify([
      target.object_name ?? null,
      resolvedField,
      target.context_node ?? null,
      target.context_attribute ?? null,
    ]);
    const entry = grouped.get(key) ?? {
      object_name: target.object_name,
      resolved_field: resolvedField,
      context_node: target.context_node,
      context_attribute: target.context_attribute,
      duplicate_mapping_path_count: 0,
      supporting_inherited_from_paths: [],
    };
    entry.duplicate_mapping_path_count += 1;
    if (target.inherited_from && !entry.supporting_inherited_from_paths.includes(target.inherited_from)) {
      entry.supporting_inherited_from_paths.push(target.inherited_from);
    }
    grouped.set(key, entry);
  }

  if (grouped.size === 0) {
    for (const mapping of entityMappingTargets) {
      const resolvedField = mapping.context_input_attribute_name ?? mapping.context_attribute;
      if (!resolvedField) {
        continue;
      }
      if (objectName && mapping.context_node_object !== objectName) {
        continue;
      }
      const key = JSON.stringify([
        mapping.context_node_object ?? null,
        resolvedField,
        mapping.context_node ?? null,
        mapping.context_attribute ?? null,
      ]);
      const entry = grouped.get(key) ?? {
        object_name: mapping.context_node_object,
        resolved_field: resolvedField,
        context_node: mapping.context_node,
        context_attribute: mapping.context_attribute,
        duplicate_mapping_path_count: 0,
        supporting_inherited_from_paths: [],
      };
      entry.duplicate_mapping_path_count += 1;
      if (mapping.inherited_from && !entry.supporting_inherited_from_paths.includes(mapping.inherited_from)) {
        entry.supporting_inherited_from_paths.push(mapping.inherited_from);
      }
      grouped.set(key, entry);
    }
  }

  return Array.from(grouped.values())
    .map((entry) => ({
      ...entry,
      supporting_inherited_from_paths: entry.supporting_inherited_from_paths.slice(0, 3),
    }))
    .sort((left, right) => {
      return (
        (left.object_name ?? '').localeCompare(right.object_name ?? '')
        || left.resolved_field.localeCompare(right.resolved_field)
        || (left.context_node ?? '').localeCompare(right.context_node ?? '')
        || (left.context_attribute ?? '').localeCompare(right.context_attribute ?? '')
      );
    });
}

export function buildTagCrosswalkView(
  requestedTag: string,
  procedureRows: readonly ProcedureRow[],
  context: NormalizedContextDefinition,
  args: Pick<
    CrosswalkArgs,
    | 'distinct'
    | 'includeMappings'
    | 'includeHydration'
    | 'includeProcedureReferences'
    | 'includeContextMatchesFull'
    | 'object'
  >,
): TagCenteredCrosswalkResult {
  const { attributeEntries, tagEntries, queryEntries, mappingEntries } = contextEntriesForTag(requestedTag, context);
  const filteredMappingEntries = filterObjectTargets(mappingEntries, args.object);

  let procedureReferenceRows: ProcedureReferenceRow[] = procedureRows.map((row) => ({
    version_full_name: row.version,
    element_name: row.step,
    parameter_name: row.parameter_name,
    parameter_value: row.parameter_value,
  }));
  if (args.distinct) {
    procedureReferenceRows = dedupeRows(procedureReferenceRows, [
      'version_full_name',
      'element_name',
      'parameter_name',
      'parameter_value',
    ]);
  }

  let contextNodeMatches = filteredMappingEntries.map((mapping) => ({
    context_node: mapping.context_node,
    object_name: mapping.context_node_object,
    inherited_from: mapping.inherited_from,
  }));
  let entityMappingTargets = filteredMappingEntries.map((mapping) => compactEntityMappingTarget(mapping, args.includeHydration));
  let objectLayerTargets: ObjectLayerTarget[] = [];

  for (const mapping of filteredMappingEntries) {
    if (mapping.hydration_details.length > 0) {
      for (const detail of mapping.hydration_details) {
        objectLayerTargets.push({
          context_attribute: mapping.context_attribute,
          context_node: mapping.context_node,
          object_name: detail.object_name ?? mapping.context_node_object,
          query_attribute: detail.query_attribute,
          inherited_from: detail.inherited_from ?? mapping.inherited_from,
        });
      }
      continue;
    }
    objectLayerTargets.push({
      context_attribute: mapping.context_attribute,
      context_node: mapping.context_node,
      object_name: mapping.context_node_object,
      query_attribute: null,
      inherited_from: mapping.inherited_from,
    });
  }

  contextNodeMatches = dedupeRows(contextNodeMatches, ['context_node', 'object_name', 'inherited_from']);
  entityMappingTargets = dedupeRows(entityMappingTargets, [
    'context_attribute',
    'context_input_attribute_name',
    'context_node',
    'context_node_object',
    'inherited_from',
  ]);
  objectLayerTargets = dedupeRows(objectLayerTargets, [
    'context_attribute',
    'context_node',
    'object_name',
    'query_attribute',
    'inherited_from',
  ]);

  let rawContextTagMatches = [...attributeEntries, ...tagEntries, ...queryEntries];
  if (args.distinct) {
    rawContextTagMatches = dedupeRows(rawContextTagMatches, [
      'match_type',
      'matched_value',
      'attribute_title',
      'context_attribute',
      'query_attribute',
    ]);
  }

  const ambiguityNotes = familyMatches(requestedTag).map((family) => ({
    family: family.family,
    related_context_tags: family.members,
    note: 'Treat this as a related context-tag family, not a proven one-to-one identity across context definition and object-layer surfaces.',
  }));

  return {
    requested_tag: requestedTag,
    procedure_reference_summary: summarizeProcedureReferences(
      procedureReferenceRows,
      requestedTag,
      args.includeProcedureReferences,
    ),
    context_tag_matches: args.includeContextMatchesFull ? rawContextTagMatches : summarizeContextTagMatches(rawContextTagMatches),
    context_node_matches: contextNodeMatches,
    entity_mapping_targets: args.includeMappings ? entityMappingTargets : [],
    object_layer_targets: objectLayerTargets,
    resolved_object_fields: resolvedObjectFields(objectLayerTargets, entityMappingTargets, args.object),
    ambiguity_notes: ambiguityNotes,
    evidence_expansion_paths: evidenceExpansionPaths(requestedTag),
    recommended_next_commands: [
      'inspect-step --step-name <element_name>',
      `crosswalk --tag ${requestedTag} --include-procedure-references`,
    ],
  };
}

function findProcedureRows(versions: readonly NormalizedProcedureVersion[], args: Pick<CrosswalkArgs, 'tag' | 'name'>): ProcedureRow[] {
  const relatedMembers = args.tag ? new Set(relatedFamilyMembers(args.tag)) : new Set<string>();
  const rows: ProcedureRow[] = [];
  for (const version of versions) {
    for (const step of version.steps) {
      for (const parameter of step.parameters) {
        if (args.tag && !relatedMembers.has(parameter.value ?? '') && !relatedMembers.has(parameter.name ?? '')) {
          continue;
        }
        if (args.name && args.name !== parameter.name && args.name !== parameter.value) {
          continue;
        }
        rows.push({
          version: version.fullName,
          step: step.name,
          parameter_name: parameter.name,
          parameter_value: parameter.value,
        });
      }
    }
  }
  return rows;
}

function buildMissingContextTagResult(tag: string, rows: readonly ProcedureRow[]): TagCenteredCrosswalkResult {
  return {
    requested_tag: tag,
    procedure_reference_summary: {
      reference_count: rows.length,
      distinct_element_names: Array.from(new Set(rows.map((row) => row.step).filter((value): value is string => Boolean(value)))).sort(),
      distinct_parameter_names: Array.from(
        new Set(rows.map((row) => row.parameter_name).filter((value): value is string => Boolean(value))),
      ).sort(),
      matched_procedure_values: Array.from(
        new Set(rows.map((row) => row.parameter_value).filter((value): value is string => Boolean(value))),
      ).sort(),
      top_referencing_elements: [],
    },
    context_tag_matches: [],
    context_node_matches: [],
    entity_mapping_targets: [],
    object_layer_targets: [],
    resolved_object_fields: [],
    ambiguity_notes: familyMatches(tag).map((family) => ({
      family: family.family,
      related_context_tags: family.members,
      note: 'Context-definition mapping is unavailable until the companion context definition is provided.',
    })),
    evidence_expansion_paths: evidenceExpansionPaths(tag),
    recommended_next_commands: [`crosswalk --tag ${tag} --include-mappings`, 'doctor --context <context-file>'],
  };
}

export function runCrosswalk(args: CrosswalkArgs, startedAt: number): Envelope<CrosswalkResult> {
  const artifact = loadExpressionSet(args.procedure);
  requirePricingProcedure(artifact, 'crosswalk');

  const versionSelector = resolveVersionSelectorWithActiveDefault(args.version, args.activeOnly);
  const versions = selectVersions(artifact.versions, versionSelector);
  const sourceFiles = [args.procedure];
  const selectorInput = {
    version: versionSelector ?? null,
    name: args.name ?? null,
    tag: args.tag ?? null,
    object: args.object ?? null,
    active_only: args.activeOnly,
  };

  if (versions.length === 0) {
    const result: CrosswalkResult = args.tag
      ? {
          requested_tag: args.tag,
          procedure_reference_summary: {
            reference_count: 0,
            distinct_element_names: [],
            distinct_parameter_names: [],
            matched_procedure_values: [],
            top_referencing_elements: [],
          },
          context_tag_matches: [],
          context_node_matches: [],
          entity_mapping_targets: [],
          object_layer_targets: [],
          resolved_object_fields: [],
          ambiguity_notes: [],
          evidence_expansion_paths: [],
          recommended_next_commands: ['discover'],
        }
      : {
          crosswalk_rows: [],
          match_summary: {
            exact_match_rows: 0,
            family_match_rows: 0,
            ambiguous_rows: 0,
            no_direct_match_rows: 0,
            total_rows: 0,
          },
          context_sources: { procedure: args.procedure, context: args.context },
        };

    return makeEnvelope(
      'crosswalk',
      makeSummary(args.procedure, 'No versions matched the requested selector.', {}, 'discover'),
      result,
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
        source_files: sourceFiles,
        selector_input: selectorInput,
        started_at: startedAt,
      },
    );
  }

  const rows = findProcedureRows(versions, args);
  const warnings: Notice[] = [];
  let partialReason: string | undefined;

  if (!fs.existsSync(args.context)) {
    partialReason = 'context file missing';
    warnings.push(
      makeNotice(
        'missing_context_definition',
        'Context definition file is missing.',
        { path: args.context },
        'Provide a valid ContextDefinition file to enable exact crosswalk matching.',
      ),
    );

    if (args.tag) {
      const result = buildMissingContextTagResult(args.tag, rows);
      let status: Envelope['status'] = rows.length > 0 ? 'partial' : 'no_match';
      if (rows.length === 0) {
        warnings.push(
          makeNotice(
            'symbol_not_found',
            'No procedure references matched the requested context tag.',
            { tag: args.tag },
            'Use summarize --focus-tag or trace-tag to inspect nearby context-tag families.',
          ),
        );
      }
      return makeEnvelope(
        'crosswalk',
        makeSummary(
          args.procedure,
          rows.length > 0
            ? 'Crosswalk completed with missing context-definition mappings.'
            : 'No procedure references matched the requested context tag.',
          { reference_count: rows.length },
          rows.length > 0 ? 'trace-tag' : 'summarize',
        ),
        result,
        {
          warnings,
          status,
          source_files: sourceFiles,
          selector_input: selectorInput,
          partial_reason: partialReason,
          started_at: startedAt,
        },
      );
    }

    const crosswalkRows: LowerLevelCrosswalkRow[] = rows.map((row) => ({
      ...row,
      match_status: ['no_direct_match'],
      match_evidence: { value_checked: row.parameter_value, exact_matching: false, family_matching: false },
      attribute_matches: [],
      tag_matches: [],
      query_attribute_matches: [],
      family_matches: [],
      ambiguity_matches: [],
    }));

    const exact = 0;
    const family = 0;
    const ambiguous = 0;
    const noDirect = crosswalkRows.length;
    return makeEnvelope(
      'crosswalk',
      makeSummary(
        args.procedure,
        crosswalkRows.length > 0 ? 'Crosswalk completed.' : 'No crosswalk rows matched the requested filters.',
        {
          exact_match_rows: exact,
          family_match_rows: family,
          ambiguous_rows: ambiguous,
          no_direct_match_rows: noDirect,
          total_rows: crosswalkRows.length,
        },
        crosswalkRows.length > 0 ? 'inspect-step' : 'summarize',
      ),
      {
        crosswalk_rows: crosswalkRows,
        match_summary: {
          exact_match_rows: exact,
          family_match_rows: family,
          ambiguous_rows: ambiguous,
          no_direct_match_rows: noDirect,
          total_rows: crosswalkRows.length,
        },
        context_sources: {
          procedure: args.procedure,
          context: args.context,
        },
      },
      {
        warnings: args.name && crosswalkRows.length === 0
          ? [
              ...warnings,
              makeNotice(
                'symbol_not_found',
                'No parameter rows matched the requested context tag or parameter name.',
                { name: args.name },
                'Relax the --name filter or inspect the step first.',
              ),
            ]
          : warnings,
        status: crosswalkRows.length === 0 && args.name ? 'no_match' : 'partial',
        source_files: sourceFiles,
        selector_input: selectorInput,
        partial_reason: partialReason,
        started_at: startedAt,
      },
    );
  }

  const context = loadContextDefinition(args.context);
  sourceFiles.push(args.context);

  if (args.tag) {
    const result = buildTagCrosswalkView(args.tag, rows, context, args);
    const referenceCount = result.procedure_reference_summary.reference_count;
    const contextMatchCount = Array.isArray(result.context_tag_matches)
      ? result.context_tag_matches.length
      : result.context_tag_matches.match_count;
    const objectTargetCount = result.object_layer_targets.length;
    let status: Envelope['status'] = 'ok';
    if (referenceCount === 0 && contextMatchCount === 0) {
      status = 'no_match';
      warnings.push(
        makeNotice(
          'symbol_not_found',
          'No procedure or context-definition matches were found for the requested context tag.',
          { tag: args.tag },
          'Use summarize --focus-tag or trace-tag to inspect nearby context-tag families.',
        ),
      );
    } else if (contextMatchCount === 0 || objectTargetCount === 0) {
      status = 'warn';
    }
    return makeEnvelope(
      'crosswalk',
      makeSummary(
        args.procedure,
        status !== 'no_match' ? 'Tag-centered crosswalk completed.' : 'No matches were found for the requested context tag.',
        {
          reference_count: referenceCount,
          context_match_count: contextMatchCount,
          object_target_count: objectTargetCount,
        },
        referenceCount > 0 ? 'inspect-step' : 'trace-tag',
      ),
      result,
      {
        warnings,
        status,
        source_files: sourceFiles,
        selector_input: selectorInput,
        started_at: startedAt,
      },
    );
  }

  const crosswalkRows = rows.map((row) => buildCrosswalkRow(row, context));
  if (args.name && crosswalkRows.length === 0) {
    warnings.push(
      makeNotice(
        'symbol_not_found',
        'No parameter rows matched the requested context tag or parameter name.',
        { name: args.name },
        'Relax the --name filter or inspect the step first.',
      ),
    );
  }

  const exact = crosswalkRows.filter((row) => row.match_status.some((status) => status.startsWith('exact_'))).length;
  const family = crosswalkRows.filter((row) => row.match_status.includes('normalized_family_match')).length;
  const ambiguous = crosswalkRows.filter((row) => row.match_status.includes('ambiguous_family_match')).length;
  const noDirect = crosswalkRows.filter((row) => row.match_status.length === 1 && row.match_status[0] === 'no_direct_match').length;

  let status: Envelope['status'] = 'ok';
  if (partialReason) {
    status = 'partial';
  } else if (args.name && crosswalkRows.length === 0) {
    status = 'no_match';
  } else if (family > 0 || ambiguous > 0 || noDirect > 0) {
    status = 'warn';
  }

  return makeEnvelope(
    'crosswalk',
    makeSummary(
      args.procedure,
      crosswalkRows.length > 0 ? 'Crosswalk completed.' : 'No crosswalk rows matched the requested filters.',
      {
        exact_match_rows: exact,
        family_match_rows: family,
        ambiguous_rows: ambiguous,
        no_direct_match_rows: noDirect,
        total_rows: crosswalkRows.length,
      },
      crosswalkRows.length > 0 ? 'inspect-step' : 'summarize',
    ),
    {
      crosswalk_rows: crosswalkRows,
      match_summary: {
        exact_match_rows: exact,
        family_match_rows: family,
        ambiguous_rows: ambiguous,
        no_direct_match_rows: noDirect,
        total_rows: crosswalkRows.length,
      },
      context_sources: {
        procedure: args.procedure,
        context: args.context,
      },
    },
    {
      warnings,
      status,
      source_files: sourceFiles,
      selector_input: selectorInput,
      partial_reason: partialReason,
      started_at: startedAt,
    },
  );
}
