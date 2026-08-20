import type { CommandName, Status } from './constants';

export type JsonPrimitive = string | number | boolean | null;
export type JsonValue = JsonPrimitive | JsonObject | JsonValue[];
export interface JsonObject {
  [key: string]: JsonValue;
}

export interface Notice {
  code: string;
  message: string;
  details: Record<string, unknown>;
  suggestion: string;
}

export interface CommandSummary {
  primary_subject: string;
  status_reason: string;
  key_counts: Record<string, unknown>;
  next_suggested_command: string;
}

export interface EvidenceEntry {
  label: string;
  detail: string;
  source?: string;
}

export interface EnvelopeMeta {
  source_files: string[];
  generated_at: string;
  duration_ms: number;
  tool_version: string;
  selector_input?: Record<string, unknown>;
  partial_reason?: string;
}

export interface Envelope<T = JsonValue | Record<string, unknown>> {
  schema_version: string;
  command: CommandName;
  status: Status;
  summary: CommandSummary;
  result: T;
  warnings: Notice[];
  errors: Notice[];
  meta: EnvelopeMeta;
  evidence: EvidenceEntry[];
}

export interface PricingCliErrorObject extends Notice {}

export interface ExplainErrorDetails {
  meaning: string;
  likely_causes: string[];
  next_checks: string[];
  example_commands: string[];
  related_statuses: Status[];
}

export interface ExplainErrorResult extends ExplainErrorDetails {
  error_code: string;
  canonical_error_code: string | null;
  closest_known_codes: string[];
  suggested_canonical_code: string | null;
  alias_matched: boolean;
}

export interface ExplainErrorListResult {
  error_codes: string[];
  error_code_aliases: Record<string, string>;
}

export interface Finding {
  code: string;
  severity: string;
  family: string;
  message: string;
  path_hint: string;
  details: Record<string, unknown>;
  suggestion: string;
  evidence_level: string;
}

export interface NormalizedArtifactReference {
  path: string;
  artifact_family: string;
  is_pricing_procedure: boolean;
  candidate_adjacent_family: string | null;
  [key: string]: unknown;
}

export interface NormalizedProcedureParameter {
  param_index: number;
  name: string | null;
  type: string | null;
  input: string | null;
  output: string | null;
  value: string | null;
}

export interface NormalizedProcedureStep {
  xml_index: number;
  name: string | null;
  label: string | null;
  description: string | null;
  actionType: string | null;
  stepType: string | null;
  sequenceNumber: string | null;
  parentStep: string | null;
  resultIncluded: string | null;
  parameters: NormalizedProcedureParameter[];
  [key: string]: unknown;
}

export interface NormalizedProcedureVersion {
  fullName: string | null;
  status: string | null;
  rank: string | null;
  startDate: string | null;
  label: string | null;
  description: string | null;
  processType: string | null;
  interfaceSourceType: string | null;
  decimalScale: string | null;
  steps: NormalizedProcedureStep[];
  [key: string]: unknown;
}

export interface NormalizedProcedureArtifact extends NormalizedArtifactReference {
  root_tag: string;
  label: string[];
  context_definitions: string[];
  interface_source_type: string[];
  process_types: string[];
  versions: NormalizedProcedureVersion[];
  [key: string]: unknown;
}

export interface NormalizedContextAttributeEntry {
  attribute_title: string;
  display_name: string | null;
  data_type: string | null;
  context_tags: string[];
}

export interface NormalizedContextTagEntry {
  attribute_title: string | null;
  display_name: string | null;
  data_type: string | null;
}

export interface NormalizedContextHydrationDetail {
  object_name: string | null;
  query_attribute: string | null;
  inherited_from: string | null;
}

export interface NormalizedContextAttributeMapping {
  context_attribute: string | null;
  context_input_attribute_name: string | null;
  context_node: string | null;
  context_node_object: string | null;
  inherited_from: string | null;
  hydration_details: NormalizedContextHydrationDetail[];
}

export interface NormalizedContextQueryAttributeEntry {
  context_attribute: string | null;
  context_input_attribute_name: string | null;
  context_node: string | null;
  object_name: string | null;
  query_attribute: string | null;
  inherited_from: string | null;
}

export interface NormalizedContextNodeMatch {
  context_node: string | null;
  object_name: string | null;
  inherited_from: string | null;
}

export interface NormalizedContextDefinition {
  path: string;
  attributes: Record<string, NormalizedContextAttributeEntry[]>;
  tags: Record<string, NormalizedContextTagEntry[]>;
  query_attributes: Record<string, NormalizedContextQueryAttributeEntry[]>;
  attribute_mappings: NormalizedContextAttributeMapping[];
  attribute_mapping_index: Record<string, NormalizedContextAttributeMapping[]>;
  tag_mapping_index: Record<string, NormalizedContextAttributeMapping[]>;
  context_nodes: NormalizedContextNodeMatch[];
  [key: string]: unknown;
}
