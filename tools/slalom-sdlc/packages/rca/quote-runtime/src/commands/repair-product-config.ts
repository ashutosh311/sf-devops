import { readFileSync } from 'node:fs';

import { Flags, Parser } from '@oclif/core';

import type { GlobalFlags } from '../cli/global-flags';
import { emitJsonOutput, emitTextOutput, type CliIo } from '../cli/output';
import { runEnvelopeCommand, type EnvelopeCommandSpec } from '../cli/run-envelope-command';
import { exitCodeForStatus, makeEnvelope, type JsonValue, type ResultEnvelope } from '../contracts/result-envelope';
import { invokeSfJson, type InvokeSfJsonOptions, type SfCliJsonResult } from '../integrations/salesforce/sf-cli';
import type { InvokeSfRestWriteOptions, SfRestWriteResult } from '../integrations/salesforce/rest';
import { buildSoqlSelect, quoteSoqlId } from '../integrations/salesforce/soql';
import {
  buildQuoteLineDeleteGraphRecord,
  buildQuoteLineRelationshipDeleteGraphRecord,
  executePstGraphMutation,
  type QuoteMutationPrimitiveResult
} from '../primitives/quote-mutations';

export const REPAIR_PRODUCT_CONFIG_HELP_TEXT = [
  'quote-runtime repair-product-config',
  '',
  'Usage:',
  '  quote-runtime repair-product-config --org-alias <alias> --quote-id <id> --line-id <id> --repair-plan <path> [--execute]',
  '',
  'Notes:',
  '  Executes only narrow org-proven child selection repairs through the PST graph mutation lane. Dry-run is default.'
].join('\n');

const FLAGS = {
  'quote-id': Flags.string({ required: true }),
  'line-id': Flags.string({ required: true }),
  'repair-plan': Flags.string({ required: true }),
  execute: Flags.boolean({ allowNo: false })
};

type RepairAction = {
  action: 'enforce_component_selection';
  component_group: string;
  keep_product_ids: string[];
  candidate_product_ids: string[];
};

type RepairPlan = {
  actions: RepairAction[];
};

type QueryResponse = {
  records?: unknown[];
};

type ChildLine = {
  Id: string;
  Product2Id: string;
  ParentQuoteLineItemId: string;
};

type LineRelationship = {
  Id: string;
  MainQuoteLineId: string;
  AssociatedQuoteLineId: string;
};

export type RepairProductConfigCommandDependencies = {
  invokeSfJson?: <T>(options: InvokeSfJsonOptions) => Promise<SfCliJsonResult<T>>;
  invokeSfRestWrite?: <T>(options: InvokeSfRestWriteOptions) => Promise<SfRestWriteResult<T>>;
  executePstGraphMutation?: (input: Parameters<typeof executePstGraphMutation>[0]) => Promise<QuoteMutationPrimitiveResult>;
};

export function renderRepairProductConfigHelp(): string {
  return REPAIR_PRODUCT_CONFIG_HELP_TEXT;
}

