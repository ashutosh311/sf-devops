import { makeEnvelope, makeNotice, makeSummary } from './contracts/envelope';
import { PricingCliError } from './contracts/errors';
import type {
  Envelope,
  NormalizedProcedureArtifact,
  NormalizedProcedureVersion,
} from './contracts/types';
import { familyMatches, relatedFamilyMembers } from './domain/context_families';
import { resolveVersionSelectorWithActiveDefault, selectVersionsWithActiveDefault } from './domain/selectors';
import { loadExpressionSet, summarizeArtifact, type ProcedureArtifactSummary } from './parsing/normalize/procedure';

export interface SummarizeArgs {
  file: string;
  version?: string;
  activeOnly: boolean;
  focusTag?: string;
  json: boolean;
  failOn: 'none' | 'warn' | 'changed' | 'partial' | 'no_match' | 'unsupported';
}

interface ActiveVersionSummaryRow {
  fullName: string | null;
  status: string | null;
  rank: string | null;
  startDate: string | null;
  step_count: number;
}

interface TopContextTagRow {
  context_tag: string;
  reference_count: number;
}

interface ImportantContextTagFamilyRow {
  family: string;
  observed_context_tags: string[];
  reference_count: number;
}

interface TopLookupNameRow {
  lookup_name: string;
  reference_count: number;
}

interface FocusTagPresence {
  requested_tag: string;
  appears_exactly: boolean;
  exact_output_reference_count: number;
  related_family_tags_present: string[];
  recommended_command: string;
}

interface SummarizeResult {
  artifact_summary: ProcedureArtifactSummary;
  active_version_summary: ActiveVersionSummaryRow[];
  action_family_summary: Record<string, number>;
  output_context_tag_summary:
    | {
        distinct_output_context_tag_count: number;
        top_output_context_tags: TopContextTagRow[];
      }
    | Record<string, never>;
  important_context_tag_families: ImportantContextTagFamilyRow[];
  lookup_surface_summary:
    | {
        distinct_lookup_reference_count: number;
        top_lookup_names: TopLookupNameRow[];
      }
    | Record<string, never>;
  focus_tag_presence: FocusTagPresence | null;
  recommended_next_commands: string[];
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



function countOutputContextTags(versions: readonly NormalizedProcedureVersion[]): Map<string, number> {
  const counts = new Map<string, number>();
  for (const version of versions) {
    for (const step of version.steps) {
      for (const parameter of step.parameters) {
        if (parameter.output === 'true' && parameter.value) {
          counts.set(parameter.value, (counts.get(parameter.value) ?? 0) + 1);
        }
      }
    }
  }
  return counts;
}

function recommendedTraceCommands(tagNames: readonly string[]): string[] {
  return tagNames.filter((tagName) => Boolean(tagName)).slice(0, 3).map((tagName) => `trace-tag --tag ${tagName}`);
}

function sortCountEntries(counts: ReadonlyMap<string, number>): Array<[string, number]> {
  return Array.from(counts.entries()).sort((left, right) => {
    const countDelta = right[1] - left[1];
    if (countDelta !== 0) {
      return countDelta;
    }
    return left[0].localeCompare(right[0]);
  });
}

export function runSummarize(args: SummarizeArgs, startedAt: number): Envelope<SummarizeResult> {
  const artifact = loadExpressionSet(args.file);
  requirePricingProcedure(artifact, 'summarize');

  const versionSelector = resolveVersionSelectorWithActiveDefault(args.version, args.activeOnly);
  const versions = selectVersionsWithActiveDefault(artifact.versions, versionSelector, args.activeOnly);
  if (versions.length === 0) {
    return makeEnvelope(
      'summarize',
      makeSummary(args.file, 'No versions matched the requested selector.', {}, 'discover'),
      {
        artifact_summary: summarizeArtifact(artifact),
        active_version_summary: [],
        action_family_summary: {},
        output_context_tag_summary: {},
        important_context_tag_families: [],
        lookup_surface_summary: {},
        focus_tag_presence: null,
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
          focus_tag: args.focusTag ?? null,
          active_only: args.activeOnly,
        },
        started_at: startedAt,
      },
    );
  }

  const artifactSummary = summarizeArtifact({ ...artifact, versions });
  const activeVersionSummary: ActiveVersionSummaryRow[] = [];
  const actionFamilyCounts = new Map<string, number>();
  const lookupParameterNames = new Map<string, number>();
  const outputContextTagCounts = countOutputContextTags(versions);
  const familyRollup = new Map<string, { observed_context_tags: Set<string>; reference_count: number }>();

