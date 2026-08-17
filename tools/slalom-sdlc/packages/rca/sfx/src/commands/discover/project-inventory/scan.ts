import { readdirSync, readFileSync } from 'node:fs';
import * as path from 'node:path';

import type {
  CandidateDomain,
  ConfidenceLevel,
  Hotspot,
  KeyConfigFile,
  NamespaceIndicator,
  PackageRoot,
  PackagingSignal,
  ProjectInventoryDetailLevel,
  ProjectInventoryScanResult,
  RepoKind,
} from './types';

interface RepoFileEntry {
  relativePath: string;
  absolutePath: string;
}

interface SfdxProjectConfig {
  packageDirectories?: Array<{
    path?: string;
    default?: boolean;
    package?: string;
    versionName?: string;
  }>;
  namespace?: string;
  packageAliases?: Record<string, string>;
}

const IGNORED_DIRECTORY_NAMES = new Set([
  '.git',
  '.hg',
  '.svn',
  'node_modules',
  'dist',
  'coverage',
  '.sf',
  '.sfdx',
  '.yarn',
  '.pnpm-store',
]);

const DETAIL_FILE_LIMITS: Record<ProjectInventoryDetailLevel, number> = {
  low: 400,
  standard: 2_000,
  deep: 10_000,
};

const KEY_CONFIG_FILE_ROLES: Readonly<Record<string, string>> = Object.freeze({
  'sfdx-project.json': 'project_manifest',
  'package.json': 'node_package_manifest',
  'pnpm-workspace.yaml': 'workspace_manifest',
  'tsconfig.json': 'typescript_config',
  '.forceignore': 'salesforce_ignore_rules',
});

const DOMAIN_DEFINITIONS = [
  {
    domain_id: 'quote_to_cash',
    label: 'Quote to Cash',
    terms: ['quote', 'quotes', 'pricing', 'price', 'prices', 'cpq', 'order', 'orders', 'contract', 'contracts', 'invoice'],
  },
  {
    domain_id: 'revenue_cloud',
    label: 'Revenue Cloud',
    terms: ['revenue', 'billing', 'cpq', 'pricing', 'quote', 'order', 'contract', 'subscription'],
  },
  {
    domain_id: 'security_governance',
    label: 'Security Governance',
    terms: ['permission', 'permissions', 'profile', 'profiles', 'security', 'access', 'sharing', 'role', 'auth'],
  },
  {
    domain_id: 'service_operations',
    label: 'Service Operations',
    terms: ['case', 'service', 'workorder', 'entitlement', 'asset', 'knowledge'],
  },
  {
    domain_id: 'sales_core',
    label: 'Sales Core',
    terms: ['account', 'opportunity', 'lead', 'contact', 'campaign', 'forecast'],
  },
  {
    domain_id: 'approvals',
    label: 'Approvals',
    terms: ['approval', 'approvals', 'approvalprocess'],
  },
] as const;

const METADATA_MATCHERS = [
  { family: 'apex_classes', matches: (value: string): boolean => value.endsWith('.cls') },
  { family: 'triggers', matches: (value: string): boolean => value.endsWith('.trigger') },
  { family: 'flows', matches: (value: string): boolean => value.endsWith('.flow-meta.xml') },
  { family: 'objects', matches: (value: string): boolean => /(?:^|\/)objects\/[^/]+\/[^/]+\.object-meta\.xml$/.test(value) },
  { family: 'layouts', matches: (value: string): boolean => value.endsWith('.layout-meta.xml') },
  { family: 'profiles', matches: (value: string): boolean => value.endsWith('.profile-meta.xml') },
  { family: 'permission_sets', matches: (value: string): boolean => value.endsWith('.permissionset-meta.xml') },
  { family: 'permission_set_groups', matches: (value: string): boolean => value.endsWith('.permissionsetgroup-meta.xml') },
  { family: 'flexipages', matches: (value: string): boolean => value.endsWith('.flexipage-meta.xml') },
  { family: 'applications', matches: (value: string): boolean => value.endsWith('.app-meta.xml') },
  { family: 'quick_actions', matches: (value: string): boolean => value.endsWith('.quickaction-meta.xml') },
] as const;

