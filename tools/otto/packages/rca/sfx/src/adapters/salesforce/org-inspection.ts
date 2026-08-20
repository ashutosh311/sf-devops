export type OrgBaselineDetailLevel = 'low' | 'standard' | 'deep';

export type OrgKind = 'sandbox' | 'production' | 'developer' | 'scratch' | 'unknown';

export type ConfidenceLevel = 'high' | 'medium' | 'low';

export interface SfOrgIdentity {
  alias: string;
  username?: string;
  edition?: string;
  isSandbox?: boolean;
  isScratchOrg?: boolean;
  isDeveloperEdition?: boolean;
  instanceUrl?: string;
}

export interface SfInstalledPackageRecord {
  subscriberPackageName: string;
  subscriberPackageNamespace?: string | null;
  subscriberPackageVersionNumber?: string | null;
  isManaged?: boolean;
}

export interface SfMetadataCoverage {
  flows?: number;
  apexClasses?: number;
  triggers?: number;
  validationRules?: number;
  approvalProcesses?: number;
  processBuilders?: number;
  permissionSets?: number;
  profiles?: number;
  connectedApps?: number;
  namedCredentials?: number;
  externalCredentials?: number;
  roles?: number;
  sharingRules?: number;
}

export interface OrgInspectionWarning {
  code: string;
  message: string;
}

export interface OrgAccessAssessment {
  status: 'available' | 'partial' | 'unavailable';
  checkedWith: 'doctor_sf_cli' | 'direct_org_probe' | 'unknown';
  authenticatedAliasesCount: number;
  defaultOrgAccessible: boolean;
}

export interface OrgInspectionSnapshot {
  org: SfOrgIdentity;
  detail: OrgBaselineDetailLevel;
  installedPackages: readonly SfInstalledPackageRecord[];
  metadataCoverage: SfMetadataCoverage;
  integrationSignals?: readonly string[];
  warnings?: readonly OrgInspectionWarning[];
  limitations?: readonly string[];
  accessAssessment?: OrgAccessAssessment;
}

function hasPositiveCount(value: number | undefined): boolean {
  return typeof value === 'number' && value > 0;
}

export function inferOrgKind(org: SfOrgIdentity): OrgKind {
  if (org.isScratchOrg) {
    return 'scratch';
  }

  if (org.isSandbox) {
    return 'sandbox';
  }

  if (org.isDeveloperEdition) {
    return 'developer';
  }

  if (org.instanceUrl && /\.my\.salesforce\.com$/i.test(org.instanceUrl)) {
    return 'production';
  }

  if (org.edition && /developer/i.test(org.edition)) {
    return 'developer';
  }

  if (org.edition) {
    return 'production';
  }

  return 'unknown';
}

export function detectCapabilitySignals(snapshot: OrgInspectionSnapshot): Array<{
  capabilityId: string;
  label: string;
  signalType: 'package_presence' | 'metadata_presence' | 'feature_indicator' | 'configuration_indicator';
  confidenceLevel: ConfidenceLevel;
}> {
  const packages = snapshot.installedPackages;
  const coverage = snapshot.metadataCoverage;
  const capabilities: Array<{
    capabilityId: string;
    label: string;
    signalType: 'package_presence' | 'metadata_presence' | 'feature_indicator' | 'configuration_indicator';
    confidenceLevel: ConfidenceLevel;
  }> = [];

  if (packages.some((pkg) => /cpq|revenue|billing/i.test(pkg.subscriberPackageName) || /sbqq|rbm/i.test(pkg.subscriberPackageNamespace ?? ''))) {
    capabilities.push({
      capabilityId: 'cap-revenue-stack',
      label: 'Revenue-related package presence',
      signalType: 'package_presence',
      confidenceLevel: 'high',
    });
  }

  if (packages.some((pkg) => /field service|fsi|health cloud|manufacturing cloud/i.test(pkg.subscriberPackageName))) {
    capabilities.push({
      capabilityId: 'cap-industry-cloud',
      label: 'Industry cloud package indicators present',
      signalType: 'package_presence',
      confidenceLevel: 'medium',
    });
  }

  if (hasPositiveCount(coverage.flows) || hasPositiveCount(coverage.apexClasses) || hasPositiveCount(coverage.triggers)) {
    capabilities.push({
      capabilityId: 'cap-automation-footprint',
      label: 'Automation footprint is present in the org baseline',
      signalType: 'metadata_presence',
      confidenceLevel: 'high',
    });
  }

  if (hasPositiveCount(coverage.permissionSets) || hasPositiveCount(coverage.profiles)) {
    capabilities.push({
      capabilityId: 'cap-governance-surface',
      label: 'Permission and profile governance surface is present',
      signalType: 'configuration_indicator',
      confidenceLevel: 'medium',
    });
  }

  if (hasPositiveCount(coverage.connectedApps) || hasPositiveCount(coverage.namedCredentials) || hasPositiveCount(coverage.externalCredentials)) {
    capabilities.push({
      capabilityId: 'cap-integration-surface',
      label: 'Integration-related configuration indicators are present',
      signalType: 'feature_indicator',
      confidenceLevel: 'medium',
    });
  }

  return capabilities;
}

