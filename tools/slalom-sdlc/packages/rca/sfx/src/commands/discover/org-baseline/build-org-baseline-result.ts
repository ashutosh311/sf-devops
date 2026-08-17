import { createDiscoveryEnvelope, type DiscoveryCommandMeta } from '../../../runtime/envelope';
import {
  detectAutomationSurfaceSignals,
  detectCapabilitySignals,
  detectSecuritySurfaceHints,
  inferOrgKind,
  type ConfidenceLevel,
  type OrgInspectionSnapshot,
  type OrgInspectionWarning,
} from '../../../adapters/salesforce/org-inspection';
import type {
  CreateOrgBaselineEnvelopeInput,
  OrgBaselineEnvelope,
  OrgBaselinePayload,
  IntegrationSignal,
  RecommendedNextStep,
} from './types';

const ACCESS_DEGRADATION_WARNING_CODES = new Set([
  'ORG_DISPLAY_FAILED',
  'ORG_LIST_PARTIAL',
]);

function isAccessDegradationWarning(warning: Pick<OrgInspectionWarning, 'code'>): boolean {
  return ACCESS_DEGRADATION_WARNING_CODES.has(warning.code);
}

function collectWarningBreakdown(snapshot: OrgInspectionSnapshot): {
  accessWarnings: OrgInspectionWarning[];
  completenessWarnings: OrgInspectionWarning[];
} {
  const accessWarnings: OrgInspectionWarning[] = [];
  const completenessWarnings: OrgInspectionWarning[] = [];

  for (const warning of snapshot.warnings ?? []) {
    if (isAccessDegradationWarning(warning)) {
      accessWarnings.push(warning);
    } else {
      completenessWarnings.push(warning);
    }
  }

  return { accessWarnings, completenessWarnings };
}

function summarizePackages(snapshot: OrgInspectionSnapshot): OrgBaselinePayload['installed_packages'] {
  return snapshot.installedPackages.map((pkg) => ({
    package_name: pkg.subscriberPackageName,
    version: pkg.subscriberPackageVersionNumber ?? 'unknown',
    managed: pkg.isManaged ?? Boolean(pkg.subscriberPackageNamespace),
    confidence_level: (pkg.isManaged ?? Boolean(pkg.subscriberPackageNamespace)) ? 'high' : 'medium',
  }));
}

function summarizeIntegrationSignals(snapshot: OrgInspectionSnapshot): OrgBaselinePayload['integration_signals'] {
  if (!snapshot.integrationSignals || snapshot.integrationSignals.length === 0) {
    return [];
  }

  return snapshot.integrationSignals.map((text, index) => ({
    signal_id: `integration-${index + 1}`,
    text,
  }));
}

function collectWarningsSummary(snapshot: OrgInspectionSnapshot): string[] {
  return (snapshot.warnings ?? []).map((warning) => warning.message);
}

function deriveConfidenceForPreflight(snapshot: OrgInspectionSnapshot): ConfidenceLevel {
  if (!snapshot.accessAssessment || snapshot.accessAssessment.status === 'available') {
    return 'high';
  }

  if (snapshot.accessAssessment.status === 'partial') {
    return 'medium';
  }

  return 'low';
}

function describeAccessStatus(snapshot: OrgInspectionSnapshot): string {
  if (!snapshot.accessAssessment || snapshot.accessAssessment.status === 'available') {
    return 'available';
  }

  if (snapshot.accessAssessment.status === 'partial') {
    return 'degraded';
  }

  return 'unavailable';
}

function describeCompleteness(snapshot: OrgInspectionSnapshot): string {
  const { completenessWarnings } = collectWarningBreakdown(snapshot);
  const limitationCount = snapshot.limitations?.length ?? 0;
  if (completenessWarnings.length === 0 && limitationCount === 0) {
    return 'complete for the requested baseline pass';
  }

  return `partial (${completenessWarnings.length} completeness warning(s), ${limitationCount} limitation(s))`;
}

