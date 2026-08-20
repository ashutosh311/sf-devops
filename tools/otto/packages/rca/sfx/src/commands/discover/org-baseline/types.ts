import type { ResultEnvelope, Status } from '@otto/rca-cli-core';

import type { OrgBaselineDetailLevel } from '../../../adapters/salesforce/org-inspection';
import type { LocalFileRunManager } from '../../../runtime/run-manager';

import type { DiscoveryCommandMeta } from '../../../runtime/envelope';

export type OrgKind = 'sandbox' | 'production' | 'developer' | 'scratch' | 'unknown';
export type ConfidenceLevel = 'high' | 'medium' | 'low';
export type CapabilitySignalType = 'package_presence' | 'metadata_presence' | 'feature_indicator' | 'configuration_indicator';
export type AutomationSurfaceType = 'flow' | 'apex' | 'validation' | 'approval' | 'process' | 'unknown';
export type SecurityHintType = 'permission_model' | 'sharing_model' | 'profile_permission_shape' | 'permset_signal' | 'auth_signal' | 'governance_signal';
export type RecommendedStepType = 'command' | 'skill' | 'agent' | 'analysis' | 'workshop';

export interface OrgSummary {
  org_alias: string;
  org_kind: OrgKind;
  summary_text: string;
}

export interface InstalledPackageSummary {
  package_name: string;
  version: string;
  managed: boolean;
  confidence_level: ConfidenceLevel;
}

export interface CapabilityIndicator {
  capability_id: string;
  label: string;
  signal_type: CapabilitySignalType;
  confidence_level: ConfidenceLevel;
}

export interface AutomationSurface {
  surface_id: string;
  label: string;
  surface_type: AutomationSurfaceType;
  observed_signal: string;
}

export interface SecuritySurfaceHint {
  hint_id: string;
  text: string;
  hint_type: SecurityHintType;
}

export interface RecommendedNextStep {
  step_id: string;
  text: string;
  step_type: RecommendedStepType;
}

export interface IntegrationSignal {
  signal_id: string;
  text: string;
}

export interface OrgBaselinePayload {
  org_summary: OrgSummary;
  installed_packages: InstalledPackageSummary[];
  capability_indicators: CapabilityIndicator[];
  automation_surfaces: AutomationSurface[];
  security_surface_hints: SecuritySurfaceHint[];
  recommended_next_steps: RecommendedNextStep[];
  integration_signals?: IntegrationSignal[];
  warnings_summary?: string[];
  limitations?: string[];
}

export interface CreateOrgBaselineEnvelopeInput {
  command: string;
  status: Status;
  summary: string;
  result: OrgBaselinePayload;
  meta: DiscoveryCommandMeta;
  warnings?: Array<{
    code: string;
    message: string;
  }>;
}

export type OrgBaselineEnvelope = ResultEnvelope<OrgBaselinePayload, DiscoveryCommandMeta>;

export interface OrgBaselineRunnerResult {
  stdout: string;
  stderr: string;
  exitCode: number;
}

export interface OrgBaselineCommandRunner {
  runSf(args: string[]): Promise<OrgBaselineRunnerResult>;
}

export interface ExecuteOrgBaselineOptions {
  repoRoot: string;
  artifactRoot?: string;
  org: string;
  detail?: OrgBaselineDetailLevel;
  appendRunId?: string;
  newRun?: boolean;
  failOn?: Status;
  runner?: OrgBaselineCommandRunner;
  runManager?: LocalFileRunManager;
}

export interface OrgBaselineExecutionResult {
  envelope: OrgBaselineEnvelope;
  runFilePath: string;
  outputArtifactPath: string;
  logArtifactPath: string;
}