const REPAIR_PRODUCT_CONFIG_SPEC: EnvelopeCommandSpec<RepairProductConfigCommandDependencies> = {
  commandName: 'repair-product-config',
  execute: async ({ argv, globalFlags, startedAt, deps }) => {
    const parsed = (await Parser.parse(argv, { args: {}, enableJsonFlag: false, flags: FLAGS, strict: true })) as {
      flags: { 'quote-id': string; 'line-id': string; 'repair-plan': string; execute?: boolean };
    };
    const repairPlan = normalizeRepairPlan(JSON.parse(readFileSync(parsed.flags['repair-plan'], 'utf8')));
    const execute = parsed.flags.execute === true;
    const repairResult = execute
      ? await executeRepair({
        orgAlias: globalFlags.orgAlias!,
        quoteId: parsed.flags['quote-id'],
        lineId: parsed.flags['line-id'],
        repairPlan,
        invokeSfJson: deps.invokeSfJson,
        invokeSfRestWrite: deps.invokeSfRestWrite,
        executePstGraphMutation: deps.executePstGraphMutation
      })
      : buildDryRunRepairResult(parsed.flags['quote-id'], parsed.flags['line-id'], repairPlan);
    return makeEnvelope({
      command: 'repair-product-config',
      status: repairResult.status,
      summary: {
        primary_subject: parsed.flags['line-id'],
        status_reason: repairResult.status_reason,
        primary_lane: 'product_config_repair',
        next_suggested_command: 'validate-product-config'
      },
      result: repairResult.result,
      warnings: repairResult.warnings,
      errors: repairResult.errors,
      evidence: repairResult.evidence,
      meta: {
        org_alias: globalFlags.orgAlias!,
        generated_at: new Date().toISOString(),
        duration_ms: Math.max(0, Date.now() - startedAt),
        source_files: [parsed.flags['repair-plan']]
      }
    });
  },
  renderText: (envelope) => `quote-runtime repair-product-config\nstatus: ${envelope.status}\nreason: ${String(envelope.summary.status_reason ?? '')}`
};

export async function runRepairProductConfigCommand(
  argv: string[],
  globalFlags: GlobalFlags,
  io: CliIo,
  dependencies: RepairProductConfigCommandDependencies = {}
): Promise<{ envelope: ResultEnvelope; text: string; exitCode: 0 | 1 }> {
  return runEnvelopeCommand(REPAIR_PRODUCT_CONFIG_SPEC, argv, globalFlags, io, dependencies);
}