export function detectAutomationSurfaceSignals(snapshot: OrgInspectionSnapshot): Array<{
  surfaceId: string;
  label: string;
  surfaceType: 'flow' | 'apex' | 'validation' | 'approval' | 'process' | 'unknown';
  observedSignal: string;
}> {
  const coverage = snapshot.metadataCoverage;
  const surfaces: Array<{
    surfaceId: string;
    label: string;
    surfaceType: 'flow' | 'apex' | 'validation' | 'approval' | 'process' | 'unknown';
    observedSignal: string;
  }> = [];

  if (hasPositiveCount(coverage.flows)) {
    surfaces.push({
      surfaceId: 'auto-flow',
      label: 'Flow footprint present',
      surfaceType: 'flow',
      observedSignal: `${coverage.flows} flow definitions were observed during baseline inspection.`,
    });
  }

  if (hasPositiveCount(coverage.apexClasses) || hasPositiveCount(coverage.triggers)) {
    surfaces.push({
      surfaceId: 'auto-apex',
      label: 'Apex automation footprint present',
      surfaceType: 'apex',
      observedSignal: `${coverage.apexClasses ?? 0} Apex classes and ${coverage.triggers ?? 0} triggers were observed.`,
    });
  }

  if (hasPositiveCount(coverage.validationRules)) {
    surfaces.push({
      surfaceId: 'auto-validation',
      label: 'Validation rule footprint present',
      surfaceType: 'validation',
      observedSignal: `${coverage.validationRules} validation rules were surfaced in sampled metadata.`,
    });
  }

  if (hasPositiveCount(coverage.approvalProcesses)) {
    surfaces.push({
      surfaceId: 'auto-approval',
      label: 'Approval process footprint present',
      surfaceType: 'approval',
      observedSignal: `${coverage.approvalProcesses} approval processes were observed.`,
    });
  }

  if (hasPositiveCount(coverage.processBuilders)) {
    surfaces.push({
      surfaceId: 'auto-process',
      label: 'Legacy process builder footprint present',
      surfaceType: 'process',
      observedSignal: `${coverage.processBuilders} process definitions were observed.`,
    });
  }

  return surfaces;
}

export function detectSecuritySurfaceHints(snapshot: OrgInspectionSnapshot): Array<{
  hintId: string;
  text: string;
  hintType: 'permission_model' | 'sharing_model' | 'profile_permission_shape' | 'permset_signal' | 'auth_signal' | 'governance_signal';
}> {
  const coverage = snapshot.metadataCoverage;
  const hints: Array<{
    hintId: string;
    text: string;
    hintType: 'permission_model' | 'sharing_model' | 'profile_permission_shape' | 'permset_signal' | 'auth_signal' | 'governance_signal';
  }> = [];

  if (hasPositiveCount(coverage.permissionSets)) {
    hints.push({
      hintId: 'sec-permsets',
      text: `Permission set signals are present (${coverage.permissionSets} observed), which suggests a dedicated access-model review may be warranted.`,
      hintType: 'permset_signal',
    });
  }

  if (hasPositiveCount(coverage.profiles)) {
    hints.push({
      hintId: 'sec-profiles',
      text: `Profile-related configuration is present (${coverage.profiles} observed), which may indicate legacy permission coupling worth reviewing.`,
      hintType: 'profile_permission_shape',
    });
  }

  if (hasPositiveCount(coverage.roles) || hasPositiveCount(coverage.sharingRules)) {
    hints.push({
      hintId: 'sec-sharing',
      text: 'Role or sharing-rule signals are present, so org-wide defaults and record access should be reviewed in a follow-on governance pass.',
      hintType: 'sharing_model',
    });
  }

  if (snapshot.accessAssessment && snapshot.accessAssessment.status !== 'available') {
    hints.push({
      hintId: 'sec-auth-context',
      text: 'Authenticated org access was degraded during baseline capture, so org security conclusions should be treated as provisional.',
      hintType: 'auth_signal',
    });
  }

  if (hasPositiveCount(coverage.connectedApps) || hasPositiveCount(coverage.externalCredentials) || hasPositiveCount(coverage.namedCredentials)) {
    hints.push({
      hintId: 'sec-integration-governance',
      text: 'Connected app or credential signals are present and should be reviewed for governance and authentication patterns.',
      hintType: 'governance_signal',
    });
  }

  return hints;
}
