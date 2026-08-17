import { makeEnvelope, makeNotice, makeSummary } from './contracts/envelope';
import { PricingCliError } from './contracts/errors';
import type {
  Envelope,
  NormalizedContextDefinition,
  NormalizedProcedureArtifact,
  NormalizedProcedureVersion,
} from './contracts/types';
import {
  buildTagCrosswalkView,
  type ResolvedObjectField,
  type TagCenteredCrosswalkResult,
} from './crosswalk';
import { normalizedContextKey } from './domain/context_families';
import { resolveVersionSelectorWithActiveDefault, selectVersionsWithActiveDefault } from './domain/selectors';
import { loadContextDefinition } from './parsing/normalize/context';
import { loadExpressionSet } from './parsing/normalize/procedure';
import { traceContextTag, type TraceTagResult } from './trace_tag';

const DERIVATION_ACTION_HINTS = ['derived', 'formula'] as const;
const PLANNING_REASON_DERIVATION = 'derivation surface likely controlling final calculated value';
const PLANNING_REASON_LATE_PRODUCER = 'late producer likely affecting final calculated output';
const PLANNING_REASON_ASSIGNMENT = 'explicit assignment/handoff surface for requested context tag';
const PLANNING_REASON_WATERFALL = 'waterfall exposure or initialization surface';
const PLANNING_REASON_SHARED = 'shared surface touching related waterfall-family or total-family context tags';
const PLANNING_REASON_DOWNSTREAM = 'downstream validation or synchronization surface';
const WATERFALL_TAG_KEYS = new Set(
  ['PriceWaterfall', 'PriceWaterFall', 'price_water_fall', 'PriceWaterfallIdentifier'].map((tag) => normalizedContextKey(tag)),
);
const TOTAL_FAMILY_TAG_KEYS = new Set(
  ['Subtotal', 'SubTotal', 'ItemNetTotalPrice', 'ItemGrossTotalPrice', 'ItemTotalPrice'].map((tag) => normalizedContextKey(tag)),
);

export interface PlanChangeArgs {
  file: string;
  tag?: string;
  stepName?: string;
  version?: string;
  activeOnly: boolean;
  context?: string;
  object?: string;
  includeImpacts: boolean;
  json: boolean;
  failOn: 'none' | 'warn' | 'changed' | 'partial' | 'no_match' | 'unsupported';
}

interface CompactSurface {
  element_name: string | null;
  action_type: string | null;
  effective_order_index: number | null;
  parent_step: string | null;
  planning_reason?: string;
}

interface RecommendedEditSequenceRow {
  element_name: string;
  why_first: string;
}

interface DownstreamImpactRow {
  impact_type: string;
  element_name: string | null;
  effective_order_index?: number | null;
  context_tags?: string[];
  parameter_name?: string | null;
}

interface PlanningSubject {
  subject_type?: 'context_tag' | 'step_name';
  context_tag?: string;
  step_name?: string;
  version_scope?: Array<string | null>;
}

interface PlanningSummary {
  likely_final_calculation_surfaces: string[];
  likely_waterfall_exposure_surfaces: string[];
}

interface LineageSummary {
  likely_upstream_procedure_elements: Array<{ element_name: string; reference_count: number }>;
  context_attribute: string;
  context_node: Array<string | null>;
  resolved_object_fields: string[];
}

export interface PlanChangeResult {
  planning_subject: PlanningSubject;
  planning_summary: PlanningSummary;
  likely_primary_edit_surfaces: CompactSurface[];
  recommended_primary_edit_sequence?: RecommendedEditSequenceRow[];
  likely_secondary_review_surfaces: CompactSurface[];
  downstream_impacts: DownstreamImpactRow[];
  related_context_tags_to_validate: string[];
  object_layer_fields_to_validate: ResolvedObjectField[];
  recommended_review_steps: string[];
  recommended_validation_steps: string[];
  lineage_summary?: LineageSummary;
}