  for (const version of versions) {
    activeVersionSummary.push({
      fullName: version.fullName,
      status: version.status,
      rank: version.rank,
      startDate: version.startDate,
      step_count: version.steps.length,
    });

    for (const step of version.steps) {
      const actionKey = step.actionType ?? '<none>';
      actionFamilyCounts.set(actionKey, (actionFamilyCounts.get(actionKey) ?? 0) + 1);

      for (const parameter of step.parameters) {
        if (
          parameter.value
          && ['LookUpApiName', 'LookUpName', 'LookupApiName', 'LookupName'].includes(parameter.name ?? '')
        ) {
          lookupParameterNames.set(parameter.value, (lookupParameterNames.get(parameter.value) ?? 0) + 1);
        }
      }
    }
  }

  for (const [tagName, count] of Array.from(outputContextTagCounts.entries())) {
    for (const family of familyMatches(tagName)) {
      const existing = familyRollup.get(family.family) ?? {
        observed_context_tags: new Set<string>(),
        reference_count: 0,
      };
      existing.observed_context_tags.add(tagName);
      existing.reference_count += count;
      familyRollup.set(family.family, existing);
    }
  }

  let focusPresence: FocusTagPresence | null = null;
  if (args.focusTag) {
    const relatedMembers = relatedFamilyMembers(args.focusTag);
    const exactCount = outputContextTagCounts.get(args.focusTag) ?? 0;
    const familyMatchesPresent = relatedMembers.filter(
      (tag) => tag !== args.focusTag && outputContextTagCounts.has(tag),
    );

    focusPresence = {
      requested_tag: args.focusTag,
      appears_exactly: exactCount > 0,
      exact_output_reference_count: exactCount,
      related_family_tags_present: familyMatchesPresent,
      recommended_command:
        exactCount > 0 || familyMatchesPresent.length > 0 ? `trace-tag --tag ${args.focusTag}` : 'discover',
    };
  }

  const sortedOutputContextTagCounts = sortCountEntries(outputContextTagCounts);
  const hotTags = sortedOutputContextTagCounts.slice(0, 5).map(([name]) => name);
  const result: SummarizeResult = {
    artifact_summary: artifactSummary,
    active_version_summary: activeVersionSummary,
    action_family_summary: Object.fromEntries(sortCountEntries(actionFamilyCounts)),
    output_context_tag_summary: {
      distinct_output_context_tag_count: outputContextTagCounts.size,
      top_output_context_tags: sortedOutputContextTagCounts.slice(0, 10).map(([contextTag, referenceCount]) => ({
        context_tag: contextTag,
        reference_count: referenceCount,
      })),
    },
    important_context_tag_families: Array.from(familyRollup.entries())
      .sort((left, right) => left[0].localeCompare(right[0]))
      .map(([family, payload]) => ({
        family,
        observed_context_tags: Array.from(payload.observed_context_tags).sort(),
        reference_count: payload.reference_count,
      })),
    lookup_surface_summary: {
      distinct_lookup_reference_count: lookupParameterNames.size,
      top_lookup_names: sortCountEntries(lookupParameterNames).slice(0, 10).map(([lookupName, referenceCount]) => ({
        lookup_name: lookupName,
        reference_count: referenceCount,
      })),
    },
    focus_tag_presence: focusPresence,
    recommended_next_commands:
      args.focusTag && focusPresence && (focusPresence.appears_exactly || focusPresence.related_family_tags_present.length > 0)
        ? [`trace-tag --tag ${args.focusTag}`, `crosswalk --tag ${args.focusTag} --include-mappings`]
        : [...recommendedTraceCommands(hotTags), 'inspect-step --step-name <step-name>'],
  };

  return makeEnvelope(
    'summarize',
    makeSummary(
      args.file,
      'Summary completed.',
      {
        version_count: versions.length,
        step_count: versions.reduce((sum, version) => sum + version.steps.length, 0),
        distinct_output_context_tag_count: outputContextTagCounts.size,
      },
      hotTags.length > 0 ? 'trace-tag' : 'inspect-step',
    ),
    result,
    {
      status: 'ok',
      source_files: [args.file],
      selector_input: {
        version: versionSelector ?? null,
        focus_tag: args.focusTag ?? null,
        active_only: args.activeOnly,
      },
      started_at: startedAt,
    },
  );
}
