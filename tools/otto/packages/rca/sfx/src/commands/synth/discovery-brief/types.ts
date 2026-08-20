import type { ResultEnvelope, Status } from '@otto/rca-cli-core';

import type { DiscoveryCommandMeta } from '../../../runtime/envelope';
import type { LocalFileRunManager } from '../../../runtime/run-manager';
import type { ProjectInventoryPayload } from '../../discover/project-inventory';
import type { OrgBaselinePayload } from '../../discover/org-baseline';

export type BriefClaimType = 'fact' | 'interpretation' | 'hypothesis' | 'open_question';
export type BriefDerivationType = 'observed' | 'derived' | 'inferred';
export type BriefConfidenceLevel = 'high' | 'medium' | 'low';
export type BriefPriority = 1 | 2 | 3;
export type RecommendedNextStepType = 'command' | 'skill' | 'agent' | 'workshop' | 'analysis';

export interface EvidenceLink {
  evidence_id: string;
  support_type: 'primary' | 'supporting';
  fact_path: string;
  locator_excerpt: string;
}

export interface DiscoveryBriefClaim {
  claim_id: string;
  claim_type: BriefClaimType;
  text: string;
  derivation_type: BriefDerivationType;
  confidence_level: BriefConfidenceLevel;
  evidence_links: EvidenceLink[];
  caveats: string[];
  priority?: BriefPriority;
  rank?: number;
  recommended_validation_target?: string;
  question_goal?: string;
}

export interface SuggestedWorkshopAgendaItem {
  agenda_item_id: string;
  title: string;
  objective: string;
  related_claim_ids: string[];
  priority: number;
}

export interface StakeholderValidationTarget {
  target_id: string;
  topic: string;
  why_validate: string;
  related_claim_ids: string[];
}

export interface DiscoveryBriefRecommendedNextStep {
  step_id: string;
  text: string;
  step_type: RecommendedNextStepType;
}

export interface DiscoveryBriefPayload {
  brief_context: {
    run_id: string;
    scenario_refs: string[];
    source_command_execution_ids: string[];
    summary_scope: string;
  };
  facts: DiscoveryBriefClaim[];
  interpretations: DiscoveryBriefClaim[];
  hypotheses: DiscoveryBriefClaim[];
  open_questions: DiscoveryBriefClaim[];
  next_best_questions: DiscoveryBriefClaim[];
  risks: DiscoveryBriefClaim[];
  suggested_workshop_agenda: SuggestedWorkshopAgendaItem[];
  stakeholder_validation_targets: StakeholderValidationTarget[];
  recommended_next_steps: DiscoveryBriefRecommendedNextStep[];
}

export interface DiscoveryBriefEnvelopeSource {
  command_execution_id: string;
  command_slug: string;
  command: string;
  status: Status;
  output_artifact_path: string;
}

export interface DiscoveryBriefSourceArtifacts {
  source_run_id: string;
  project_inventory: DiscoveryBriefEnvelopeSource & { result: ProjectInventoryPayload };
  org_baseline: DiscoveryBriefEnvelopeSource & { result: OrgBaselinePayload };
}

export type DiscoveryBriefEnvelope = ResultEnvelope<DiscoveryBriefPayload, DiscoveryCommandMeta>;

export interface ExecuteDiscoveryBriefOptions {
  repoRoot: string;
  artifactRoot?: string;
  runId: string;
  appendRunId?: string;
  newRun?: boolean;
  failOn?: Status;
  runManager?: LocalFileRunManager;
}

export interface DiscoveryBriefExecutionResult {
  envelope: DiscoveryBriefEnvelope;
  runFilePath: string;
  outputArtifactPath: string;
  logArtifactPath: string;
  evidenceArtifactPaths: string[];
}