interface PlanningCandidateRow {
  element_name: string | null;
  action_type: string | null;
  effective_order_index: number | null;
  parent_step: string | null;
  role?: string;
  writes_context_tags?: string[];
  formula_details?: Array<unknown>;
  shared_context_tags?: string[];
  parameter_name?: string | null;
  output_context_tags?: string[];
  planning_reason?: string;
  _planning_score?: number;
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

function orderedUnique<T>(rows: readonly T[], keyFn: (row: T) => unknown, limit?: number): T[] {
  const deduped: T[] = [];
  const seen = new Set<unknown>();
  for (const row of rows) {
    const key = keyFn(row);
    if (!key || seen.has(key)) {
      continue;
    }
    seen.add(key);
    deduped.push(row);
    if (typeof limit === 'number' && deduped.length >= limit) {
      break;
    }
  }
  return deduped;
}

function compactSurface(row: PlanningCandidateRow, includeReason = false): CompactSurface {
  return {
    element_name: row.element_name,
    action_type: row.action_type,
    effective_order_index: row.effective_order_index,
    parent_step: row.parent_step,
    ...(includeReason && row.planning_reason ? { planning_reason: row.planning_reason } : {}),
  };
}

function looksLikeDerivationSurface(row: PlanningCandidateRow): boolean {
  const actionType = (row.action_type ?? '').toLowerCase();
  const elementName = (row.element_name ?? '').toLowerCase();
  if ((row.formula_details ?? []).length > 0) {
    return true;
  }
  return DERIVATION_ACTION_HINTS.some((hint) => actionType.includes(hint) || elementName.includes(hint));
}

function surfaceProfile(
  row: PlanningCandidateRow,
  lateProducerNames: ReadonlySet<string>,
  initializedNames: ReadonlySet<string>,
  explicitAssignmentNames: ReadonlySet<string>,
  sharedSurfaceTags: ReadonlyMap<string, string[]>,
  terminalConsumerNames: ReadonlySet<string>,
  lateOrderThreshold: number | null,
): {
  is_derivation: boolean;
  is_late_producer: boolean;
  is_material_late_producer: boolean;
  is_explicit_assignment: boolean;
  is_waterfall_surface: boolean;
  is_shared_surface: boolean;
  is_downstream_validation: boolean;
  writes: boolean;
} {
  const elementName = row.element_name ?? '';
  const writes = Boolean(row.writes_context_tags && row.writes_context_tags.length > 0);
  const effectiveOrderIndex = row.effective_order_index;
  const sharedTags = sharedSurfaceTags.get(elementName) ?? [];
  const sharedTagKeys = new Set(sharedTags.map((tag) => normalizedContextKey(tag)));
  const isDerivation = looksLikeDerivationSurface(row);
  const isLateByOrder = effectiveOrderIndex != null && lateOrderThreshold != null && effectiveOrderIndex >= lateOrderThreshold;
  const isLateProducer = lateProducerNames.has(elementName) || isLateByOrder;
  const isMaterialLateProducer = isLateProducer && writes && ['producer', 'transformer'].includes(row.role ?? '');
  const isExplicitAssignment = explicitAssignmentNames.has(elementName) || row.action_type === 'AssignmentElement';
  const isWaterfallSurface = initializedNames.has(elementName)
    || Array.from(sharedTagKeys).some((tag) => WATERFALL_TAG_KEYS.has(tag))
    || row.action_type === 'PricingSettings';
  const isSharedSurface = sharedSurfaceTags.has(elementName)
    || Array.from(sharedTagKeys).some((tag) => TOTAL_FAMILY_TAG_KEYS.has(tag));
  const isDownstreamValidation = !writes
    || terminalConsumerNames.has(elementName)
    || row.role === 'consumer'
    || (isLateProducer && row.role === 'passthrough');
  return {
    is_derivation: isDerivation,
    is_late_producer: isLateProducer,
    is_material_late_producer: isMaterialLateProducer,
    is_explicit_assignment: isExplicitAssignment,
    is_waterfall_surface: isWaterfallSurface,
    is_shared_surface: isSharedSurface,
    is_downstream_validation: isDownstreamValidation,
    writes,
  };
}

function planningReasonForProfile(profile: ReturnType<typeof surfaceProfile>): string {
  if (profile.is_downstream_validation) {
    return PLANNING_REASON_DOWNSTREAM;
  }
  if (profile.is_derivation && profile.is_late_producer && profile.writes) {
    return PLANNING_REASON_DERIVATION;
  }
  if (profile.is_material_late_producer) {
    return PLANNING_REASON_LATE_PRODUCER;
  }
  if (profile.is_explicit_assignment && profile.writes) {
    return PLANNING_REASON_ASSIGNMENT;
  }
  if (profile.is_waterfall_surface) {
    return PLANNING_REASON_WATERFALL;
  }
  if (profile.is_shared_surface) {
    return PLANNING_REASON_SHARED;
  }
  if (profile.is_derivation && profile.writes) {
    return PLANNING_REASON_DERIVATION;
  }
  if (profile.writes) {
    return PLANNING_REASON_LATE_PRODUCER;
  }
  return PLANNING_REASON_DOWNSTREAM;
}

function planningScore(row: PlanningCandidateRow, profile: ReturnType<typeof surfaceProfile>): number {
  let score = 0;
  if (profile.is_derivation && profile.is_late_producer && profile.writes) {
    score += 520;
  } else if (profile.is_material_late_producer) {
    score += 430;
  } else if (profile.is_explicit_assignment && profile.writes) {
    score += 330;
  } else if (profile.is_waterfall_surface) {
    score += 230;
  } else if (profile.is_shared_surface) {
    score += 130;
  } else if (profile.writes) {
    score += 250;
  }
  if (profile.is_downstream_validation) {
    score -= 260;
  }
  if (row.role === 'passthrough') {
    score -= 90;
  }
  if (profile.is_waterfall_surface && !profile.is_derivation && !profile.is_explicit_assignment) {
    score -= 45;
  }
  if (profile.is_shared_surface && !profile.is_waterfall_surface) {
    score -= 20;
  }
  if (row.effective_order_index != null) {
    score += Math.min(row.effective_order_index, 999) / 1000;
  }
  return score;
}

function surfaceSortKey(left: PlanningCandidateRow, right: PlanningCandidateRow): number {
  return (right._planning_score ?? 0) - (left._planning_score ?? 0)
    || (left.effective_order_index ?? 999999) - (right.effective_order_index ?? 999999)
    || (left.element_name ?? '').localeCompare(right.element_name ?? '');
}

function whyFirstForSurface(row: CompactSurface): string {
  const mapping: Record<string, string> = {
    [PLANNING_REASON_DERIVATION]: 'likely final-calculation producer',
    [PLANNING_REASON_LATE_PRODUCER]: 'late producer to inspect after the main derivation surface',
    [PLANNING_REASON_ASSIGNMENT]: 'explicit NetUnitPrice handoff to confirm after calculation changes',
    [PLANNING_REASON_WATERFALL]: 'waterfall exposure surface to validate after calculation edits',
    [PLANNING_REASON_SHARED]: 'shared family surface to spot adjacent total or waterfall effects',
    [PLANNING_REASON_DOWNSTREAM]: 'downstream validation surface after primary edits',
  };
  return mapping[row.planning_reason ?? ''] ?? 'likely related edit surface';
}

function recommendedPrimaryEditSequence(
  primarySurfaces: readonly CompactSurface[],
  secondarySurfaces: readonly CompactSurface[],
): RecommendedEditSequenceRow[] {
  const sequence: RecommendedEditSequenceRow[] = [];
  const seen = new Set<string>();
  const addRow = (row: CompactSurface): void => {
    const elementName = row.element_name;
    if (!elementName || seen.has(elementName)) {
      return;
    }
    seen.add(elementName);
    sequence.push({ element_name: elementName, why_first: whyFirstForSurface(row) });
  };

  const prioritizedReasonGroups = [
    [PLANNING_REASON_DERIVATION],
    [PLANNING_REASON_ASSIGNMENT],
    [PLANNING_REASON_WATERFALL],
    [PLANNING_REASON_LATE_PRODUCER],
  ];
  for (const reasonGroup of prioritizedReasonGroups) {
    for (const row of [...primarySurfaces, ...secondarySurfaces]) {
      if (row.planning_reason && reasonGroup.includes(row.planning_reason)) {
        addRow(row);
        break;
      }
    }
    if (sequence.length >= 4) {
      break;
    }
  }
  if (sequence.length < 2) {
    for (const row of [...primarySurfaces, ...secondarySurfaces]) {
      addRow(row);
      if (sequence.length >= 2) {
        break;
      }
    }
  }
  return sequence.slice(0, 4);
}

function planningSummary(primarySurfaces: readonly CompactSurface[], secondarySurfaces: readonly CompactSurface[]): PlanningSummary {
  const combined = [...primarySurfaces, ...secondarySurfaces];
  const finalSurfaces: string[] = [];
  const waterfallSurfaces: string[] = [];
  const seenFinal = new Set<string>();
  const seenWaterfall = new Set<string>();

  for (const row of primarySurfaces) {
    const elementName = row.element_name;
    if (!elementName || seenFinal.has(elementName)) {
      continue;
    }
    if ([PLANNING_REASON_DERIVATION, PLANNING_REASON_LATE_PRODUCER, PLANNING_REASON_ASSIGNMENT].includes(row.planning_reason ?? '')) {
      seenFinal.add(elementName);
      finalSurfaces.push(elementName);
    }
    if (finalSurfaces.length >= 3) {
      break;
    }
  }

  for (const row of combined) {
    const elementName = row.element_name;
    if (!elementName || seenWaterfall.has(elementName)) {
      continue;
    }
    if (row.planning_reason === PLANNING_REASON_WATERFALL) {
      seenWaterfall.add(elementName);
      waterfallSurfaces.push(elementName);
    }
    if (waterfallSurfaces.length >= 2) {
      break;
    }
  }

  return {
    likely_final_calculation_surfaces: finalSurfaces,
    likely_waterfall_exposure_surfaces: waterfallSurfaces,
  };
}

function buildPrimarySurfaces(traceResult: TraceTagResult): CompactSurface[] {
  const flowSummary = traceResult.flow_summary;
  const initializedNames = new Set(flowSummary.initialized_by.map((row) => row.element_name).filter((value): value is string => Boolean(value)));
  const explicitAssignmentNames = new Set(flowSummary.explicit_assignment_steps.map((row) => row.element_name).filter((value): value is string => Boolean(value)));
  const lateProducerNames = new Set(flowSummary.late_producers.map((row) => row.element_name).filter((value): value is string => Boolean(value)));
  const sharedSurfaceTags = new Map(
    traceResult.shared_edit_surfaces
      .filter((row) => Boolean(row.element_name))
      .map((row) => [row.element_name as string, row.shared_context_tags]),
  );
  const terminalConsumerNames = new Set(flowSummary.terminal_consumers.map((row) => row.element_name).filter((value): value is string => Boolean(value)));

  const candidateRows = new Map<string, PlanningCandidateRow>();
  for (const bucketName of ['producer_elements', 'consumer_elements', 'formula_elements'] as const) {
    for (const row of traceResult[bucketName] ?? []) {
      const elementName = row.element_name;
      if (!elementName) {
        continue;
      }
      const existing = candidateRows.get(elementName);
      if (!existing || (row.formula_details?.length ?? 0) > (existing.formula_details?.length ?? 0)) {
        candidateRows.set(elementName, row);
      }
    }
  }

  const producerOrderIndexes = Array.from(candidateRows.values())
    .filter((row) => Boolean(row.writes_context_tags?.length) && row.effective_order_index != null)
    .map((row) => row.effective_order_index as number)
    .sort((left, right) => left - right);
  const lateOrderThreshold = producerOrderIndexes.length > 0
    ? producerOrderIndexes[Math.max(Math.floor((producerOrderIndexes.length * 3) / 4), 0)]
    : null;

  const ranked = Array.from(candidateRows.values()).map((row) => {
    const profile = surfaceProfile(
      row,
      lateProducerNames,
      initializedNames,
      explicitAssignmentNames,
      sharedSurfaceTags,
      terminalConsumerNames,
      lateOrderThreshold,
    );
    return {
      ...row,
      planning_reason: planningReasonForProfile(profile),
      _planning_score: planningScore(row, profile),
    };
  });

  ranked.sort(surfaceSortKey);
  return ranked.slice(0, 6).map((row) => compactSurface(row, true));
}

function relatedValidationTags(traceResult: TraceTagResult, requestedTag: string): string[] {
  const totalTags: string[] = [];
  const waterfallTags: string[] = [];
  const handoffTags: string[] = [];
  for (const row of traceResult.shared_edit_surfaces) {
    for (const tag of row.shared_context_tags) {
      const normalized = normalizedContextKey(tag);
      if (WATERFALL_TAG_KEYS.has(normalized)) {
        waterfallTags.push(tag);
      } else if (TOTAL_FAMILY_TAG_KEYS.has(normalized)) {
        totalTags.push(tag);
      } else {
        handoffTags.push(tag);
      }
    }
  }
  totalTags.push(...traceResult.related_context_tags);
  const ordered: string[] = [];
  const seen = new Set([requestedTag]);
  for (const tag of [...waterfallTags, ...handoffTags, ...totalTags]) {
    if (!tag || seen.has(tag)) {
      continue;
    }
    seen.add(tag);
    ordered.push(tag);
  }
  return ordered.slice(0, 6);
}

function procedureRowsForTag(versions: readonly NormalizedProcedureVersion[], requestedTag: string): Array<{
  version: string | null;
  step: string | null;
  parameter_name: string | null;
  parameter_value: string | null;
}> {
  const rows: Array<{ version: string | null; step: string | null; parameter_name: string | null; parameter_value: string | null }> = [];
  for (const version of versions) {
    for (const step of version.steps) {
      for (const parameter of step.parameters) {
        if (parameter.value !== requestedTag && parameter.name !== requestedTag) {
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

function buildChangePlan(
  artifact: NormalizedProcedureArtifact,
  versions: readonly NormalizedProcedureVersion[],
  args: {
    requestedTag?: string;
    stepName?: string;
    context?: NormalizedContextDefinition;
    objectName?: string;
    includeImpacts: boolean;
  },
): PlanChangeResult {
  if (!args.requestedTag && !args.stepName) {
    throw new Error('plan-change requires requestedTag or stepName');
  }

  if (args.requestedTag) {
    const { result: traceResult } = traceContextTag(artifact, versions, args.requestedTag, {
      producerOnly: false,
      consumerOnly: false,
      includeFormulaDetails: true,
      includeRelatedTags: true,
      includeContextHints: true,
      includeAllElements: true,
      includeWaterfallSlice: false,
    });
    const subject: PlanningSubject = {
      subject_type: 'context_tag',
      context_tag: args.requestedTag,
      version_scope: versions.map((version) => version.fullName),
    };
    const likelyPrimaryEditSurfaces = buildPrimarySurfaces(traceResult);

    const secondary: PlanningCandidateRow[] = [];
    for (const row of traceResult.shared_edit_surfaces) {
      const sharedTagKeys = new Set(row.shared_context_tags.map((tag) => normalizedContextKey(tag)));
      secondary.push({
        ...row,
        parent_step: null,
        planning_reason: Array.from(sharedTagKeys).some((tag) => WATERFALL_TAG_KEYS.has(tag))
          ? PLANNING_REASON_WATERFALL
          : PLANNING_REASON_SHARED,
        _planning_score: 0,
      });
    }
    for (const row of traceResult.flow_summary.terminal_consumers) {
      secondary.push({ ...row, planning_reason: PLANNING_REASON_DOWNSTREAM, _planning_score: 0 });
    }
    const likelySecondaryReviewSurfaces = orderedUnique(secondary.sort(surfaceSortKey), (row) => row.element_name, 5).map((row) => compactSurface(row, true));
    const recommendedPrimaryEdits = recommendedPrimaryEditSequence(likelyPrimaryEditSurfaces, likelySecondaryReviewSurfaces);

    const downstreamImpacts: DownstreamImpactRow[] = [];
    for (const row of traceResult.shared_edit_surfaces) {
      if (row.shared_context_tags.length === 0) {
        continue;
      }
      downstreamImpacts.push({
        impact_type: 'shared_context_tags',
        element_name: row.element_name,
        effective_order_index: row.effective_order_index,
        context_tags: row.shared_context_tags,
      });
    }
    if (args.includeImpacts) {
      for (const row of traceResult.key_formulas) {
        downstreamImpacts.push({
          impact_type: 'formula_assignment',
          element_name: row.element_name,
          parameter_name: row.parameter_name,
          context_tags: row.output_context_tags,
        });
      }
    }

    let objectLayerFieldsToValidate: ResolvedObjectField[] = [];
    let lineageSummary: LineageSummary | undefined;
    if (args.context) {
      const crosswalkResult: TagCenteredCrosswalkResult = buildTagCrosswalkView(
        args.requestedTag,
        procedureRowsForTag(versions, args.requestedTag),
        args.context,
        {
          distinct: false,
          includeMappings: true,
          includeHydration: false,
          includeProcedureReferences: false,
          includeContextMatchesFull: false,
          object: args.objectName,
        },
      );
      objectLayerFieldsToValidate = crosswalkResult.resolved_object_fields.slice(0, 5);
      lineageSummary = {
        likely_upstream_procedure_elements: crosswalkResult.procedure_reference_summary.top_referencing_elements.slice(0, 3),
        context_attribute: args.requestedTag,
        context_node: crosswalkResult.resolved_object_fields.slice(0, 3).map((row) => row.context_node),
        resolved_object_fields: crosswalkResult.resolved_object_fields
          .slice(0, 3)
          .filter((row) => row.object_name && row.resolved_field)
          .map((row) => `${row.object_name}.${row.resolved_field}`),
      };
    }

    return {
      planning_subject: subject,
      planning_summary: planningSummary(likelyPrimaryEditSurfaces, likelySecondaryReviewSurfaces),
      likely_primary_edit_surfaces: likelyPrimaryEditSurfaces,
      recommended_primary_edit_sequence: recommendedPrimaryEdits,
      likely_secondary_review_surfaces: likelySecondaryReviewSurfaces,
      downstream_impacts: downstreamImpacts.slice(0, 8),
      related_context_tags_to_validate: relatedValidationTags(traceResult, args.requestedTag),
      object_layer_fields_to_validate: objectLayerFieldsToValidate,
      recommended_review_steps: likelyPrimaryEditSurfaces
        .slice(0, 3)
        .filter((row) => row.element_name)
        .map((row) => `inspect-step --step-name ${row.element_name}`),
      recommended_validation_steps: [
        `trace-tag --tag ${args.requestedTag}`,
        `crosswalk --tag ${args.requestedTag} --include-mappings${args.objectName ? ` --object ${args.objectName}` : ''}`,
      ],
      ...(lineageSummary ? { lineage_summary: lineageSummary } : {}),
    };
  }

  const matchedSteps: CompactSurface[] = [];
  for (const version of versions) {
    for (const step of version.steps) {
      if (step.name === args.stepName) {
        matchedSteps.push({
          element_name: step.name,
          action_type: step.actionType,
          effective_order_index: typeof step.effective_order === 'object' && step.effective_order && 'index' in step.effective_order
            ? (step.effective_order as { index?: number | null }).index ?? null
            : null,
          parent_step: step.parentStep,
        });
      }
    }
  }
  return {
    planning_subject: {
      subject_type: 'step_name',
      step_name: args.stepName,
      version_scope: versions.map((version) => version.fullName),
    },
    planning_summary: {
      likely_final_calculation_surfaces: matchedSteps.slice(0, 3).map((row) => row.element_name).filter((value): value is string => Boolean(value)),
      likely_waterfall_exposure_surfaces: [],
    },
    likely_primary_edit_surfaces: matchedSteps.slice(0, 5),
    recommended_primary_edit_sequence: matchedSteps
      .slice(0, 3)
      .filter((row) => row.element_name)
      .map((row) => ({ element_name: row.element_name as string, why_first: 'requested step-centered starting point' })),
    likely_secondary_review_surfaces: [],
    downstream_impacts: [],
    related_context_tags_to_validate: [],
    object_layer_fields_to_validate: [],
    recommended_review_steps: [`inspect-step --step-name ${args.stepName}`],
    recommended_validation_steps: ['summarize --focus-tag <context-tag>'],
  };
}

function emptyPlanResult(): PlanChangeResult {
  return {
    planning_subject: {},
    planning_summary: {
      likely_final_calculation_surfaces: [],
      likely_waterfall_exposure_surfaces: [],
    },
    likely_primary_edit_surfaces: [],
    likely_secondary_review_surfaces: [],
    downstream_impacts: [],
    related_context_tags_to_validate: [],
    object_layer_fields_to_validate: [],
    recommended_review_steps: [],
    recommended_validation_steps: ['discover'],
  };
}

export function runPlanChange(args: PlanChangeArgs, startedAt: number): Envelope<PlanChangeResult> {
  const artifact = loadExpressionSet(args.file);
  requirePricingProcedure(artifact, 'plan-change');
  const versionSelector = resolveVersionSelectorWithActiveDefault(args.version, args.activeOnly);
  const versions = selectVersionsWithActiveDefault(artifact.versions, versionSelector, args.activeOnly);
  const sourceFiles = [args.file];

  if (versions.length === 0) {
    return makeEnvelope(
      'plan-change',
      makeSummary(args.file, 'No versions matched the requested selector.', {}, 'discover'),
      emptyPlanResult(),
      {
        warnings: [
          makeNotice(
            'version_not_found',
            'No versions matched the requested selector.',
            { selector: versionSelector ?? null },
            'Use discover or summarize to confirm the active version before planning edits.',
          ),
        ],
        status: 'no_match',
        source_files: sourceFiles,
        selector_input: {
          version: versionSelector ?? null,
          tag: args.tag ?? null,
          step_name: args.stepName ?? null,
          active_only: args.activeOnly,
        },
        started_at: startedAt,
      },
    );
  }

  const context = args.context ? loadContextDefinition(args.context) : undefined;
  if (context) {
    sourceFiles.push(args.context as string);
  }

  const result = buildChangePlan(artifact, versions, {
    requestedTag: args.tag,
    stepName: args.stepName,
    context,
    objectName: args.object,
    includeImpacts: args.includeImpacts,
  });

  const warnings = [];
  const hasSurfaces = result.likely_primary_edit_surfaces.length > 0 || result.likely_secondary_review_surfaces.length > 0;
  if (!hasSurfaces) {
    warnings.push(
      makeNotice(
        args.tag ? 'symbol_not_found' : 'step_not_found',
        'No planning surfaces matched the requested planning subject.',
        { tag: args.tag ?? null, step_name: args.stepName ?? null },
        'Use trace-tag, inspect-step --list-candidates, or summarize to narrow the planning subject.',
      ),
    );
  }

  return makeEnvelope(
    'plan-change',
    makeSummary(
      args.file,
      hasSurfaces ? 'Compact change plan completed.' : 'No planning surfaces matched the requested planning subject.',
      {
        primary_edit_surface_count: result.likely_primary_edit_surfaces.length,
        secondary_review_surface_count: result.likely_secondary_review_surfaces.length,
        downstream_impact_count: result.downstream_impacts.length,
      },
      result.likely_primary_edit_surfaces.length > 0 ? 'inspect-step' : 'trace-tag',
    ),
    result,
    {
      warnings,
      status: hasSurfaces ? 'ok' : 'no_match',
      source_files: sourceFiles,
      selector_input: {
        version: versionSelector ?? null,
        tag: args.tag ?? null,
        step_name: args.stepName ?? null,
        object: args.object ?? null,
        active_only: args.activeOnly,
      },
      started_at: startedAt,
    },
  );
}