const ROOT_LEVEL_METADATA_DIRECTORIES = new Set([
  'applications',
  'approvalprocesses',
  'assignmentrules',
  'aura',
  'classes',
  'contentassets',
  'custommetadata',
  'dashboards',
  'email',
  'experiences',
  'flexipages',
  'flows',
  'labels',
  'layouts',
  'lwc',
  'objects',
  'pages',
  'permissionsetgroups',
  'permissionsets',
  'profiles',
  'queues',
  'quickactions',
  'reporttypes',
  'reports',
  'staticresources',
  'tabs',
  'triggers',
]);

export function scanProjectInventory(repoRoot: string, detail: ProjectInventoryDetailLevel = 'standard'): ProjectInventoryScanResult {
  const absoluteRepoRoot = path.resolve(repoRoot);
  const warningsSummary: string[] = [];
  const collectedFiles = collectRepoFiles(absoluteRepoRoot, detail, warningsSummary);
  const sfdxProject = readSfdxProjectConfig(absoluteRepoRoot, warningsSummary);
  const metadataFamilyCounts = countMetadataFamilies(collectedFiles);
  const keyConfigFiles = collectKeyConfigFiles(collectedFiles);
  const packageRoots = detectPackageRoots(collectedFiles, sfdxProject);
  const namespaces = collectNamespaces(sfdxProject);
  const packagingSignals = collectPackagingSignals(sfdxProject, packageRoots);
  const candidateDomains = detectCandidateDomains(collectedFiles, metadataFamilyCounts);
  const hotspots = buildHotspots(metadataFamilyCounts, candidateDomains, packageRoots, namespaces);
  const repoKind = determineRepoKind(sfdxProject, metadataFamilyCounts, keyConfigFiles);

  if (!sfdxProject) {
    warningsSummary.push('sfdx-project.json was not found; package root discovery used filesystem heuristics.');
  }

  if (Object.keys(metadataFamilyCounts).length === 0) {
    warningsSummary.push('No Salesforce metadata families were detected during the repo scan.');
  }

  const recommended_next_steps = buildRecommendedNextSteps(candidateDomains, repoKind);

  return {
    repo_root: absoluteRepoRoot,
    detail,
    repo_kind: repoKind,
    package_roots: packageRoots,
    metadata_family_counts: metadataFamilyCounts,
    candidate_domains: candidateDomains,
    hotspots,
    recommended_next_steps,
    namespaces,
    key_config_files: keyConfigFiles,
    packaging_signals: packagingSignals,
    warnings_summary: dedupeAndSort(warningsSummary),
    stats: {
      files_scanned: collectedFiles.length,
      matched_metadata_files: Object.values(metadataFamilyCounts).reduce((total, count) => total + count, 0),
      package_root_count: packageRoots.length,
      hotspot_count: hotspots.length,
    },
  };
}

function collectRepoFiles(repoRoot: string, detail: ProjectInventoryDetailLevel, warningsSummary: string[]): RepoFileEntry[] {
  const entries: RepoFileEntry[] = [];
  const fileLimit = DETAIL_FILE_LIMITS[detail];
  const queue = [''];

  while (queue.length > 0) {
    const relativeDirectory = queue.pop() as string;
    const absoluteDirectory = path.join(repoRoot, relativeDirectory);

    try {
      for (const dirent of readdirSync(absoluteDirectory, { withFileTypes: true })) {
        const relativePath = toPosixPath(path.join(relativeDirectory, dirent.name));
        if (dirent.isDirectory()) {
          if (!IGNORED_DIRECTORY_NAMES.has(dirent.name)) {
            queue.push(relativePath);
          }
          continue;
        }

        if (!dirent.isFile()) {
          continue;
        }

        entries.push({
          relativePath,
          absolutePath: path.join(repoRoot, relativePath),
        });

        if (entries.length >= fileLimit) {
          warningsSummary.push(`Scan stopped after ${fileLimit} files for detail level ${detail}.`);
          return entries;
        }
      }
    } catch (error) {
      warningsSummary.push(buildUnreadablePathWarning(relativeDirectory || '.', error));
    }
  }

  return entries;
}

