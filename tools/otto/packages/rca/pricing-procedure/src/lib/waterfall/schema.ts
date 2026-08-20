export type WaterfallNodeKind = 'procedure_step' | 'context_tag' | 'formula' | 'object_field';
export type WaterfallEdgeKind = 'read' | 'write' | 'formula' | 'maps_to' | 'overwrites';
export type WaterfallFormulaConfidence = 'metadata_formula';
export type WaterfallScenarioSource = 'fixture_values' | 'runtime_waterfall';
export type WaterfallBarOperation = 'base' | 'increase' | 'decrease' | 'set' | 'overwrite' | 'final';
export type WaterfallValueSource = 'runtime_output' | 'persisted_line' | 'fixture_value' | 'calculated' | 'unresolved';

export interface WaterfallGraphNode {
  id: string;
  label: string;
  kind: WaterfallNodeKind;
  action_type?: string | null;
  order?: number | null;
  reads?: string[];
  writes?: string[];
  formula_refs?: string[];
}

export interface WaterfallGraphEdge {
  from: string;
  to: string;
  kind: WaterfallEdgeKind;
}

export interface WaterfallFormula {
  id: string;
  step_id: string;
  source: string;
  reads: string[];
  writes: string[];
  confidence: WaterfallFormulaConfidence;
}

export interface WaterfallContextMapping {
  context_tag: string;
  context_node: string | null;
  object_name: string | null;
  object_field: string | null;
}

export interface WaterfallModel {
  procedure: {
    file: string;
    version: string | null;
    active_version: string | null;
    focus_tag: string | null;
  };
  graph: {
    nodes: WaterfallGraphNode[];
    edges: WaterfallGraphEdge[];
  };
  formulas: WaterfallFormula[];
  context_mappings: WaterfallContextMapping[];
  limitations: string[];
}

export interface WaterfallBar {
  id: string;
  step_id: string | null;
  label: string;
  tag: string | null;
  operation: WaterfallBarOperation;
  input_value: number | null;
  delta: number | null;
  output_value: number | null;
  formula?: string;
  source: WaterfallValueSource;
}

export interface WaterfallOverwrite {
  tag: string;
  first_step_id: string | null;
  later_step_id: string | null;
  note: string;
}

export interface WaterfallLane {
  id: string;
  label: string;
  tracked_tag: string;
  bars: WaterfallBar[];
  source_tags: string[];
  excluded_raw_step_count: number;
  warnings: string[];
}

export interface WaterfallExample {
  scenario: {
    source: WaterfallScenarioSource;
    quote_id: string | null;
    line_id: string | null;
  };
  procedure: WaterfallModel['procedure'];
  bars: WaterfallBar[];
  lanes?: WaterfallLane[];
  overwrites: WaterfallOverwrite[];
  context_mappings: WaterfallContextMapping[];
  unresolved: string[];
}