function buildRecommendedNextSteps(snapshot: OrgInspectionSnapshot): RecommendedNextStep[] {
  const { accessWarnings, completenessWarnings } = collectWarningBreakdown(snapshot);
  const steps: RecommendedNextStep[] = [
    {
      step_id: 'step-brief',
      text: 'Run sfx synth discovery-brief --run-id <run_id> --json',
      step_type: 'command',
    },
  ];

  if (snapshot.accessAssessment && snapshot.accessAssessment.status !== 'available') {
    steps.unshift({
      step_id: 'step-auth-context',
      text: 'Reconfirm Salesforce CLI org authentication and rerun org baseline after doctor/preflight concerns are addressed.',
      step_type: 'analysis',
    });
  }

  if (completenessWarnings.length > 0 || (snapshot.limitations?.length ?? 0) > 0) {
    steps.push({
      step_id: 'step-completeness-review',
      text: accessWarnings.length > 0
        ? 'After auth/access issues are resolved, rerun org baseline or targeted discovery commands to close remaining metadata and package coverage gaps.'
        : 'Review warnings and limitations, then rerun org baseline or targeted discovery commands to close metadata and package coverage gaps.',
      step_type: 'analysis',
    });
  }

  if (snapshot.metadataCoverage.permissionSets || snapshot.metadataCoverage.profiles || snapshot.metadataCoverage.roles) {
    steps.push({
      step_id: 'step-security-review',
      text: 'Plan a focused security and governance review for permissions, profiles, and sharing surfaces.',
      step_type: 'workshop',
    });
  }

  if (snapshot.metadataCoverage.connectedApps || snapshot.metadataCoverage.namedCredentials || snapshot.metadataCoverage.externalCredentials) {
    steps.push({
      step_id: 'step-integration-review',
      text: 'Investigate integration endpoints, connected apps, and credential management patterns next.',
      step_type: 'analysis',
    });
  }

  return steps;
}

function promoteWarnings(warnings: readonly OrgInspectionWarning[] | undefined): Array<{ code: string; message: string }> {
  return (warnings ?? []).map((warning) => ({
    code: warning.code,
    message: warning.message,
  }));
}

function fallbackWarningsFromPayload(payload: OrgBaselinePayload): Array<{ code: string; message: string }> {
  return (payload.warnings_summary ?? []).map((warning, index) => ({
    code: `ORG_BASELINE_WARNING_${String(index + 1).padStart(3, '0')}`,
    message: warning,
  }));
}

function summarizeIntegrationEvidence(integrationSignals: readonly IntegrationSignal[] | undefined): { label: string; detail: string; source?: string } | null {
  if (!integrationSignals || integrationSignals.length === 0) {
    return null;
  }

  return {
    label: 'Org integration signals',
    detail: `Captured ${integrationSignals.length} integration signal(s); latest signal: ${integrationSignals[0]?.text ?? 'n/a'}`,
    source: 'ev_org_integration_signals_001',
  };
}

function buildAutomationSurfaces(snapshot: OrgInspectionSnapshot): OrgBaselinePayload['automation_surfaces'] {
  return detectAutomationSurfaceSignals(snapshot)
    .filter((surface) => {
      if (surface.surfaceId !== 'auto-apex') {
        return true;
      }

      const hasKnownApexClassCount = typeof snapshot.metadataCoverage.apexClasses === 'number';
      const hasKnownTriggerCount = typeof snapshot.metadataCoverage.triggers === 'number';
      return hasKnownApexClassCount && hasKnownTriggerCount;
    })
    .map((surface) => ({
      surface_id: surface.surfaceId,
      label: surface.label,
      surface_type: surface.surfaceType,
      observed_signal: surface.observedSignal,
    }));
}