function readSfdxProjectConfig(repoRoot: string, warningsSummary: string[]): SfdxProjectConfig | null {
  const configPath = path.join(repoRoot, 'sfdx-project.json');

  try {
    const raw = readFileSync(configPath, 'utf8');
    return JSON.parse(raw) as SfdxProjectConfig;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
      warningsSummary.push(`Failed to parse sfdx-project.json: ${(error as Error).message}`);
    }
    return null;
  }
}

function countMetadataFamilies(files: RepoFileEntry[]): Record<string, number> {
  const counts: Record<string, number> = {};

  for (const file of files) {
    const normalizedPath = file.relativePath.toLowerCase();
    for (const matcher of METADATA_MATCHERS) {
      if (matcher.matches(normalizedPath)) {
        counts[matcher.family] = (counts[matcher.family] ?? 0) + 1;
      }
    }
  }

  return sortRecordByKey(counts);
}

function collectKeyConfigFiles(files: RepoFileEntry[]): KeyConfigFile[] {
  const configFiles: KeyConfigFile[] = [];

  for (const file of files) {
    const fileName = path.posix.basename(file.relativePath);
    const role = KEY_CONFIG_FILE_ROLES[fileName];
    if (role) {
      configFiles.push({
        path: file.relativePath,
        file_role: role,
      });
    }
  }

  return configFiles.sort((left, right) => left.path.localeCompare(right.path));
}

function detectPackageRoots(files: RepoFileEntry[], sfdxProject: SfdxProjectConfig | null): PackageRoot[] {
  const packageRootMap = new Map<string, PackageRoot>();

  for (const packageDirectory of sfdxProject?.packageDirectories ?? []) {
    if (!packageDirectory.path) {
      continue;
    }

    packageRootMap.set(toPosixPath(packageDirectory.path), {
      path: toPosixPath(packageDirectory.path),
      root_type: 'sfdx_package_root',
      confidence_level: 'high',
    });
  }

  for (const file of files) {
    const inferredRoot = inferRootFromMetadataPath(file.relativePath);
    if (!inferredRoot) {
      continue;
    }

    if (!packageRootMap.has(inferredRoot.path)) {
      packageRootMap.set(inferredRoot.path, inferredRoot);
    }
  }

  return Array.from(packageRootMap.values()).sort((left, right) => left.path.localeCompare(right.path));
}

function inferRootFromMetadataPath(relativePath: string): PackageRoot | null {
  const segments = relativePath.split('/');
  if (segments.length < 1) {
    return null;
  }

  const normalizedSegments = segments.map((segment) => segment.toLowerCase());
  const mainDefaultIndex = normalizedSegments.findIndex((segment, index) => segment === 'main' && normalizedSegments[index + 1] === 'default');
  if (mainDefaultIndex > 0) {
    return {
      path: segments.slice(0, mainDefaultIndex).join('/'),
      root_type: 'source_root',
      confidence_level: 'medium',
    };
  }

  if (ROOT_LEVEL_METADATA_DIRECTORIES.has(normalizedSegments[0])) {
    return {
      path: '.',
      root_type: 'metadata_root',
      confidence_level: 'medium',
    };
  }

  if (segments.length >= 2 && ROOT_LEVEL_METADATA_DIRECTORIES.has(normalizedSegments[1])) {
    return {
      path: segments[0],
      root_type: 'metadata_root',
      confidence_level: 'medium',
    };
  }

  return null;
}

function collectNamespaces(sfdxProject: SfdxProjectConfig | null): NamespaceIndicator[] {
  if (!sfdxProject?.namespace) {
    return [];
  }

  return [
    {
      namespace: sfdxProject.namespace,
      source: 'sfdx-project.json',
    },
  ];
}

