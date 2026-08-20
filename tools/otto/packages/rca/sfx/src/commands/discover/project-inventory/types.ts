export type ProjectInventoryDetailLevel = 'low' | 'standard' | 'deep';
export type RepoKind = 'salesforce_repo' | 'mixed_repo' | 'nonstandard_repo' | 'unknown';
export type PackageRootType = 'sfdx_package_root' | 'source_root' | 'metadata_root' | 'other';
export type ConfidenceLevel = 'low' | 'medium' | 'high';
export type HotspotType = 'metadata_concentration' | 'automation_concentration' | 'domain_cluster' | 'integration_signal' | 'packaging_signal';
export type RecommendedNextStepType = 'command' | 'skill' | 'agent' | 'analysis';

export interface PackageRoot {
  path: string;
  root_type: PackageRootType;
  confidence_level: ConfidenceLevel;
}

export interface CandidateDomain {
  domain_id: string;
  label: string;
  confidence_level: ConfidenceLevel;
  signals: string[];
}

export interface Hotspot {
  hotspot_id: string;
  label: string;
  hotspot_type: HotspotType;
  why_it_matters: string;
  evidence_refs: string[];
}

export interface RecommendedNextStep {
  step_id: string;
  text: string;
  step_type: RecommendedNextStepType;
}

export interface NamespaceIndicator {
  namespace: string;
  source: string;
}

export interface KeyConfigFile {
  path: string;
  file_role: string;
}

export interface PackagingSignal {
  signal_id: string;
  text: string;
}

export interface ProjectInventoryPayload {
  repo_summary: {
    repo_root: string;
    repo_kind: RepoKind;
    summary_text: string;
  };
  package_roots: PackageRoot[];
  metadata_family_counts: Record<string, number>;
  candidate_domains: CandidateDomain[];
  hotspots: Hotspot[];
  recommended_next_steps: RecommendedNextStep[];
  namespaces?: NamespaceIndicator[];
  key_config_files?: KeyConfigFile[];
  packaging_signals?: PackagingSignal[];
  warnings_summary?: string[];
}

export interface ProjectInventoryScanResult {
  repo_root: string;
  detail: ProjectInventoryDetailLevel;
  repo_kind: RepoKind;
  package_roots: PackageRoot[];
  metadata_family_counts: Record<string, number>;
  candidate_domains: CandidateDomain[];
  hotspots: Hotspot[];
  recommended_next_steps: RecommendedNextStep[];
  namespaces: NamespaceIndicator[];
  key_config_files: KeyConfigFile[];
  packaging_signals: PackagingSignal[];
  warnings_summary: string[];
  stats: {
    files_scanned: number;
    matched_metadata_files: number;
    package_root_count: number;
    hotspot_count: number;
  };
}

export interface BuildProjectInventoryEnvelopeInput {
  command: string;
  scan: ProjectInventoryScanResult;
  meta: import('../../../runtime/envelope').DiscoveryCommandMeta;
}

export interface ProjectInventoryExecutionResult {
  envelope: {
    schema_version: string;
    command: string;
    status: import('@otto/rca-cli-core').Status;
    summary: string;
    result: ProjectInventoryPayload;
    warnings: Array<{ code: string; message: string }>;
    errors: Array<{ code: string; message: string }>;
    meta: import('../../../runtime/envelope').DiscoveryCommandMeta;
    evidence: Array<{ label: string; detail: string; source?: string }>;
  };
  runFilePath: string;
  outputArtifactPath: string;
  logArtifactPath: string;
}