function buildEvidenceSummary(payload: OrgBaselinePayload, warnings: readonly { code: string; message: string }[]): Array<{ label: string; detail: string; source?: string }> {
  const accessWarningCount = warnings.filter((warning) => ACCESS_DEGRADATION_WARNING_CODES.has(warning.code)).length;
  const completenessWarningCount = warnings.length - accessWarningCount;
  const evidence: Array<{ label: string; detail: string; source?: string }> = [
    {
      label: 'Org package inventory',
      detail: `Captured ${payload.installed_packages.length} installed package signal(s) for ${payload.org_summary.org_alias}.`,
      source: 'ev_org_package_inventory_001',
    },
    {
      label: 'Org automation and security surfaces',
      detail: `Observed ${payload.automation_surfaces.length} automation surface signal(s) and ${payload.security_surface_hints.length} security hint(s).`,
      source: 'ev_org_surface_summary_001',
    },
  ];

  const integrationEvidence = summarizeIntegrationEvidence(payload.integration_signals);
  if (integrationEvidence) {
    evidence.push(integrationEvidence);
  }

  if (accessWarningCount > 0) {
    evidence.push({
      label: 'Org access posture',
      detail: `Captured ${accessWarningCount} access/auth warning(s) during baseline capture; org access should be treated as degraded or provisional.`,
      source: 'ev_org_baseline_access_001',
    });
  }

  if (completenessWarningCount > 0 || (payload.limitations?.length ?? 0) > 0) {
    evidence.push({
      label: 'Org baseline completeness',
      detail: `Captured ${completenessWarningCount} completeness warning(s) and ${payload.limitations?.length ?? 0} limitation(s) affecting package or metadata coverage.`,
      source: 'ev_org_baseline_completeness_001',
    });
  }

  return evidence;
}

export function buildOrgBaselinePayload(snapshot: OrgInspectionSnapshot): OrgBaselinePayload {
  const orgKind = inferOrgKind(snapshot.org);
  const packageSummaries = summarizePackages(snapshot);
  const capabilityIndicators = detectCapabilitySignals(snapshot).map((capability) => ({
    capability_id: capability.capabilityId,
    label: capability.label,
    signal_type: capability.signalType,
    confidence_level: capability.confidenceLevel,
  }));
  const automationSurfaces = buildAutomationSurfaces(snapshot);
  const securitySurfaceHints = detectSecuritySurfaceHints(snapshot).map((hint) => ({
    hint_id: hint.hintId,
    text: hint.text,
    hint_type: hint.hintType,
  }));
  const warningsSummary = collectWarningsSummary(snapshot);
  const limitations = [...(snapshot.limitations ?? [])];
  const preflightConfidence = deriveConfidenceForPreflight(snapshot);
  const packageCount = packageSummaries.length;
  const automationCount = automationSurfaces.length;
  const accessStatus = describeAccessStatus(snapshot);
  const completenessStatus = describeCompleteness(snapshot);

  return {
    org_summary: {
      org_alias: snapshot.org.alias,
      org_kind: orgKind,
      summary_text: `Org baseline for ${snapshot.org.alias} captured with ${packageCount} installed package signal(s) and ${automationCount} automation surface indicator(s). Org access: ${accessStatus}. Completeness: ${completenessStatus}. Access confidence: ${preflightConfidence}.`,
    },
    installed_packages: packageSummaries,
    capability_indicators: capabilityIndicators,
    automation_surfaces: automationSurfaces,
    security_surface_hints: securitySurfaceHints,
    recommended_next_steps: buildRecommendedNextSteps(snapshot),
    integration_signals: summarizeIntegrationSignals(snapshot),
    warnings_summary: warningsSummary,
    limitations,
  };
}

export function createOrgBaselineEnvelope(input: CreateOrgBaselineEnvelopeInput): OrgBaselineEnvelope {
  const warnings = input.warnings ?? fallbackWarningsFromPayload(input.result);
  return createDiscoveryEnvelope({
    command: input.command,
    status: input.status,
    summary: input.summary,
    result: input.result,
    warnings,
    evidence: buildEvidenceSummary(input.result, warnings),
    meta: input.meta,
  });
}

export function buildOrgBaselineEnvelopeFromSnapshot(input: {
  command: string;
  status: CreateOrgBaselineEnvelopeInput['status'];
  summary: string;
  snapshot: OrgInspectionSnapshot;
  meta: DiscoveryCommandMeta;
}): OrgBaselineEnvelope {
  return createOrgBaselineEnvelope({
    command: input.command,
    status: input.status,
    summary: input.summary,
    result: buildOrgBaselinePayload(input.snapshot),
    warnings: promoteWarnings(input.snapshot.warnings),
    meta: input.meta,
  });
}
