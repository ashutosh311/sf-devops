import { makeEnvelope, makeNotice, makeSummary } from './contracts/envelope';
import { PricingCliError } from './contracts/errors';
import type {
  Envelope,
  Finding,
  NormalizedContextDefinition,
  NormalizedProcedureArtifact,
  Notice,
} from './contracts/types';
import { selectVersions } from './domain/selectors';
import { summarizeArtifact, loadExpressionSet, type ProcedureArtifactSummary } from './parsing/normalize/procedure';
import { loadContextDefinition } from './parsing/normalize/context';

export interface ValidateArgs {
  file: string;
  version?: string;
  context?: string;
  json: boolean;
  failOn: 'none' | 'warn' | 'changed' | 'partial' | 'no_match' | 'unsupported';
}

interface ContextCrosscheck {
  attribute_matches: string[];
  tag_matches: string[];
  unmatched_output_values: string[];
}

interface ValidateResult {
  artifact: ProcedureArtifactSummary;
  findings: Finding[];
  finding_counts: {
    by_severity?: Record<string, number>;
    by_family?: Record<string, number>;
    total: number;
  };
  validation_scope: {
    version: string | null;
    context: string | null;
    context_crosscheck?: ContextCrosscheck | null;
  };
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

function finding(
  code: string,
  severity: string,
  family: string,
  message: string,
  pathHint: string,
  details: Record<string, unknown> = {},
  suggestion = '',
  evidenceLevel = 'source-backed',
): Finding {
  return {
    code,
    severity,
    family,
    message,
    path_hint: pathHint,
    details,
    suggestion,
    evidence_level: evidenceLevel,
  };
}

function summarizeFindings(findings: readonly Finding[]): ValidateResult['finding_counts'] {
  const bySeverity: Record<string, number> = {};
  const byFamily: Record<string, number> = {};
  for (const item of findings) {
    bySeverity[item.severity] = (bySeverity[item.severity] ?? 0) + 1;
    byFamily[item.family] = (byFamily[item.family] ?? 0) + 1;
  }
  return {
    by_severity: bySeverity,
    by_family: byFamily,
    total: findings.length,
  };
}

function exactTitles(values: Record<string, unknown>): string[] {
  return Object.keys(values);
}

function collectContextCrosscheck(
  context: NormalizedContextDefinition,
  outputValues: ReadonlySet<string>,
): ContextCrosscheck {
  const attributeTitles = new Set(exactTitles(context.attributes));
  const tagTitles = new Set(exactTitles(context.tags));
  const outputValueList = Array.from(outputValues);

  const attributeMatches = outputValueList.filter((value) => attributeTitles.has(value)).sort();
  const tagMatches = outputValueList.filter((value) => tagTitles.has(value)).sort();
  const unmatchedOutputValues = outputValueList
    .filter((value) => !attributeTitles.has(value) && !tagTitles.has(value))
    .sort();

  return {
    attribute_matches: attributeMatches,
    tag_matches: tagMatches,
    unmatched_output_values: unmatchedOutputValues,
  };
}

export function runValidate(args: ValidateArgs, startedAt: number): Envelope<ValidateResult> {
  const warnings: Notice[] = [];
  const artifact = loadExpressionSet(args.file);
  const sourceFiles = [args.file];
  requirePricingProcedure(artifact, 'validate');

  const versions = selectVersions(artifact.versions, args.version);
  if (versions.length === 0) {
    return makeEnvelope(
      'validate',
      makeSummary(args.file, 'No matching version selector.', {}, 'discover'),
      {
        artifact: summarizeArtifact(artifact),
        findings: [],
        finding_counts: { total: 0 },
        validation_scope: {
          version: args.version ?? null,
          context: args.context ?? null,
        },
      },
      {
        warnings: [
          makeNotice(
            'version_not_found',
            'No versions matched the requested selector.',
            { selector: args.version ?? null },
            'Use discover or summarize to list available versions.',
          ),
        ],
        status: 'no_match',
        source_files: sourceFiles,
        selector_input: { version: args.version ?? null, context: args.context ?? null },
        started_at: startedAt,
      },
    );
  }

  const findings: Finding[] = [];
  if (artifact.interface_source_type.length === 0) {
    findings.push(
      finding(
        'missing_interface_source_type',
        'error',
        'classification',
        'Missing interfaceSourceType.',
        '/interfaceSourceType',
        {},
        'Add interfaceSourceType to the root metadata.',
      ),
    );
  }
  if (artifact.process_types.length === 0) {
    findings.push(
      finding(
        'missing_process_type',
        'error',
        'structural',
        'Missing processType.',
        '/processType',
        {},
        'Add processType to the root metadata.',
      ),
    );
  }
  if (artifact.context_definitions.length === 0) {
    findings.push(
      finding(
        'missing_context_definitions',
        'error',
        'dependency',
        'Missing contextDefinitions.',
        '/contextDefinitions',
        {},
        'Add at least one contextDefinitions value.',
      ),
    );
  }

  const activeCount = artifact.versions.filter((version) => version.status === 'Active').length;
  if (activeCount === 0) {
    findings.push(
      finding(
        'no_active_versions',
        'warning',
        'semantic',
        'No active versions found.',
        '/versions',
        {},
        'Confirm which version should be active before editing.',
      ),
    );
  }
  if (activeCount > 1) {
    warnings.push(
      makeNotice(
        'multiple_active_versions',
        'Multiple active versions found.',
        { active_version_count: activeCount },
        'Review version statuses and rank before editing or diffing.',
      ),
    );
  }

  const outputValues = new Set<string>();
  for (const version of versions) {
    if (!version.fullName) {
      findings.push(
        finding(
          'missing_version_full_name',
          'error',
          'structural',
          'Version missing fullName.',
          '/versions/fullName',
          {},
          'Populate the version fullName.',
        ),
      );
    }
    if (!version.status) {
      findings.push(
        finding(
          'missing_version_status',
          'error',
          'structural',
          `Version ${version.fullName ?? '<unknown>'} missing status.`,
          '/versions/status',
          {},
          'Populate the version status.',
        ),
      );
    }

    for (const step of version.steps) {
      const name = step.name ?? '<unnamed-step>';
      if (!step.name) {
        findings.push(
          finding(
            'missing_step_name',
            'error',
            'structural',
            'Step missing name.',
            `/versions/${version.fullName}/steps/name`,
            {},
            'Populate the step name.',
          ),
        );
      }
      if (!step.stepType) {
        findings.push(
          finding(
            'missing_step_type',
            'error',
            'structural',
            `Step ${name} missing stepType.`,
            `/versions/${version.fullName}/steps/${name}/stepType`,
            {},
            'Populate the stepType.',
          ),
        );
      }
      const sequenceNumber = step.sequenceNumber;
      if (sequenceNumber == null) {
        findings.push(
          finding(
            'missing_sequence_number',
            'error',
            'structural',
            `Step ${name} missing sequenceNumber.`,
            `/versions/${version.fullName}/steps/${name}/sequenceNumber`,
            {},
            'Populate the sequenceNumber.',
          ),
        );
      } else if (!/^\d+$/.test(String(sequenceNumber))) {
        findings.push(
          finding(
            'non_integer_sequence_number',
            'warning',
            'semantic',
            `Step ${name} has non-integer sequenceNumber.`,
            `/versions/${version.fullName}/steps/${name}/sequenceNumber`,
            { sequenceNumber },
            'Use an integer sequenceNumber where possible.',
          ),
        );
      }

      for (const parameter of step.parameters) {
        const parameterName = parameter.name ?? '<unnamed-parameter>';
        if (parameter.name == null) {
          findings.push(
            finding(
              'missing_parameter_name',
              'warning',
              'structural',
              `Step ${name} has a parameter missing name.`,
              `/versions/${version.fullName}/steps/${name}/parameters/name`,
              {},
              'Populate the parameter name.',
            ),
          );
        }
        if (parameter.type == null) {
          findings.push(
            finding(
              'missing_parameter_type',
              'warning',
              'structural',
              `Parameter ${parameterName} missing type.`,
              `/versions/${version.fullName}/steps/${name}/parameters/${parameterName}/type`,
              {},
              'Populate the parameter type.',
            ),
          );
        }
        if (parameter.input == null || parameter.output == null) {
          findings.push(
            finding(
              'missing_parameter_io_flags',
              'warning',
              'structural',
              `Parameter ${parameterName} missing input/output flags.`,
              `/versions/${version.fullName}/steps/${name}/parameters/${parameterName}`,
              {},
              'Populate both input and output flags.',
            ),
          );
        }
        if (parameter.output === 'true' && parameter.value) {
          outputValues.add(parameter.value);
        }
      }
    }
  }

  let contextCrosscheck: ContextCrosscheck | null | undefined;
  if (args.context) {
    sourceFiles.push(args.context);
    try {
      const context = loadContextDefinition(args.context);
      contextCrosscheck = collectContextCrosscheck(context, outputValues);
      if (contextCrosscheck.unmatched_output_values.length > 0) {
        findings.push(
          finding(
            'unmatched_output_values',
            'warning',
            'dependency',
            'Some output values did not exactly match context attributes or tags.',
            '/contextDefinitions',
            { unmatched_output_values: contextCrosscheck.unmatched_output_values },
            'Use crosswalk for deeper linkage analysis.',
            'org-retrieval-backed',
          ),
        );
      }
    } catch (error) {
      const cliError =
        error instanceof PricingCliError
          ? error
          : new PricingCliError(
              'internal_contract_error',
              error instanceof Error ? error.message : 'Unknown context validation failure.',
              {},
              'Inspect the TS validate workflow implementation and rerun.',
            );
      warnings.push(makeNotice(cliError.code, cliError.message, cliError.details, cliError.suggestion));
      contextCrosscheck = {
        attribute_matches: [],
        tag_matches: [],
        unmatched_output_values: Array.from(outputValues).sort(),
      };
    }
  }

  const findingCounts = summarizeFindings(findings);
  const status = findingCounts.by_severity?.error || findingCounts.by_severity?.warning ? 'warn' : 'ok';

  return makeEnvelope(
    'validate',
    makeSummary(args.file, 'Validation completed.', findingCounts, args.context ? 'crosswalk' : 'summarize'),
    {
      artifact: summarizeArtifact(artifact),
      findings,
      finding_counts: findingCounts,
      validation_scope: {
        version: args.version ?? null,
        context: args.context ?? null,
        context_crosscheck: args.context ? (contextCrosscheck ?? null) : null,
      },
    },
    {
      warnings,
      status,
      source_files: sourceFiles,
      selector_input: { version: args.version ?? null, context: args.context ?? null },
      started_at: startedAt,
    },
  );
}