function collectPackagingSignals(sfdxProject: SfdxProjectConfig | null, packageRoots: PackageRoot[]): PackagingSignal[] {
  const packagingSignals: PackagingSignal[] = [];

  if ((sfdxProject?.packageDirectories?.length ?? 0) > 1) {
    packagingSignals.push({
      signal_id: 'pkg_001',
      text: `Repository declares ${sfdxProject?.packageDirectories?.length ?? 0} packageDirectories in sfdx-project.json.`,
    });
  }

  if (sfdxProject?.namespace) {
    packagingSignals.push({
      signal_id: 'pkg_002',
      text: `Repository declares namespace ${sfdxProject.namespace}.`,
    });
  }

  if (sfdxProject?.packageAliases && Object.keys(sfdxProject.packageAliases).length > 0) {
    packagingSignals.push({
      signal_id: 'pkg_003',
      text: `Repository includes ${Object.keys(sfdxProject.packageAliases).length} package aliases.`,
    });
  }

  if (!sfdxProject && packageRoots.length > 1) {
    packagingSignals.push({
      signal_id: 'pkg_004',
      text: 'Multiple likely package roots were inferred without an sfdx-project.json manifest.',
    });
  }

  return packagingSignals;
}

function detectCandidateDomains(files: RepoFileEntry[], metadataFamilyCounts: Record<string, number>): CandidateDomain[] {
  const domainSignals = new Map<string, Set<string>>();

  for (const definition of DOMAIN_DEFINITIONS) {
    domainSignals.set(definition.domain_id, new Set<string>());
  }

  for (const file of files) {
    const tokens = tokenize(file.relativePath);
    const uniqueTokens = new Set(tokens);

    for (const definition of DOMAIN_DEFINITIONS) {
      for (const term of definition.terms) {
        if (uniqueTokens.has(term)) {
          domainSignals.get(definition.domain_id)?.add(`path token: ${term}`);
        }
      }
    }
  }

  if ((metadataFamilyCounts.permission_sets ?? 0) + (metadataFamilyCounts.profiles ?? 0) >= 2) {
    domainSignals.get('security_governance')?.add('metadata families: profiles/permission sets');
  }

  if ((metadataFamilyCounts.flows ?? 0) >= 1) {
    domainSignals.get('approvals')?.add('automation inventory includes flows');
  }

  return DOMAIN_DEFINITIONS.flatMap((definition) => {
    const signals = Array.from(domainSignals.get(definition.domain_id) ?? []).sort();
    if (signals.length === 0) {
      return [];
    }

    return [{
      domain_id: definition.domain_id,
      label: definition.label,
      confidence_level: inferConfidenceLevel(signals.length),
      signals,
    } satisfies CandidateDomain];
  }).sort((left, right) => {
    const confidenceOrder = confidenceWeight(right.confidence_level) - confidenceWeight(left.confidence_level);
    return confidenceOrder !== 0 ? confidenceOrder : left.domain_id.localeCompare(right.domain_id);
  });
}

function buildHotspots(
  metadataFamilyCounts: Record<string, number>,
  candidateDomains: CandidateDomain[],
  packageRoots: PackageRoot[],
  namespaces: NamespaceIndicator[],
): Hotspot[] {
  const hotspots: Hotspot[] = [];
  let index = 1;
  const apexClasses = metadataFamilyCounts.apex_classes ?? 0;
  const triggers = metadataFamilyCounts.triggers ?? 0;
  const flows = metadataFamilyCounts.flows ?? 0;
  const permissionSets = metadataFamilyCounts.permission_sets ?? 0;
  const profiles = metadataFamilyCounts.profiles ?? 0;
  const totalMetadata = Object.values(metadataFamilyCounts).reduce((total, count) => total + count, 0);

  if (apexClasses + triggers + flows >= 3) {
    hotspots.push({
      hotspot_id: createHotspotId(index++),
      label: 'Automation-heavy metadata cluster',
      hotspot_type: 'automation_concentration',
      why_it_matters: 'Apex, trigger, and flow volume suggests automation deserves early architecture review.',
      evidence_refs: ['ev_repo_metadata_families_001'],
    });
  }

  if (totalMetadata >= 4 || permissionSets + profiles >= 2) {
    hotspots.push({
      hotspot_id: createHotspotId(index++),
      label: 'Metadata concentration worth triage',
      hotspot_type: 'metadata_concentration',
      why_it_matters: 'The repo contains enough metadata families to justify a focused inventory review before workshops.',
      evidence_refs: ['ev_repo_metadata_families_001'],
    });
  }

  const topDomain = candidateDomains[0];
  if (topDomain && topDomain.confidence_level !== 'low') {
    hotspots.push({
      hotspot_id: createHotspotId(index++),
      label: `${topDomain.label} signal cluster`,
      hotspot_type: 'domain_cluster',
      why_it_matters: `Repo naming patterns point to ${topDomain.label.toLowerCase()} as a likely discovery focus area.`,
      evidence_refs: ['ev_repo_domain_signals_001'],
    });
  }

  if (packageRoots.length > 1 || namespaces.length > 0) {
    hotspots.push({
      hotspot_id: createHotspotId(index++),
      label: 'Packaging complexity signal',
      hotspot_type: 'packaging_signal',
      why_it_matters: 'Multiple package roots or a namespace can change how discovery should be sequenced and sampled.',
      evidence_refs: ['ev_repo_package_roots_001'],
    });
  }

  return hotspots;
}

