import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import * as path from 'node:path';

import { createDiscoveryCommandMeta, createDiscoveryEnvelope, SFX_TOOL_VERSION } from '../../../runtime/envelope';
import { assertCanonicalRunId, getEvidenceArtifactRelativePath, getRunArtifactPaths, resolveRunRelativePath } from '../../../runtime/artifacts';
import { commandToSlug } from '../../../runtime/ids';
import { LocalFileRunManager, type RunCommandRecord } from '../../../runtime/run-manager';
import type { OrgBaselinePayload } from '../../discover/org-baseline';
import type { ProjectInventoryPayload } from '../../discover/project-inventory';
import type {
  DiscoveryBriefClaim,
  DiscoveryBriefEnvelope,
  DiscoveryBriefEnvelopeSource,
  DiscoveryBriefExecutionResult,
  DiscoveryBriefPayload,
  DiscoveryBriefSourceArtifacts,
  EvidenceLink,
  ExecuteDiscoveryBriefOptions,
} from './types';

const DISCOVERY_BRIEF_COMMAND = 'sfx synth discovery-brief';
const PROJECT_INVENTORY_SLUG = commandToSlug('sfx discover project-inventory');
const ORG_BASELINE_SLUG = commandToSlug('sfx discover org-baseline');
const SYNTH_REPO_EVIDENCE_ID = 'ev_synth_discovery_brief_repo_grounding_001';
const SYNTH_ORG_EVIDENCE_ID = 'ev_synth_discovery_brief_org_grounding_001';
const SYNTH_TRACE_EVIDENCE_ID = 'ev_synth_discovery_brief_trace_001';

type SourceEnvelope<TResult> = {
  command: string;
  status: string;
  result: TResult;
  warnings?: Array<{ code: string; message: string }>;
  errors?: Array<{ code: string; message: string }>;
  evidence?: Array<{ label: string; detail: string; source?: string }>;
  meta?: { command_execution_id?: string };
};

interface ClaimBuildOptions {
  claim_id: string;
  claim_type: DiscoveryBriefClaim['claim_type'];
  text: string;
  derivation_type: DiscoveryBriefClaim['derivation_type'];
  confidence_level: DiscoveryBriefClaim['confidence_level'];
  evidence_links: EvidenceLink[];
  caveats?: string[];
  priority?: 1 | 2 | 3;
  rank?: number;
  recommended_validation_target?: string;
  question_goal?: string;
}

