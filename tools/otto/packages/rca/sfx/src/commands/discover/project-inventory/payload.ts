import type { ResultEnvelope } from '@otto/rca-cli-core';

import { createDiscoveryEnvelope, type DiscoveryCommandMeta } from '../../../runtime/envelope';
import type { BuildProjectInventoryEnvelopeInput, ProjectInventoryPayload, ProjectInventoryScanResult } from './types';

export function buildProjectInventoryPayload(scan: ProjectInventoryScanResult): ProjectInventoryPayload {
  return {
    repo_summary: {
      repo_root: scan.repo_root,
      repo_kind: scan.repo_kind,
      summary_text: buildRepoSummaryText(scan),
    },
    package_roots: scan.package_roots.map((packageRoot) => ({ ...packageRoot })),
    metadata_family_counts: { ...scan.metadata_family_counts },
    candidate_domains: scan.candidate_domains.map((domain) => ({ ...domain, signals: [...domain.signals] })),
    hotspots: scan.hotspots.map((hotspot) => ({ ...hotspot, evidence_refs: [...hotspot.evidence_refs] })),
    recommended_next_steps: scan.recommended_next_steps.map((step) => ({ ...step })),
    namespaces: scan.namespaces.map((namespace) => ({ ...namespace })),
    key_config_files: scan.key_config_files.map((configFile) => ({ ...configFile })),
    packaging_signals: scan.packaging_signals.map((signal) => ({ ...signal })),
    warnings_summary: [...scan.warnings_summary],
  };
}

export function buildProjectInventoryEnvelope(input: BuildProjectInventoryEnvelopeInput): ResultEnvelope<ProjectInventoryPayload, DiscoveryCommandMeta> {
  const payload = buildProjectInventoryPayload(input.scan);
  return createDiscoveryEnvelope({
    command: input.command,
    status: deriveProjectInventoryStatus(input.scan),
    summary: payload.repo_summary.summary_text,
    result: payload,
    warnings: input.scan.warnings_summary.map((warning, index) => ({
      code: `PROJECT_INVENTORY_WARNING_${String(index + 1).padStart(3, '0')}`,
      message: warning,
    })),
    errors: [],
    meta: input.meta,
    evidence: buildEvidenceSummary(input.scan),
  });
}

export function deriveProjectInventoryStatus(scan: ProjectInventoryScanResult): 'ok' | 'warn' | 'no_match' {
  if (scan.repo_kind === 'unknown') {
    return 'no_match';
  }

  if (scan.warnings_summary.length > 0) {
    return 'warn';
  }

  return 'ok';
}

function buildRepoSummaryText(scan: ProjectInventoryScanResult): string {
  const familyCount = Object.keys(scan.metadata_family_counts).length;
  const packageRootCount = scan.package_roots.length;

  if (scan.repo_kind === 'unknown') {
    return 'Repository did not expose recognizable Salesforce package roots or metadata families during the scan.';
  }

  if (scan.repo_kind === 'nonstandard_repo') {
    return `Repository exposes Salesforce metadata signals without a standard project manifest, including ${familyCount} metadata families across ${packageRootCount} likely roots.`;
  }

  if (scan.repo_kind === 'mixed_repo') {
    return `Repository mixes Salesforce and adjacent workspace assets, with ${familyCount} metadata families across ${packageRootCount} package roots relevant to discovery.`;
  }

  return `Repository contains Salesforce metadata and package roots relevant to discovery, covering ${familyCount} metadata families across ${packageRootCount} package roots.`;
}

function buildEvidenceSummary(scan: ProjectInventoryScanResult): Array<{ label: string; detail: string; source?: string }> {
  const evidence = [
    {
      label: 'Repository metadata family counts',
      detail: `Detected ${Object.keys(scan.metadata_family_counts).length} metadata families from ${scan.stats.matched_metadata_files} matched files.`,
      source: 'ev_repo_metadata_families_001',
    },
    {
      label: 'Repository package roots',
      detail: `Detected ${scan.package_roots.length} likely package roots.`,
      source: 'ev_repo_package_roots_001',
    },
  ];

  if (scan.candidate_domains.length > 0) {
    evidence.push({
      label: 'Repository domain signals',
      detail: `Top domain candidate: ${scan.candidate_domains[0].label}.`,
      source: 'ev_repo_domain_signals_001',
    });
  }

  return evidence;
}