function determineRepoKind(
  sfdxProject: SfdxProjectConfig | null,
  metadataFamilyCounts: Record<string, number>,
  keyConfigFiles: KeyConfigFile[],
): RepoKind {
  const metadataSignals = Object.values(metadataFamilyCounts).reduce((total, count) => total + count, 0);
  const hasWorkspaceManifest = keyConfigFiles.some((file) => file.file_role === 'workspace_manifest');
  const hasNestedNodeManifest = keyConfigFiles.some(
    (file) => file.file_role === 'node_package_manifest' && file.path !== 'package.json',
  );
  const hasAdjacentWorkspaceSignals = hasWorkspaceManifest || hasNestedNodeManifest;

  if (sfdxProject && metadataSignals > 0) {
    return hasAdjacentWorkspaceSignals ? 'mixed_repo' : 'salesforce_repo';
  }

  if (sfdxProject) {
    return 'salesforce_repo';
  }

  if (metadataSignals > 0) {
    return 'nonstandard_repo';
  }

  return 'unknown';
}

function buildRecommendedNextSteps(candidateDomains: CandidateDomain[], repoKind: RepoKind): ProjectInventoryScanResult['recommended_next_steps'] {
  const steps: ProjectInventoryScanResult['recommended_next_steps'] = [];

  if (repoKind !== 'unknown') {
    steps.push({
      step_id: 'step_001',
      text: 'Run sfx discover org-baseline --org <alias> --json',
      step_type: 'command',
    });
  }

  if (candidateDomains[0] && candidateDomains[0].confidence_level !== 'low') {
    steps.push({
      step_id: `step_${String(steps.length + 1).padStart(3, '0')}`,
      text: `Use the ${candidateDomains[0].label} hotspot signals to frame follow-up discovery questions.`,
      step_type: 'analysis',
    });
  }

  if (repoKind === 'nonstandard_repo' || repoKind === 'unknown') {
    steps.push({
      step_id: `step_${String(steps.length + 1).padStart(3, '0')}`,
      text: 'Confirm the actual metadata deployment roots before relying on package-path assumptions.',
      step_type: 'analysis',
    });
  }

  return steps;
}

function buildUnreadablePathWarning(relativePath: string, error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  return `Skipped unreadable path ${relativePath}: ${message}`;
}

function inferConfidenceLevel(signalCount: number): ConfidenceLevel {
  if (signalCount >= 4) {
    return 'high';
  }
  if (signalCount >= 2) {
    return 'medium';
  }
  return 'low';
}

function confidenceWeight(confidenceLevel: ConfidenceLevel): number {
  switch (confidenceLevel) {
    case 'high':
      return 3;
    case 'medium':
      return 2;
    case 'low':
      return 1;
  }
}

function tokenize(value: string): string[] {
  return value
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((token) => token.length > 0);
}

function createHotspotId(index: number): string {
  return `hot_${String(index).padStart(3, '0')}`;
}

function sortRecordByKey(input: Record<string, number>): Record<string, number> {
  return Object.fromEntries(Object.entries(input).sort(([left], [right]) => left.localeCompare(right)));
}

function dedupeAndSort(values: string[]): string[] {
  return Array.from(new Set(values)).sort((left, right) => left.localeCompare(right));
}

function toPosixPath(value: string): string {
  return value.split(path.sep).join(path.posix.sep);
}
