import { readFile, stat } from 'node:fs/promises';
import { resolve } from 'node:path';

import { z } from 'zod';

import type { EvidenceLevel, EvidenceItem } from '../contracts/evidence';
import type { RuntimeStatus } from '../contracts/status';

const inspectRlmContextArtifactSchema = z.object({
  name: z.literal('RLM_SalesTransactionContext'),
  source: z.enum(['live_metadata', 'fixture']),
  last_modified: z.string().datetime({ offset: true }).optional()
}).strict();

const inspectRlmContextMappingSchema = z.object({
  mapping_name: z.string().min(1),
  primary_debug_job: z.string().min(1),
  key_nodes: z.array(z.string().min(1)),
  evidence_level: z.enum(['documented', 'repo_proven', 'org_proven', 'inferred', 'unknown'])
}).strict();

const inspectRlmContextBridgeSummarySchema = z.object({
  primary_bridge: z.string(),
  quote_header_mapping: z.string(),
  quote_line_mapping: z.string(),
  lifecycle_mapping: z.string(),
  waterfall_mapping: z.string(),
  limitations: z.array(z.string().min(1))
}).strict();

const inspectRlmContextResultSchema = z.object({
  context_artifact: inspectRlmContextArtifactSchema,
  relevant_mappings: z.array(inspectRlmContextMappingSchema),
  bridge_summary: inspectRlmContextBridgeSummarySchema,
  open_questions: z.array(z.string().min(1))
}).strict();

export type InspectRlmContextArtifact = z.infer<typeof inspectRlmContextArtifactSchema>;
export type InspectRlmContextMapping = z.infer<typeof inspectRlmContextMappingSchema>;
export type InspectRlmContextBridgeSummary = z.infer<typeof inspectRlmContextBridgeSummarySchema>;
export type InspectRlmContextResult = z.infer<typeof inspectRlmContextResultSchema>;

export type InspectRlmContextPrimitiveResult = {
  status: Extract<RuntimeStatus, 'ok' | 'unsupported'>;
  status_detail: 'fixture_loaded' | 'primary_artifact_unreadable';
  result: InspectRlmContextResult;
  warnings: string[];
  errors: string[];
  evidence: EvidenceItem[];
  source_files: string[];
};

export type InspectRlmContextDependencies = {
  readFile?: typeof readFile;
  stat?: typeof stat;
  fixturePath?: string;
};

export type ExecuteInspectRlmContextInput = InspectRlmContextDependencies & {
  orgAlias: string;
  quoteId?: string;
  lineIds?: readonly string[];
};

/**
 * Resolve this module's directory in a way that survives both ESM (standalone
 * dist) and CJS (re-bundled into the MCP server) output. 
 * never throws on an undeclared identifier, so under ESM it falls back to the
 * process cwd. Only used to locate the optional demo fixture below; every real
 * caller (and every test) passes an explicit .
 */
function moduleDirname(): string {
  return typeof __dirname !== 'undefined' ? __dirname : process.cwd();
}

const DEFAULT_FIXTURE_PATH = resolve(
  moduleDirname(),
  '../../tests/fixtures/primitives/inspect-rlm-context/rlm-sales-transaction-context-summary.json'
);

export async function executeInspectRlmContext(
  input: ExecuteInspectRlmContextInput
): Promise<InspectRlmContextPrimitiveResult> {
  const readFileImpl = input.readFile ?? readFile;
  const statImpl = input.stat ?? stat;
  const fixturePath = input.fixturePath ?? DEFAULT_FIXTURE_PATH;

  try {
    const [rawFixture, artifactStats] = await Promise.all([
      readFileImpl(fixturePath, 'utf8'),
      statImpl(fixturePath)
    ]);
    const parsedFixture = inspectRlmContextResultSchema.parse(JSON.parse(rawFixture) as unknown);

    const result: InspectRlmContextResult = {
      ...parsedFixture,
      context_artifact: {
        ...parsedFixture.context_artifact,
        source: 'fixture',
        last_modified: artifactStats.mtime.toISOString()
      }
    };

    return {
      status: 'ok',
      status_detail: 'fixture_loaded',
      result,
      warnings: [],
      errors: [],
      evidence: [
        buildEvidenceItem(
          'RLM_SalesTransactionContext remains the primary context-definition bridge for wave-2 quote-runtime inspection.',
          'documented',
          [
            'specs/quoting-pricing-runtime/quoting-pricing-runtime-node-typescript-wave2-primitives-build-plan.md',
            'specs/quoting-pricing-runtime/quoting-pricing-runtime-phase2-p0.2-context-definition-bridge-validation.md'
          ],
          'This summary is intentionally normalized and summary-first rather than a raw metadata dump.',
          [fixturePath]
        ),
        buildEvidenceItem(
          'The authoritative wave-2 inspect-rlm-context payload is loaded from the tracked normalized summary fixture.',
          'repo_proven',
          [fixturePath],
          'Fixture-backed normalization preserves the locked result contract even when raw repo XML is stale relative to ARM.',
          [fixturePath]
        )
      ],
      source_files: [fixturePath]
    };
  } catch (error) {
    return {
      status: 'unsupported',
      status_detail: 'primary_artifact_unreadable',
      result: createUnsupportedResult(),
      warnings: [],
      errors: [formatArtifactReadFailure(error, fixturePath)],
      evidence: [
        buildEvidenceItem(
          'inspect-rlm-context requires the authoritative normalized RLM summary artifact to be readable.',
          'documented',
          ['specs/quoting-pricing-runtime/quoting-pricing-runtime-node-typescript-wave2-primitives-build-plan.md'],
          'When the primary artifact is missing or unreadable, the primitive must return unsupported.',
          [fixturePath]
        )
      ],
      source_files: [fixturePath]
    };
  }
}

export function getDefaultInspectRlmContextFixturePath(): string {
  return DEFAULT_FIXTURE_PATH;
}

function createUnsupportedResult(): InspectRlmContextResult {
  return {
    context_artifact: {
      name: 'RLM_SalesTransactionContext',
      source: 'fixture'
    },
    relevant_mappings: [],
    bridge_summary: {
      primary_bridge: '',
      quote_header_mapping: '',
      quote_line_mapping: '',
      lifecycle_mapping: '',
      waterfall_mapping: '',
      limitations: []
    },
    open_questions: []
  };
}

function formatArtifactReadFailure(error: unknown, fixturePath: string): string {
  if (error instanceof Error && error.message) {
    return `Unable to read primary RLM context artifact at ${fixturePath}: ${error.message}`;
  }

  return `Unable to read primary RLM context artifact at ${fixturePath}.`;
}

function buildEvidenceItem(
  claim: string,
  evidence_level: EvidenceLevel,
  proof_source: string[],
  limitations: string,
  source_refs: string[]
): EvidenceItem {
  return {
    claim,
    evidence_level,
    proof_source,
    limitations,
    source_refs
  };
}