async function executeRepair(input: {
  orgAlias: string;
  quoteId: string;
  lineId: string;
  repairPlan: RepairPlan;
  invokeSfJson?: <T>(options: InvokeSfJsonOptions) => Promise<SfCliJsonResult<T>>;
  invokeSfRestWrite?: <T>(options: InvokeSfRestWriteOptions) => Promise<SfRestWriteResult<T>>;
  executePstGraphMutation?: (input: Parameters<typeof executePstGraphMutation>[0]) => Promise<QuoteMutationPrimitiveResult>;
}): Promise<{
  status: 'changed' | 'ok' | 'unsupported' | 'error';
  status_reason: string;
  result: Record<string, JsonValue>;
  warnings: string[];
  errors: string[];
  evidence: ResultEnvelope['evidence'];
}> {
  const executeSfJson = input.invokeSfJson ?? invokeSfJson;
  const unsupported = input.repairPlan.actions.filter((action) => action.action !== 'enforce_component_selection' || action.candidate_product_ids.length === 0);
  if (unsupported.length > 0) {
    return {
      status: 'unsupported',
      status_reason: 'Repair plan contains unsupported or underspecified actions.',
      result: baseResult(input.quoteId, input.lineId, input.repairPlan),
      warnings: [],
      errors: ['Only enforce_component_selection actions with candidate_product_ids are executable.'],
      evidence: []
    };
  }

  const [childLinesResult, relationshipsResult] = await Promise.all([
    executeSfJson<QueryResponse>({
      args: ['data', 'query', '--target-org', input.orgAlias, '--query', buildChildLinesSoql(input.quoteId, input.lineId), '--json'],
      orgAlias: input.orgAlias
    }),
    executeSfJson<QueryResponse>({
      args: ['data', 'query', '--target-org', input.orgAlias, '--query', buildLineRelationshipsSoql(input.quoteId, input.lineId), '--json'],
      orgAlias: input.orgAlias
    })
  ]);
  const queryErrors = [childLinesResult, relationshipsResult].flatMap((result) => result.ok ? [] : [result.message]);
  if (queryErrors.length > 0 || childLinesResult.ok === false || relationshipsResult.ok === false) {
    return {
      status: 'error',
      status_reason: 'Unable to read child lines or relationships before repair.',
      result: baseResult(input.quoteId, input.lineId, input.repairPlan),
      warnings: [],
      errors: queryErrors,
      evidence: []
    };
  }

  const childLines = (childLinesResult.data.records ?? []).filter(isChildLine);
  const relationships = (relationshipsResult.data.records ?? []).filter(isLineRelationship);
  const deleteLineIds = new Set<string>();
  for (const action of input.repairPlan.actions) {
    const candidates = new Set(action.candidate_product_ids);
    const keep = new Set(action.keep_product_ids);
    for (const line of childLines) {
      if (candidates.has(line.Product2Id) && !keep.has(line.Product2Id)) {
        deleteLineIds.add(line.Id);
      }
    }
  }
  const deleteRelationshipIds = relationships
    .filter((relationship) => deleteLineIds.has(relationship.AssociatedQuoteLineId))
    .map((relationship) => relationship.Id);

  const deleteRecords = [
    ...deleteRelationshipIds.map((relationshipId, index) => buildQuoteLineRelationshipDeleteGraphRecord(relationshipId, index)),
    ...[...deleteLineIds].map((lineId, index) => buildQuoteLineDeleteGraphRecord(lineId, index))
  ];

  if (deleteRecords.length === 0) {
    return {
      status: 'ok',
      status_reason: 'No repair records matched the plan.',
      result: {
        ...baseResult(input.quoteId, input.lineId, input.repairPlan),
        delete_relationship_ids: deleteRelationshipIds,
        delete_line_ids: [...deleteLineIds],
        deleted_count: 0
      },
      warnings: [],
      errors: [],
      evidence: []
    };
  }

  const primitive = await (input.executePstGraphMutation ?? executePstGraphMutation)({
    orgAlias: input.orgAlias,
    mode: 'execute',
    records: deleteRecords,
    expectedVerificationCommands: ['validate-product-config', 'snapshot-lines', 'overlay-relationships'],
    invokeSfJson: input.invokeSfJson,
    invokeSfRestWrite: input.invokeSfRestWrite
  });

  if (primitive.status !== 'changed') {
    return {
      status: primitive.status,
      status_reason: 'PST graph repair delete operation failed.',
      result: {
        ...baseResult(input.quoteId, input.lineId, input.repairPlan),
        delete_relationship_ids: deleteRelationshipIds,
        delete_line_ids: [...deleteLineIds],
        mutation: primitive.result as unknown as JsonValue
      },
      warnings: primitive.warnings,
      errors: primitive.errors,
      evidence: primitive.evidence
    };
  }

  return {
    status: 'changed',
    status_reason: 'Executed configured-product child selection repair through PST graph deletes.',
    result: {
      ...baseResult(input.quoteId, input.lineId, input.repairPlan),
      delete_relationship_ids: deleteRelationshipIds,
      delete_line_ids: [...deleteLineIds],
      deleted_count: deleteRecords.length,
      mutation: primitive.result as unknown as JsonValue
    },
    warnings: primitive.warnings,
    errors: [],
    evidence: [
      {
        claim: `Executed configured-product repair for quote ${input.quoteId} line ${input.lineId} through PST graph deletes.`,
        evidence_level: 'org_proven',
        proof_source: [buildChildLinesSoql(input.quoteId, input.lineId), buildLineRelationshipsSoql(input.quoteId, input.lineId)],
        limitations: 'Repair execution deletes only child quote lines and relationships in the component-group candidate set.',
        source_refs: []
      },
      ...primitive.evidence
    ]
  };
}

function buildDryRunRepairResult(quoteId: string, lineId: string, repairPlan: RepairPlan) {
  return {
    status: 'ok' as const,
    status_reason: 'Repair plan loaded for dry-run review.',
    result: baseResult(quoteId, lineId, repairPlan),
    warnings: ['Dry run only. Re-run with --execute to delete non-selected component child lines and relationships.'],
    errors: [],
    evidence: []
  };
}

