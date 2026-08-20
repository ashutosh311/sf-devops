import type { DoctorCheck, DoctorResult } from '@otto/rca-cli-core';
import type { Status } from '@otto/rca-cli-core';
import type { DiscoveryCommandMeta } from '../../runtime/envelope';

export type ResolutionStatus = 'resolved' | 'not_found' | 'unexpected';
export type VersionStatus = 'available' | 'unavailable' | 'parse_failed' | 'command_failed';
export type IssueSeverity = 'critical' | 'important' | 'minor';
export type OrgAccessStatus = 'available' | 'partial' | 'probe_failed' | 'unavailable';
export type NodeEngineStatus = 'supported' | 'unsupported' | 'unknown';
export type OrgListProbeStatus = 'available' | 'empty' | 'probe_failed' | 'skipped';

export interface BinaryResolution {
  command: string;
  path: string | null;
  resolution_status: ResolutionStatus;
  source_hint?: string;
  detail?: string;
}

export interface NodeResolutionDetails {
  command: string;
  path: string | null;
  version: string | null;
  resolution_status: ResolutionStatus;
  engine_range: string;
  engine_status: NodeEngineStatus;
}

export interface SfResolutionDetails {
  command: string;
  path: string | null;
  resolution_status: ResolutionStatus;
  source_hint?: string;
}

export interface SfVersionDetails {
  command: string | null;
  raw: string | null;
  parsed_version: string | null;
  status: VersionStatus;
}

export interface DoctorIssue {
  issue_id: string;
  severity: IssueSeverity;
  code: string;
  message: string;
}

export interface OrgAccessSummary {
  status: OrgAccessStatus;
  org_list_command: string | null;
  org_list_probe_status: OrgListProbeStatus;
  org_list_checked: boolean;
  authenticated_aliases_count: number;
  probe_error: string | null;
}

export type WrapperStatus = 'resolved' | 'missing' | 'stale';
export type ProjectConfigStatus = 'detected' | 'missing';

export interface CliWrapperSummary {
  command: string;
  path: string | null;
  status: WrapperStatus;
  detail: string;
}

export interface ProjectContextSummary {
  project_root: string;
  artifact_root: string;
  project_config_status: ProjectConfigStatus;
  detected_project_files: string[];
}

export interface DoctorSfCliDetails {
  node_resolution: NodeResolutionDetails;
  npm_resolution: SfResolutionDetails;
  python_resolution: SfResolutionDetails;
  sf_resolution: SfResolutionDetails;
  sf_version: SfVersionDetails;
  command_wrappers: CliWrapperSummary[];
  project_context: ProjectContextSummary | null;
  issues: DoctorIssue[];
  org_access_summary: OrgAccessSummary;
  warnings_summary: string[];
}

export interface DoctorSfCliAssessmentInput {
  node: BinaryResolution & { version: string | null; engine_range: string; engine_status: NodeEngineStatus };
  npm: BinaryResolution;
  python: BinaryResolution;
  sf: BinaryResolution;
  sfVersion: { raw: string | null; parsed_version: string | null; status: VersionStatus };
  commandWrappers: CliWrapperSummary[];
  projectContext: ProjectContextSummary | null;
  authenticatedAliasesCount: number;
  orgListChecked: boolean;
  orgListProbeStatus: OrgListProbeStatus;
  orgListProbeError: string | null;
}

export type DoctorSfCliResult = Omit<DoctorResult, 'details'> & { details: Record<string, unknown> & DoctorSfCliDetails };

export interface DoctorSfCliAssessment {
  status: Status;
  summary: string;
  warnings: Array<{ code: string; message: string }>;
  errors: Array<{ code: string; message: string }>;
  evidence: Array<{ label: string; detail: string; source?: string }>;
  result: DoctorSfCliResult;
  recommendedNextCommands: string[];
  evidenceArtifacts: Array<{ evidenceId: string; payload: unknown }>;
  logLines: string[];
}

export interface DoctorExecutionResult {
  envelope: {
    schema_version: string;
    command: string;
    status: Status;
    summary: string;
    result: DoctorSfCliResult;
    warnings: Array<{ code: string; message: string }>;
    errors: Array<{ code: string; message: string }>;
    meta: DiscoveryCommandMeta;
    evidence: Array<{ label: string; detail: string; source?: string }>;
  };
  runFilePath: string;
  outputArtifactPath: string;
  logArtifactPath: string;
  evidenceArtifactPaths: string[];
}

export interface CommandRunnerResult {
  stdout: string;
  stderr: string;
  exitCode: number;
}

export interface DoctorCommandRunner {
  resolveBinary(command: string): BinaryResolution;
  run(command: string, args: string[]): CommandRunnerResult;
}
