import type {
  NormalizedProcedureArtifact,
  NormalizedProcedureParameter,
  NormalizedProcedureStep,
  NormalizedProcedureVersion,
} from '../../contracts/types';
import { classifyExpressionSet } from '../classifier';
import { computeEffectiveOrder } from '../effective_order';
import { findAll, loadExpressionSetRoot, txt, type XmlElementNode } from '../xml_loader';

export interface ProcedureArtifactSummary {
  path: string;
  artifact_family: string;
  is_pricing_procedure: boolean;
  interface_source_type: string[];
  process_types: string[];
  context_definitions: string[];
  version_count: number;
  active_version_count: number;
  active_versions: string[];
  step_count_summary: {
    total_steps: number;
    min_steps_per_version: number;
    max_steps_per_version: number;
  };
  classification_evidence: NormalizedProcedureArtifact['classification_evidence'];
  top_action_types: Record<string, number>;
  top_step_types: Record<string, number>;
  candidate_adjacent_family: string | null;
}

interface CounterState {
  count: number;
  order: number;
}

function collectTexts(node: XmlElementNode, path: string): string[] {
  return findAll(node, path)
    .map((match) => match.text)
    .filter((value): value is string => Boolean(value));
}

function loadStepParameters(step: XmlElementNode): NormalizedProcedureParameter[] {
  return findAll(step, './/m:parameters').map((parameter, index) => ({
    param_index: index + 1,
    name: txt(parameter, 'm:name'),
    type: txt(parameter, 'm:type'),
    input: txt(parameter, 'm:input'),
    output: txt(parameter, 'm:output'),
    value: txt(parameter, 'm:value'),
  }));
}

function loadVersionSteps(version: XmlElementNode): NormalizedProcedureStep[] {
  const steps = findAll(version, 'm:steps').map((step, index) => ({
    xml_index: index + 1,
    name: txt(step, 'm:name'),
    label: txt(step, 'm:label'),
    description: txt(step, 'm:description'),
    actionType: txt(step, 'm:actionType'),
    stepType: txt(step, 'm:stepType'),
    sequenceNumber: txt(step, 'm:sequenceNumber'),
    parentStep: txt(step, 'm:parentStep'),
    resultIncluded: txt(step, 'm:resultIncluded'),
    parameters: loadStepParameters(step),
  }));

  return computeEffectiveOrder(steps);
}

export function loadExpressionSet(path: string): NormalizedProcedureArtifact {
  const root = loadExpressionSetRoot(path);
  const interfaceSourceTypes = collectTexts(root, 'm:interfaceSourceType');
  const processTypes = collectTexts(root, 'm:processType');
  const classification = classifyExpressionSet(interfaceSourceTypes, processTypes);
  const versions: NormalizedProcedureVersion[] = findAll(root, 'm:versions').map((version) => ({
    fullName: txt(version, 'm:fullName'),
    status: txt(version, 'm:status'),
    rank: txt(version, 'm:rank'),
    startDate: txt(version, 'm:startDate'),
    label: txt(version, 'm:label'),
    description: txt(version, 'm:description'),
    processType: txt(version, 'm:processType'),
    interfaceSourceType: txt(version, 'm:interfaceSourceType'),
    decimalScale: txt(version, 'm:decimalScale'),
    steps: loadVersionSteps(version),
  }));

  return {
    path,
    root_tag: root.tag.split('}').at(-1) ?? root.tag,
    label: collectTexts(root, 'm:label'),
    context_definitions: collectTexts(root, 'm:contextDefinitions'),
    interface_source_type: interfaceSourceTypes,
    process_types: processTypes,
    ...classification,
    versions,
  };
}

function counterEntries(values: readonly (string | null | undefined)[]): Array<[string, number]> {
  const counts = new Map<string, CounterState>();
  let order = 0;

  for (const value of values) {
    const key = value ?? '<none>';
    const existing = counts.get(key);
    if (existing) {
      existing.count += 1;
      continue;
    }

    counts.set(key, { count: 1, order });
    order += 1;
  }

  return Array.from(counts.entries())
    .sort((left, right) => {
      const countDelta = right[1].count - left[1].count;
      if (countDelta !== 0) {
        return countDelta;
      }
      return left[1].order - right[1].order;
    })
    .map(([key, state]) => [key, state.count]);
}

function topCounts(values: readonly (string | null | undefined)[]): Record<string, number> {
  return Object.fromEntries(counterEntries(values).slice(0, 5));
}

export function summarizeArtifact(artifact: NormalizedProcedureArtifact): ProcedureArtifactSummary {
  const activeVersions = artifact.versions
    .filter((version) => version.status === 'Active')
    .map((version) => version.fullName)
    .filter((value): value is string => Boolean(value));
  const stepCounts = artifact.versions.map((version) => version.steps.length);
  const allSteps = artifact.versions.flatMap((version) => version.steps);

  return {
    path: artifact.path,
    artifact_family: artifact.artifact_family,
    is_pricing_procedure: artifact.is_pricing_procedure,
    interface_source_type: artifact.interface_source_type,
    process_types: artifact.process_types,
    context_definitions: artifact.context_definitions,
    version_count: artifact.versions.length,
    active_version_count: activeVersions.length,
    active_versions: activeVersions,
    step_count_summary: {
      total_steps: stepCounts.reduce((sum, count) => sum + count, 0),
      min_steps_per_version: stepCounts.length > 0 ? Math.min(...stepCounts) : 0,
      max_steps_per_version: stepCounts.length > 0 ? Math.max(...stepCounts) : 0,
    },
    classification_evidence: artifact.classification_evidence,
    top_action_types: topCounts(allSteps.map((step) => step.actionType)),
    top_step_types: topCounts(allSteps.map((step) => step.stepType)),
    candidate_adjacent_family: artifact.candidate_adjacent_family,
  };
}

export const load_expression_set = loadExpressionSet;
export const summarize_artifact = summarizeArtifact;