function buildChildLinesSoql(quoteId: string, lineId: string): string {
  return buildSoqlSelect({
    objectName: 'QuoteLineItem',
    fields: ['Id', 'QuoteId', 'Product2Id', 'ParentQuoteLineItemId'],
    where: `QuoteId = ${quoteSoqlId(quoteId)} AND ParentQuoteLineItemId = ${quoteSoqlId(lineId)}`,
    orderBy: ['Product2Id', 'Id']
  });
}

function buildLineRelationshipsSoql(quoteId: string, lineId: string): string {
  return buildSoqlSelect({
    objectName: 'QuoteLineRelationship',
    fields: ['Id', 'QuoteId', 'MainQuoteLineId', 'AssociatedQuoteLineId', 'ProductRelatedComponentId'],
    where: `QuoteId = ${quoteSoqlId(quoteId)} AND MainQuoteLineId = ${quoteSoqlId(lineId)}`,
    orderBy: ['AssociatedQuoteLineId', 'Id']
  });
}

function normalizeRepairPlan(value: unknown): RepairPlan {
  const plan = isRecord(value) && isRecord(value.result) && isRecord(value.result.post_create_repair_plan)
    ? value.result.post_create_repair_plan
    : isRecord(value) && isRecord(value.post_create_repair_plan)
      ? value.post_create_repair_plan
      : value;
  const actions = isRecord(plan) && Array.isArray(plan.actions) ? plan.actions.filter(isRepairAction) : [];
  return { actions };
}

function baseResult(quoteId: string, lineId: string, repairPlan: RepairPlan): Record<string, JsonValue> {
  return {
    quote_id: quoteId,
    line_id: lineId,
    repair_plan: JSON.parse(JSON.stringify(repairPlan)) as JsonValue
  };
}

function isRepairAction(value: unknown): value is RepairAction {
  return isRecord(value) &&
    value.action === 'enforce_component_selection' &&
    typeof value.component_group === 'string' &&
    Array.isArray(value.keep_product_ids) &&
    value.keep_product_ids.every((entry) => typeof entry === 'string') &&
    Array.isArray(value.candidate_product_ids) &&
    value.candidate_product_ids.every((entry) => typeof entry === 'string');
}

function isChildLine(value: unknown): value is ChildLine {
  return isRecord(value) &&
    typeof value.Id === 'string' &&
    typeof value.Product2Id === 'string' &&
    typeof value.ParentQuoteLineItemId === 'string';
}

function isLineRelationship(value: unknown): value is LineRelationship {
  return isRecord(value) &&
    typeof value.Id === 'string' &&
    typeof value.MainQuoteLineId === 'string' &&
    typeof value.AssociatedQuoteLineId === 'string';
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

// ---------------------------------------------------------------------------
// CommandSpec (Q3: defineCommand consolidation)
// ---------------------------------------------------------------------------
import { defineCommand, WAVE_GROUP_NAMES } from './spec';

export const REPAIR_PRODUCT_CONFIG_COMMAND_SPEC = defineCommand({
  name: 'repair-product-config',
  wave: 3,
  group_name: WAVE_GROUP_NAMES[3],
  summary: 'Review a deterministic repair plan for persisted product configuration issues.',
  ownership: {
        primary_owner: 'config-runtime-bridge',
        secondary_escalation: ['quote-runtime-mutations'],
        shared_library_dependencies: ['quote_mutations', 'evidence']
  },
  selectorPolicy: {
        required_selectors: ['quote_id', 'line_ids'],
        recommended_selectors: [],
        status_reason: 'Product config repair requires explicit target quote and line selectors.'
  },
    quickStart: 'quote-runtime repair-product-config --org-alias <alias> --quote-id <id> --line-id <id> --repair-plan repair-plan.json',
  renderHelp: renderRepairProductConfigHelp,
  run: runRepairProductConfigCommand
});