function shellQuote(value: string): string {
  return /^[A-Za-z0-9_./:-]+$/.test(value)
    ? value
    : `'${value.replace(/'/g, `'\\''`)}'`;
}

function buildDiscoveryBriefCommand(runId: string): string {
  return `${DISCOVERY_BRIEF_COMMAND} --run-id ${shellQuote(runId)} --json`;
}

function readJsonFile<T>(filePath: string): T {
  return JSON.parse(readFileSync(filePath, 'utf8')) as T;
}

function createClaim(options: ClaimBuildOptions): DiscoveryBriefClaim {
  return {
    claim_id: options.claim_id,
    claim_type: options.claim_type,
    text: options.text,
    derivation_type: options.derivation_type,
    confidence_level: options.confidence_level,
    evidence_links: options.evidence_links.map((link) => ({ ...link })),
    caveats: [...(options.caveats ?? [])],
    priority: options.priority,
    rank: options.rank,
    recommended_validation_target: options.recommended_validation_target,
    question_goal: options.question_goal,
  };
}

function createEvidenceLink(options: EvidenceLink): EvidenceLink {
  return { ...options };
}

function readSourceEnvelope<TResult>(options: {
  runRootPath: string;
  commandRecord: RunCommandRecord;
}): DiscoveryBriefEnvelopeSource & { result: TResult } {
  const outputArtifactRelativePath = options.commandRecord.output_artifacts[0];
  if (!outputArtifactRelativePath) {
    throw new Error(`SYNTH_SOURCE_OUTPUT_MISSING: ${options.commandRecord.command_slug}`);
  }

  const outputArtifactAbsolutePath = resolveRunRelativePath(options.runRootPath, outputArtifactRelativePath);
  if (!existsSync(outputArtifactAbsolutePath)) {
    throw new Error(`SYNTH_SOURCE_OUTPUT_MISSING: ${options.commandRecord.command_slug}`);
  }

  let envelope: SourceEnvelope<TResult>;
  try {
    envelope = readJsonFile<SourceEnvelope<TResult>>(outputArtifactAbsolutePath);
  } catch {
    throw new Error(`SYNTH_SOURCE_OUTPUT_INVALID: ${options.commandRecord.command_slug}`);
  }

  return {
    result: envelope.result as TResult,
    command_execution_id: options.commandRecord.command_execution_id,
    command_slug: options.commandRecord.command_slug,
    command: envelope.command,
    status: options.commandRecord.status,
    output_artifact_path: outputArtifactRelativePath,
  };
}

function findLatestCommand(runCommands: readonly RunCommandRecord[], commandSlug: string): RunCommandRecord | undefined {
  for (let index = runCommands.length - 1; index >= 0; index -= 1) {
    const commandRecord = runCommands[index];
    if (commandRecord?.command_slug === commandSlug) {
      return commandRecord;
    }
  }

  return undefined;
}

function collectSourceArtifacts(repoRoot: string, sourceRunId: string, runManager: LocalFileRunManager): DiscoveryBriefSourceArtifacts {
  assertCanonicalRunId(sourceRunId);
  const runPaths = getRunArtifactPaths(repoRoot, sourceRunId);
  if (!existsSync(runPaths.runFilePath)) {
    throw new Error(`RUN_ID_NOT_FOUND: ${sourceRunId}`);
  }

  const runRecord = runManager.readRun(runPaths.runFilePath);
  const projectInventoryCommand = findLatestCommand(runRecord.commands, PROJECT_INVENTORY_SLUG);
  const orgBaselineCommand = findLatestCommand(runRecord.commands, ORG_BASELINE_SLUG);

  if (!projectInventoryCommand) {
    throw new Error('SYNTH_SOURCE_COMMAND_MISSING: discover.project-inventory');
  }

  if (!orgBaselineCommand) {
    throw new Error('SYNTH_SOURCE_COMMAND_MISSING: discover.org-baseline');
  }

  return {
    source_run_id: sourceRunId,
    project_inventory: readSourceEnvelope<ProjectInventoryPayload>({
      runRootPath: runPaths.rootPath,
      commandRecord: projectInventoryCommand,
    }),
    org_baseline: readSourceEnvelope<OrgBaselinePayload>({
      runRootPath: runPaths.rootPath,
      commandRecord: orgBaselineCommand,
    }),
  };
}

function pluralize(count: number, singular: string, plural = `${singular}s`): string {
  return `${count} ${count === 1 ? singular : plural}`;
}

function toList(values: readonly string[], fallback = 'no explicit items'): string {
  return values.length > 0 ? values.join(', ') : fallback;
}

function deriveTopDomainLabel(projectInventory: ProjectInventoryPayload): string | null {
  return projectInventory.candidate_domains[0]?.label ?? null;
}

function derivePrimaryPackageLabel(orgBaseline: OrgBaselinePayload): string | null {
  return orgBaseline.installed_packages[0]?.package_name ?? null;
}

function derivePayload(sourceArtifacts: DiscoveryBriefSourceArtifacts): DiscoveryBriefPayload {
  const projectInventory = sourceArtifacts.project_inventory.result;
  const orgBaseline = sourceArtifacts.org_baseline.result;
  const metadataFamilyCount = Object.keys(projectInventory.metadata_family_counts).length;
  const packageRootCount = projectInventory.package_roots.length;
  const domainCount = projectInventory.candidate_domains.length;
  const hotspotCount = projectInventory.hotspots.length;
  const installedPackageCount = orgBaseline.installed_packages.length;
  const automationCount = orgBaseline.automation_surfaces.length;
  const securityHintCount = orgBaseline.security_surface_hints.length;
  const topDomain = deriveTopDomainLabel(projectInventory);
  const primaryPackage = derivePrimaryPackageLabel(orgBaseline);
  const repoWarningCaveat = (projectInventory.warnings_summary?.length ?? 0) > 0
    ? [`Repository inventory carried ${(projectInventory.warnings_summary ?? []).length} upstream warning(s).`]
    : [];
  const orgWarningCaveat = (orgBaseline.warnings_summary?.length ?? 0) > 0
    ? [`Org baseline carried ${(orgBaseline.warnings_summary ?? []).length} upstream warning(s).`]
    : [];
  const orgLimitationsCaveat = (orgBaseline.limitations?.length ?? 0) > 0
    ? [`Org baseline limitations remain: ${toList(orgBaseline.limitations ?? [])}.`]
    : [];

  const repoSummaryLink = createEvidenceLink({
    evidence_id: SYNTH_REPO_EVIDENCE_ID,
    support_type: 'primary',
    fact_path: '/fact_payload/repo_summary',
    locator_excerpt: 'repository summary from saved project inventory output',
  });
  const repoDomainLink = createEvidenceLink({
    evidence_id: SYNTH_REPO_EVIDENCE_ID,
    support_type: 'primary',
    fact_path: '/fact_payload/candidate_domains',
    locator_excerpt: 'candidate domain list from saved project inventory output',
  });
  const repoHotspotLink = createEvidenceLink({
    evidence_id: SYNTH_REPO_EVIDENCE_ID,
    support_type: 'supporting',
    fact_path: '/fact_payload/hotspots',
    locator_excerpt: 'repository hotspot summary from saved project inventory output',
  });
  const orgSummaryLink = createEvidenceLink({
    evidence_id: SYNTH_ORG_EVIDENCE_ID,
    support_type: 'primary',
    fact_path: '/fact_payload/org_summary',
    locator_excerpt: 'org summary from saved org baseline output',
  });
  const orgPackageLink = createEvidenceLink({
    evidence_id: SYNTH_ORG_EVIDENCE_ID,
    support_type: 'primary',
    fact_path: '/fact_payload/installed_packages',
    locator_excerpt: 'installed package summary from saved org baseline output',
  });
  const orgAutomationLink = createEvidenceLink({
    evidence_id: SYNTH_ORG_EVIDENCE_ID,
    support_type: 'supporting',
    fact_path: '/fact_payload/automation_surfaces',
    locator_excerpt: 'automation surface summary from saved org baseline output',
  });
  const orgSecurityLink = createEvidenceLink({
    evidence_id: SYNTH_ORG_EVIDENCE_ID,
    support_type: 'primary',
    fact_path: '/fact_payload/security_surface_hints',
    locator_excerpt: 'security surface hints from saved org baseline output',
  });
  const traceLink = createEvidenceLink({
    evidence_id: SYNTH_TRACE_EVIDENCE_ID,
    support_type: 'supporting',
    fact_path: '/fact_payload/source_command_execution_ids',
    locator_excerpt: 'source command execution lineage for this synthesis pass',
  });

  const facts: DiscoveryBriefClaim[] = [
    createClaim({
      claim_id: 'clm_fact_001',
      claim_type: 'fact',
      text: `The saved project inventory shows ${pluralize(metadataFamilyCount, 'metadata family')} across ${pluralize(packageRootCount, 'package root')}, giving the team a grounded view of the repository surface before workshops.`,
      derivation_type: 'derived',
      confidence_level: 'high',
      evidence_links: [repoSummaryLink],
      caveats: repoWarningCaveat,
    }),
    createClaim({
      claim_id: 'clm_fact_002',
      claim_type: 'fact',
      text: topDomain
        ? `The repository scan surfaced ${pluralize(domainCount, 'candidate domain')}, with ${topDomain} ranking first from saved repo signals.`
        : `The repository scan did not isolate a dominant business domain, so early workshop scoping should stay broad until stakeholders validate the highest-value lane.`,
      derivation_type: 'derived',
      confidence_level: topDomain ? 'high' : 'medium',
      evidence_links: topDomain ? [repoDomainLink, repoHotspotLink] : [repoSummaryLink, repoHotspotLink],
      caveats: topDomain ? [] : ['Candidate domain ranking was weak or absent in the saved project inventory output.'],
    }),
    createClaim({
      claim_id: 'clm_fact_003',
      claim_type: 'fact',
      text: `The saved org baseline captured ${pluralize(installedPackageCount, 'installed package signal')} and ${pluralize(automationCount, 'automation surface indicator')}, confirming that workshop discussions can start from observed org capability breadth instead of conjecture.`,
      derivation_type: 'derived',
      confidence_level: 'high',
      evidence_links: [orgPackageLink, orgAutomationLink],
      caveats: [...orgWarningCaveat, ...orgLimitationsCaveat],
    }),
    createClaim({
      claim_id: 'clm_fact_004',
      claim_type: 'fact',
      text: securityHintCount > 0
        ? `The org baseline includes ${pluralize(securityHintCount, 'security or governance hint')}, so access and governance questions should be included in the first discovery workshop.`
        : `The org baseline did not surface explicit security or governance hints, so workshop participants should confirm whether those concerns are absent or simply not visible in the baseline pass.`,
      derivation_type: 'derived',
      confidence_level: securityHintCount > 0 ? 'medium' : 'low',
      evidence_links: securityHintCount > 0 ? [orgSecurityLink] : [orgSummaryLink],
      caveats: securityHintCount > 0 ? [] : [...orgWarningCaveat, ...orgLimitationsCaveat],
    }),
  ];

  const interpretations: DiscoveryBriefClaim[] = [
    createClaim({
      claim_id: 'clm_interp_001',
      claim_type: 'interpretation',
      text: 'The first discovery workshop can begin with an evidence-backed landscape view because both repository and org grounding artifacts already exist in the saved run.',
      derivation_type: 'inferred',
      confidence_level: 'high',
      evidence_links: [repoSummaryLink, orgSummaryLink, traceLink],
      caveats: [],
    }),
    createClaim({
      claim_id: 'clm_interp_002',
      claim_type: 'interpretation',
      text: topDomain
        ? `${topDomain} is the strongest current candidate for the first focused architecture lane, so follow-on exploration should likely be domain-scoped rather than generic.`
        : 'Because the repository signals do not yet converge on a single dominant domain, the workshop should spend explicit time selecting the first focused architecture lane.',
      derivation_type: 'inferred',
      confidence_level: topDomain ? 'medium' : 'medium',
      evidence_links: [repoDomainLink, repoHotspotLink],
      caveats: topDomain ? ['Stakeholder confirmation is still required before narrowing follow-on work too aggressively.'] : ['Repo-derived domain confidence is currently limited.'],
    }),
    createClaim({
      claim_id: 'clm_interp_003',
      claim_type: 'interpretation',
      text: securityHintCount > 0
        ? 'Governance and access constraints are likely to influence architecture tradeoffs early, so the workshop agenda should not treat them as an afterthought.'
        : 'The absence of explicit governance hints in the baseline should be validated directly, because invisible constraints can still shape architecture decisions.',
      derivation_type: 'inferred',
      confidence_level: securityHintCount > 0 ? 'medium' : 'low',
      evidence_links: securityHintCount > 0 ? [orgSecurityLink, orgSummaryLink] : [orgSummaryLink],
      caveats: securityHintCount > 0 ? [...orgLimitationsCaveat] : ['Governance-related signals may be underrepresented in the saved baseline output.'],
    }),
  ];

  const hypotheses: DiscoveryBriefClaim[] = [
    createClaim({
      claim_id: 'clm_hyp_001',
      claim_type: 'hypothesis',
      text: topDomain
        ? `The highest-value first deep-dive is likely in the ${topDomain} lane because it is the most concentrated signal visible across the saved discovery artifacts.`
        : 'The highest-value first deep-dive may emerge from stakeholder priority rather than from current repo signal concentration alone.',
      derivation_type: 'inferred',
      confidence_level: topDomain ? 'medium' : 'low',
      evidence_links: [repoDomainLink, orgPackageLink],
      caveats: ['This remains a workshop-validation hypothesis, not a grounded fact.'],
      recommended_validation_target: 'client sponsor and solution architect',
    }),
    createClaim({
      claim_id: 'clm_hyp_002',
      claim_type: 'hypothesis',
      text: securityHintCount > 0 || automationCount > 0
        ? 'Some of the observed implementation complexity is likely driven by governance and automation layering rather than business-process variation alone.'
        : 'Current complexity may be concentrated more in process design than in governance or automation, but the saved baseline is not strong enough to confirm that yet.',
      derivation_type: 'inferred',
      confidence_level: securityHintCount > 0 ? 'medium' : 'low',
      evidence_links: [orgAutomationLink, orgSecurityLink],
      caveats: ['This inference should be tested with platform owners and technical leads.'],
      recommended_validation_target: 'platform owner and technical lead',
    }),
  ];

  const openQuestions: DiscoveryBriefClaim[] = [
    createClaim({
      claim_id: 'clm_q_001',
      claim_type: 'open_question',
      text: topDomain
        ? `Should ${topDomain} be treated as the anchor business lane for the first architecture workshop?`
        : 'Which business domain should be treated as the anchor lane for the first architecture workshop?',
      derivation_type: 'inferred',
      confidence_level: 'medium',
      evidence_links: [repoDomainLink],
      caveats: [],
      question_goal: 'Confirm the most valuable next discovery lane before expanding scope.',
    }),
    createClaim({
      claim_id: 'clm_q_002',
      claim_type: 'open_question',
      text: 'How much of the observed solution complexity is driven by governance constraints versus business-process design?',
      derivation_type: 'inferred',
      confidence_level: securityHintCount > 0 ? 'medium' : 'low',
      evidence_links: [orgSecurityLink, orgAutomationLink],
      caveats: [],
      question_goal: 'Separate platform-imposed complexity from business-driven complexity.',
    }),
  ];

  const nextBestQuestions: DiscoveryBriefClaim[] = [
    createClaim({
      claim_id: 'clm_nbq_001',
      claim_type: 'open_question',
      text: topDomain
        ? `Which end-to-end ${topDomain} scenario should anchor the first architecture review workshop?`
        : 'Which end-to-end business scenario should anchor the first architecture review workshop?',
      derivation_type: 'inferred',
      confidence_level: 'high',
      evidence_links: [repoDomainLink],
      caveats: [],
      rank: 1,
      question_goal: 'Lock the highest-value workshop lane.',
      recommended_validation_target: 'client sponsor and solution architect',
    }),
    createClaim({
      claim_id: 'clm_nbq_002',
      claim_type: 'open_question',
      text: 'Which automation layers are business-critical versus legacy or accidental complexity?',
      derivation_type: 'inferred',
      confidence_level: 'medium',
      evidence_links: [orgAutomationLink],
      caveats: [],
      rank: 2,
      question_goal: 'Identify what later architecture recommendations must preserve versus simplify.',
      recommended_validation_target: 'technical lead',
    }),
    createClaim({
      claim_id: 'clm_nbq_003',
      claim_type: 'open_question',
      text: securityHintCount > 0
        ? 'Which governance or access constraints have already forced notable design tradeoffs in the current implementation?'
        : 'Are there governance or access constraints that are not visible in the saved baseline but still drive important design tradeoffs?',
      derivation_type: 'inferred',
      confidence_level: securityHintCount > 0 ? 'medium' : 'low',
      evidence_links: securityHintCount > 0 ? [orgSecurityLink] : [orgSummaryLink],
      caveats: [],
      rank: 3,
      question_goal: 'Surface hidden constraints before they are rediscovered late in the engagement.',
      recommended_validation_target: 'platform owner or governance lead',
    }),
  ];

  const risks: DiscoveryBriefClaim[] = [
    createClaim({
      claim_id: 'clm_risk_001',
      claim_type: 'interpretation',
      text: 'If the team does not explicitly separate grounded findings from workshop hypotheses, the first architecture narrative could drift away from what the saved artifacts actually support.',
      derivation_type: 'inferred',
      confidence_level: 'high',
      evidence_links: [traceLink, repoDomainLink],
      caveats: [],
    }),
  ];

  return {
    brief_context: {
      run_id: sourceArtifacts.source_run_id,
      scenario_refs: ['SCN-001', 'SCN-007'],
      source_command_execution_ids: [
        sourceArtifacts.project_inventory.command_execution_id,
        sourceArtifacts.org_baseline.command_execution_id,
      ],
      summary_scope: 'Initial project and org grounding before discovery workshops.',
    },
    facts,
    interpretations,
    hypotheses,
    open_questions: openQuestions,
    next_best_questions: nextBestQuestions,
    risks,
    suggested_workshop_agenda: [
      {
        agenda_item_id: 'ag_001',
        title: 'Confirm the first business-priority discovery lane',
        objective: 'Agree which end-to-end scenario should anchor the first architecture workshop.',
        related_claim_ids: ['clm_hyp_001', 'clm_nbq_001'],
        priority: 1,
      },
      {
        agenda_item_id: 'ag_002',
        title: 'Review automation and governance constraints',
        objective: 'Validate where platform constraints or legacy automation are shaping current design tradeoffs.',
        related_claim_ids: ['clm_interp_003', 'clm_nbq_002', 'clm_nbq_003'],
        priority: 2,
      },
      {
        agenda_item_id: 'ag_003',
        title: 'Plan the next focused discovery pass',
        objective: 'Choose the follow-on investigation lane after the first workshop based on validated priorities.',
        related_claim_ids: ['clm_interp_002', 'clm_q_001'],
        priority: 3,
      },
    ],
    stakeholder_validation_targets: [
      {
        target_id: 'svt_001',
        topic: 'Primary business-priority lane',
        why_validate: 'The next exploration wave should track the highest-value scenario rather than generic platform breadth.',
        related_claim_ids: ['clm_hyp_001', 'clm_nbq_001'],
      },
      {
        target_id: 'svt_002',
        topic: 'Governance-driven design constraints',
        why_validate: 'Governance and access pressures can materially change later architecture recommendations.',
        related_claim_ids: ['clm_interp_003', 'clm_hyp_002', 'clm_nbq_003'],
      },
    ],
    recommended_next_steps: [
      {
        step_id: 'next_001',
        text: topDomain
          ? `Use the first workshop to confirm whether ${topDomain} should become the first focused discovery lane.`
          : 'Use the first workshop to identify the highest-value domain before scheduling focused follow-on analysis.',
        step_type: 'workshop',
      },
      {
        step_id: 'next_002',
        text: 'Use the ranked next-best questions as the opening validation sequence in the discovery workshop.',
        step_type: 'workshop',
      },
      {
        step_id: 'next_003',
        text: primaryPackage
          ? `Review how ${primaryPackage} and related automation surfaces influence the current architecture narrative.`
          : 'Review the current package and automation mix to separate platform breadth from stakeholder-priority breadth.',
        step_type: 'analysis',
      },
    ],
  };
}

function countRows(value: unknown): number {
  if (Array.isArray(value)) {
    return value.length;
  }

  if (value && typeof value === 'object') {
    return Object.keys(value as Record<string, unknown>).length;
  }

  return value == null ? 0 : 1;
}

function computeChecksum(payload: Record<string, unknown>): string {
  const serializable = { ...payload };
  delete serializable.checksum;
  return `sha256:${createHash('sha256').update(JSON.stringify(serializable)).digest('hex')}`;
}

function writeEvidenceArtifact(options: {
  preparedRunRootPath: string;
  runId: string;
  evidenceId: string;
  sourceType: string;
  sourceLocator: string;
  captureParameters: Record<string, unknown>;
  factPayload: unknown;
  derivationType: 'derived' | 'inferred';
  confidenceLevel: 'high' | 'medium' | 'low';
  claimType: 'fact' | 'interpretation';
  tags: string[];
  parentEvidenceRefs?: string[];
  producedAt: string;
}): string {
  const relativePath = getEvidenceArtifactRelativePath(options.evidenceId);
  const absolutePath = resolveRunRelativePath(options.preparedRunRootPath, relativePath);
  mkdirSync(path.dirname(absolutePath), { recursive: true });

  const artifact: Record<string, unknown> = {
    schema_version: '1.0.0',
    evidence_id: options.evidenceId,
    run_id: options.runId,
    captured_at: options.producedAt,
    produced_by: {
      command_slug: commandToSlug(DISCOVERY_BRIEF_COMMAND),
      tool_version: SFX_TOOL_VERSION,
    },
    source_type: options.sourceType,
    source_locator: options.sourceLocator,
    environment: 'local-file',
    capture_parameters: { ...options.captureParameters },
    fact_payload: options.factPayload,
    extraction_method: 'artifact_reuse',
    derivation_type: options.derivationType,
    confidence_level: options.confidenceLevel,
    claim_type: options.claimType,
    sensitivity: 'low',
    redaction_applied: false,
    redaction_summary: 'none',
    row_count: countRows(options.factPayload),
    truncated: false,
    sample_strategy: 'none',
    artifact_path: relativePath,
    checksum: 'pending',
    tags: [...options.tags],
    parent_evidence_refs: [...(options.parentEvidenceRefs ?? [])],
  };
  artifact.checksum = computeChecksum(artifact);
  writeFileSync(absolutePath, `${JSON.stringify(artifact, null, 2)}\n`);
  return relativePath;
}

function deriveStatus(sourceArtifacts: DiscoveryBriefSourceArtifacts): 'ok' | 'warn' {
  const upstreamStatuses = [sourceArtifacts.project_inventory.status, sourceArtifacts.org_baseline.status];
  return upstreamStatuses.every((status) => status === 'ok') ? 'ok' : 'warn';
}

function buildSummary(payload: DiscoveryBriefPayload, status: 'ok' | 'warn'): string {
  const factCount = payload.facts.length;
  const interpretationCount = payload.interpretations.length;
  const questionCount = payload.open_questions.length + payload.next_best_questions.length;
  return status === 'ok'
    ? `Generated a discovery brief from saved grounding artifacts with ${pluralize(factCount, 'fact')}, ${pluralize(interpretationCount, 'interpretation')}, and ${pluralize(questionCount, 'prioritized question')}.`
    : `Generated a discovery brief from saved grounding artifacts with inherited upstream caveats; the brief still includes ${pluralize(factCount, 'fact')} and ${pluralize(questionCount, 'prioritized question')}.`;
}

function buildWarnings(sourceArtifacts: DiscoveryBriefSourceArtifacts, status: 'ok' | 'warn'): Array<{ code: string; message: string }> {
  if (status === 'ok') {
    return [];
  }

  const warnings: Array<{ code: string; message: string }> = [];
  if (sourceArtifacts.project_inventory.status !== 'ok') {
    warnings.push({
      code: 'SYNTH_SOURCE_PROJECT_INVENTORY_CAVEATED',
      message: `Project inventory source status was ${sourceArtifacts.project_inventory.status}; downstream synthesis should be treated with the same caveat level.`,
    });
  }
  if (sourceArtifacts.org_baseline.status !== 'ok') {
    warnings.push({
      code: 'SYNTH_SOURCE_ORG_BASELINE_CAVEATED',
      message: `Org baseline source status was ${sourceArtifacts.org_baseline.status}; downstream synthesis should be treated with the same caveat level.`,
    });
  }
  return warnings;
}

export function executeDiscoveryBrief(options: ExecuteDiscoveryBriefOptions): DiscoveryBriefExecutionResult {
  const command = buildDiscoveryBriefCommand(options.runId);
  const commandSlug = commandToSlug(DISCOVERY_BRIEF_COMMAND);
  const runManager = options.runManager ?? new LocalFileRunManager();
  const prepared = runManager.prepareCommandExecution({
    repoRoot: options.repoRoot,
    artifactRoot: options.artifactRoot,
    command,
    commandSlug,
    inputs: { run_id: options.runId },
    runId: options.appendRunId,
    newRun: options.newRun,
    outputFormat: 'json',
  });

  let status: 'ok' | 'warn' | 'error' = 'ok';
  let summary = 'Generated a discovery brief from saved grounding artifacts.';
  let result: DiscoveryBriefPayload = {
    brief_context: {
      run_id: options.runId,
      scenario_refs: ['SCN-001', 'SCN-007'],
      source_command_execution_ids: [],
      summary_scope: 'Initial project and org grounding before discovery workshops.',
    },
    facts: [],
    interpretations: [],
    hypotheses: [],
    open_questions: [],
    next_best_questions: [],
    risks: [],
    suggested_workshop_agenda: [],
    stakeholder_validation_targets: [],
    recommended_next_steps: [],
  };
  let warnings: Array<{ code: string; message: string }> = [];
  const errors: Array<{ code: string; message: string }> = [];
  const evidenceArtifactPaths: string[] = [];
  const evidenceRefs: string[] = [];
  let evidence: Array<{ label: string; detail: string; source?: string }> = [];

  try {
    const sourceArtifacts = collectSourceArtifacts(options.repoRoot, options.runId, runManager);
    result = derivePayload(sourceArtifacts);
    status = deriveStatus(sourceArtifacts);
    summary = buildSummary(result, status);
    warnings = buildWarnings(sourceArtifacts, status);

    const producedAt = new Date().toISOString();
    const repoEvidenceRelativePath = writeEvidenceArtifact({
      preparedRunRootPath: prepared.runRootPath,
      runId: prepared.runId,
      evidenceId: SYNTH_REPO_EVIDENCE_ID,
      sourceType: 'tool_output',
      sourceLocator: sourceArtifacts.project_inventory.output_artifact_path,
      captureParameters: {
        source_run_id: sourceArtifacts.source_run_id,
        source_command_execution_id: sourceArtifacts.project_inventory.command_execution_id,
        source_command_slug: sourceArtifacts.project_inventory.command_slug,
      },
      factPayload: {
        repo_summary: sourceArtifacts.project_inventory.result.repo_summary,
        metadata_family_counts: sourceArtifacts.project_inventory.result.metadata_family_counts,
        candidate_domains: sourceArtifacts.project_inventory.result.candidate_domains,
        hotspots: sourceArtifacts.project_inventory.result.hotspots,
      },
      derivationType: 'derived',
      confidenceLevel: 'high',
      claimType: 'fact',
      tags: ['synth', 'discovery-brief', 'repo-grounding'],
      producedAt,
    });
    evidenceArtifactPaths.push(repoEvidenceRelativePath);
    evidenceRefs.push(SYNTH_REPO_EVIDENCE_ID);

    const orgEvidenceRelativePath = writeEvidenceArtifact({
      preparedRunRootPath: prepared.runRootPath,
      runId: prepared.runId,
      evidenceId: SYNTH_ORG_EVIDENCE_ID,
      sourceType: 'tool_output',
      sourceLocator: sourceArtifacts.org_baseline.output_artifact_path,
      captureParameters: {
        source_run_id: sourceArtifacts.source_run_id,
        source_command_execution_id: sourceArtifacts.org_baseline.command_execution_id,
        source_command_slug: sourceArtifacts.org_baseline.command_slug,
      },
      factPayload: {
        org_summary: sourceArtifacts.org_baseline.result.org_summary,
        installed_packages: sourceArtifacts.org_baseline.result.installed_packages,
        automation_surfaces: sourceArtifacts.org_baseline.result.automation_surfaces,
        security_surface_hints: sourceArtifacts.org_baseline.result.security_surface_hints,
        limitations: sourceArtifacts.org_baseline.result.limitations ?? [],
      },
      derivationType: 'derived',
      confidenceLevel: sourceArtifacts.org_baseline.status === 'ok' ? 'high' : 'medium',
      claimType: 'fact',
      tags: ['synth', 'discovery-brief', 'org-grounding'],
      producedAt,
    });
    evidenceArtifactPaths.push(orgEvidenceRelativePath);
    evidenceRefs.push(SYNTH_ORG_EVIDENCE_ID);

    const traceEvidenceRelativePath = writeEvidenceArtifact({
      preparedRunRootPath: prepared.runRootPath,
      runId: prepared.runId,
      evidenceId: SYNTH_TRACE_EVIDENCE_ID,
      sourceType: 'tool_output',
      sourceLocator: getRunArtifactPaths(options.repoRoot, sourceArtifacts.source_run_id).runFilePath,
      captureParameters: {
        source_run_id: sourceArtifacts.source_run_id,
      },
      factPayload: {
        source_run_id: sourceArtifacts.source_run_id,
        source_command_execution_ids: result.brief_context.source_command_execution_ids,
        source_commands: [
          {
            command: sourceArtifacts.project_inventory.command,
            command_execution_id: sourceArtifacts.project_inventory.command_execution_id,
            output_artifact_path: sourceArtifacts.project_inventory.output_artifact_path,
          },
          {
            command: sourceArtifacts.org_baseline.command,
            command_execution_id: sourceArtifacts.org_baseline.command_execution_id,
            output_artifact_path: sourceArtifacts.org_baseline.output_artifact_path,
          },
        ],
      },
      derivationType: 'inferred',
      confidenceLevel: 'high',
      claimType: 'interpretation',
      tags: ['synth', 'discovery-brief', 'lineage'],
      parentEvidenceRefs: [SYNTH_REPO_EVIDENCE_ID, SYNTH_ORG_EVIDENCE_ID],
      producedAt,
    });
    evidenceArtifactPaths.push(traceEvidenceRelativePath);
    evidenceRefs.push(SYNTH_TRACE_EVIDENCE_ID);

    evidence = [
      {
        label: 'Repository grounding for discovery brief',
        detail: 'Normalized repo-side evidence reused from the saved project inventory output artifact.',
        source: repoEvidenceRelativePath,
      },
      {
        label: 'Org grounding for discovery brief',
        detail: 'Normalized org-side evidence reused from the saved org baseline output artifact.',
        source: orgEvidenceRelativePath,
      },
      {
        label: 'Discovery brief synthesis lineage',
        detail: 'Trace record linking the synthesized brief back to the saved source command executions.',
        source: traceEvidenceRelativePath,
      },
    ];
  } catch (error) {
    status = 'error';
    summary = `Could not synthesize a discovery brief from run ${options.runId}.`;
    const message = error instanceof Error ? error.message : String(error);
    const code = message.includes(`RUN_ID_INVALID: ${options.runId}`)
      ? 'RUN_ID_INVALID'
      : message.includes(`RUN_ID_NOT_FOUND: ${options.runId}`)
        ? 'RUN_ID_NOT_FOUND'
        : message.includes('SYNTH_SOURCE_COMMAND_MISSING: discover.project-inventory')
          ? 'SYNTH_SOURCE_PROJECT_INVENTORY_MISSING'
          : message.includes('SYNTH_SOURCE_COMMAND_MISSING: discover.org-baseline')
            ? 'SYNTH_SOURCE_ORG_BASELINE_MISSING'
            : message.includes(`SYNTH_SOURCE_OUTPUT_MISSING: ${PROJECT_INVENTORY_SLUG}`)
              ? 'SYNTH_SOURCE_PROJECT_INVENTORY_OUTPUT_MISSING'
              : message.includes(`SYNTH_SOURCE_OUTPUT_MISSING: ${ORG_BASELINE_SLUG}`)
                ? 'SYNTH_SOURCE_ORG_BASELINE_OUTPUT_MISSING'
                : message.includes(`SYNTH_SOURCE_OUTPUT_INVALID: ${PROJECT_INVENTORY_SLUG}`)
                  ? 'SYNTH_SOURCE_PROJECT_INVENTORY_OUTPUT_INVALID'
                  : message.includes(`SYNTH_SOURCE_OUTPUT_INVALID: ${ORG_BASELINE_SLUG}`)
                    ? 'SYNTH_SOURCE_ORG_BASELINE_OUTPUT_INVALID'
                    : /RUN_ARTIFACT_INVALID:/i.test(message)
                      ? 'RUN_ARTIFACT_INVALID'
                      : 'DISCOVERY_BRIEF_SYNTH_FAILED';
    errors.push({
      code,
      message: code === 'RUN_ID_INVALID'
        ? `Run id ${options.runId} must be a canonical run identifier.`
        : code === 'RUN_ID_NOT_FOUND'
          ? `Run ${options.runId} was not found.`
          : code === 'SYNTH_SOURCE_PROJECT_INVENTORY_MISSING'
            ? `Run ${options.runId} does not contain a saved sfx discover project-inventory execution to synthesize.`
            : code === 'SYNTH_SOURCE_ORG_BASELINE_MISSING'
              ? `Run ${options.runId} does not contain a saved sfx discover org-baseline execution to synthesize.`
              : code === 'SYNTH_SOURCE_PROJECT_INVENTORY_OUTPUT_MISSING'
                ? `Run ${options.runId} is missing the saved project-inventory output artifact required for synthesis.`
                : code === 'SYNTH_SOURCE_ORG_BASELINE_OUTPUT_MISSING'
                  ? `Run ${options.runId} is missing the saved org-baseline output artifact required for synthesis.`
                  : code === 'SYNTH_SOURCE_PROJECT_INVENTORY_OUTPUT_INVALID'
                    ? `The saved project-inventory output artifact for run ${options.runId} could not be parsed as JSON.`
                    : code === 'SYNTH_SOURCE_ORG_BASELINE_OUTPUT_INVALID'
                      ? `The saved org-baseline output artifact for run ${options.runId} could not be parsed as JSON.`
                      : code === 'RUN_ARTIFACT_INVALID'
                        ? `Run ${options.runId} metadata could not be parsed as JSON.`
                        : message,
    });
  }

  const recommendedNextCommands = status === 'error'
    ? []
    : [
        `sfx evidence show --run-id ${prepared.runId} --evidence-id ${SYNTH_REPO_EVIDENCE_ID} --json`,
        `sfx evidence show --run-id ${prepared.runId} --evidence-id ${SYNTH_ORG_EVIDENCE_ID} --json`,
      ];
  const envelope: DiscoveryBriefEnvelope = createDiscoveryEnvelope({
    command,
    status,
    summary,
    result,
    warnings,
    errors,
    evidence,
    meta: createDiscoveryCommandMeta({
      runId: prepared.runId,
      commandExecutionId: prepared.commandExecutionId,
      commandSlug: prepared.commandSlug,
      outputArtifactPaths: [prepared.outputArtifactRelativePath],
      evidenceArtifactPaths,
      logArtifactPath: prepared.logArtifactRelativePath,
      recommendedNextCommands,
      stats: {
        facts_count: result.facts.length,
        interpretations_count: result.interpretations.length,
        hypotheses_count: result.hypotheses.length,
        open_questions_count: result.open_questions.length,
        next_best_questions_count: result.next_best_questions.length,
        source_command_executions: result.brief_context.source_command_execution_ids.length,
      },
      effectiveFailOn: options.failOn,
    }),
  });

  runManager.finalizeCommandExecution({
    prepared,
    status,
    envelope,
    inputs: { run_id: options.runId },
    warnings: warnings.map((warning) => warning.message),
    evidenceRefs,
    logLines: [
      `command=${command}`,
      `source_run_id=${options.runId}`,
      `run_id=${prepared.runId}`,
      `command_execution_id=${prepared.commandExecutionId}`,
      `status=${status}`,
      `facts_count=${result.facts.length}`,
      `interpretations_count=${result.interpretations.length}`,
      `hypotheses_count=${result.hypotheses.length}`,
      `open_questions_count=${result.open_questions.length}`,
      `next_best_questions_count=${result.next_best_questions.length}`,
      `evidence_count=${evidenceRefs.length}`,
      `fail_on=${options.failOn ?? 'default'}`,
    ],
  });

  return {
    envelope,
    runFilePath: prepared.runFilePath,
    outputArtifactPath: prepared.outputArtifactAbsolutePath,
    logArtifactPath: prepared.logArtifactAbsolutePath,
    evidenceArtifactPaths: evidenceArtifactPaths.map((relativePath) => resolveRunRelativePath(prepared.runRootPath, relativePath)),
  };
}
