import type { OttoConfig, Phase, EstimationApproach, StoryStatusMap, EpicStatusMap, SubTaskStatusMap, DeliverableTarget } from "./schema.js";
import { DEFAULT_STANDARDS } from "./schema.js";

export type QuestionType =
  | "text"
  | "number"
  | "select"
  | "multiselect"
  | "confirm";

export interface SelectOption<T = string> {
  label: string;
  value: T;
}

export interface Question<T = unknown> {
  id: string;
  section: string;
  label: string;
  type: QuestionType;
  default?: T;
  hint?: string;
  options?: SelectOption<T>[];
  validate?: (value: T, answers: Partial<InterviewAnswers>) => string | true;
  when?: (answers: Partial<InterviewAnswers>) => boolean;
  /** Numeric bounds, declared so form-based front ends can enforce them in the widget
   *  rather than only catching a bad value in `validate` after the fact. */
  min?: number;
  max?: number;
  /** Text sub-type, for front ends whose input widgets understand one. */
  format?: "email" | "uri";
  /** A blank answer is a valid answer. Form-based front ends (MCP elicitation) must
   *  leave these out of the form's `required` list, otherwise the client rejects or
   *  re-prompts on the empty value the question is designed to accept. */
  optional?: boolean;
}

/**
 * Answer type for the design publishing target. `"default"` is an explicit sentinel
 * meaning *"don't write a target, let the engine resolve one per PM tool"* — it is
 * deliberately not the empty string, because form-based front ends render a select as
 * a `oneOf` of `const` values and an empty `const` is not reliably selectable.
 */
export type DeliverableTargetAnswer = DeliverableTarget | "default";

export interface InterviewAnswers {
  projectName: string;
  pmTool: "JIRA" | "ADO" | "LOCAL";
  // JIRA-specific (only set when pmTool === "JIRA")
  jiraKey: string;
  jiraSite: string;
  jiraEmail: string;
  // ADO-specific (only set when pmTool === "ADO")
  adoOrganization: string;
  adoProject: string;
  // LOCAL-specific (only set when pmTool === "LOCAL")
  localKeyPrefix: string;
  phases: Phase[];
  sprintLengthWeeks: number;
  estimationApproach: EstimationApproach;
  orgSandbox: string;
  apexCoverageThreshold: number;
  revenueCloudEnabled: boolean;
  // Design deliverable (only relevant when the design phase is in scope)
  designDeliverableTarget?: DeliverableTargetAnswer;
  designDeliverableSpaceKey?: string;
  designDeliverableWikiIdentifier?: string;
}

export const PHASE_OPTIONS: SelectOption<Phase>[] = [
  { label: "Discover", value: "discover" },
  { label: "Refine", value: "refine" },
  { label: "Design", value: "design" },
  { label: "Build", value: "build" },
  { label: "Test", value: "test" },
  { label: "Release", value: "release" },
];

export const ESTIMATION_OPTIONS: SelectOption<EstimationApproach>[] = [
  { label: "TA / TL assigns", value: "ta-assigns" },
  { label: "Team vote in sprint planning", value: "team-vote" },
  { label: "Both options available per story", value: "both" },
];

// Publishing target for the epic-level synthesis design. "default" = use the
// PM-tool default (JIRA→Confluence, ADO→wiki, LOCAL→local), which config-builder
// leaves unset so the engine resolves it. The per-story design comment is always
// posted regardless of this choice.
export const DESIGN_DELIVERABLE_TARGET_OPTIONS: SelectOption<DeliverableTargetAnswer>[] = [
  { label: "Use PM-tool default (recommended)", value: "default" },
  { label: "Confluence page", value: "confluence" },
  { label: "Azure DevOps wiki page", value: "wiki" },
  { label: "Local markdown file only", value: "local" },
  { label: "PM-tool comment only (no synthesis page)", value: "pm-comment" },
];

const designInScope = (a: Partial<InterviewAnswers>): boolean =>
  Array.isArray(a.phases) ? a.phases.includes("design") : true;

export const QUESTIONS: Question[] = [
  // ── Project ──────────────────────────────────────────────────────────────
  {
    id: "projectName",
    section: "Project",
    label: "Client / project name",
    type: "text",
    validate: (v) => (String(v).trim().length > 0 ? true : "Required"),
  },
  {
    id: "pmTool",
    section: "Project",
    label: "Where do work items / tickets live?",
    type: "select",
    options: [
      { label: "JIRA (Atlassian)", value: "JIRA" },
      { label: "Azure DevOps", value: "ADO" },
      { label: "Local files only (no JIRA / Azure DevOps)", value: "LOCAL" },
    ],
    default: "JIRA",
  },
  {
    id: "jiraKey",
    section: "Project",
    label: "JIRA project key",
    hint: "e.g. ACME",
    type: "text",
    when: (a) => (a as Partial<InterviewAnswers>).pmTool === "JIRA",
    validate: (v) =>
      /^[A-Z][A-Z0-9]+$/.test(String(v).trim().toUpperCase())
        ? true
        : "Must be uppercase letters and numbers (e.g. ACME)",
  },
  {
    id: "jiraSite",
    section: "Project",
    label: "JIRA site URL",
    hint: "e.g. https://acme.atlassian.net",
    type: "text",
    format: "uri",
    when: (a) => (a as Partial<InterviewAnswers>).pmTool === "JIRA",
    validate: (v) => {
      try {
        new URL(String(v));
        return true;
      } catch {
        return "Must be a valid URL";
      }
    },
  },
  {
    id: "jiraEmail",
    section: "Project",
    label: "Atlassian account email",
    type: "text",
    format: "email",
    when: (a) => (a as Partial<InterviewAnswers>).pmTool === "JIRA",
    validate: (v) =>
      /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(v).trim())
        ? true
        : "Must be a valid email address",
  },
  {
    id: "adoOrganization",
    section: "Project",
    label: "Azure DevOps org URL",
    hint: "e.g. https://dev.azure.com/your-org",
    type: "text",
    format: "uri",
    when: (a) => (a as Partial<InterviewAnswers>).pmTool === "ADO",
    validate: (v) => {
      try {
        new URL(String(v));
        return true;
      } catch {
        return "Must be a valid URL (e.g. https://dev.azure.com/your-org)";
      }
    },
  },
  {
    id: "adoProject",
    section: "Project",
    label: "Azure DevOps project name",
    hint: "e.g. MyProject",
    type: "text",
    when: (a) => (a as Partial<InterviewAnswers>).pmTool === "ADO",
    validate: (v) => (String(v).trim().length > 0 ? true : "Required"),
  },
  {
    id: "localKeyPrefix",
    section: "Project",
    label: "Local work-item key prefix",
    hint: "e.g. LOCAL → LOCAL-001; used to name backlog story folders",
    type: "text",
    default: "LOCAL",
    when: (a) => (a as Partial<InterviewAnswers>).pmTool === "LOCAL",
    validate: (v) =>
      /^[A-Z][A-Z0-9]+$/.test(String(v).trim().toUpperCase())
        ? true
        : "Must be uppercase letters and numbers (e.g. LOCAL)",
  },

  // ── SDLC Phases ──────────────────────────────────────────────────────────
  {
    id: "phases",
    section: "SDLC Phases",
    label: "Which phases are in scope?",
    type: "multiselect",
    options: PHASE_OPTIONS,
    default: ["discover", "refine", "design", "build", "test"] as Phase[],
    validate: (v) =>
      Array.isArray(v) && v.length > 0 ? true : "Select at least one phase",
  },

  // ── Team ─────────────────────────────────────────────────────────────────
  {
    id: "sprintLengthWeeks",
    section: "Team",
    label: "Sprint length (weeks)",
    type: "number",
    default: 2,
    min: 1,
    max: 4,
    validate: (v) =>
      Number(v) >= 1 && Number(v) <= 4 ? true : "Must be between 1 and 4",
  },
  {
    id: "estimationApproach",
    section: "Team",
    label: "Estimation approach",
    type: "select",
    options: ESTIMATION_OPTIONS,
    default: "ta-assigns" as EstimationApproach,
  },

  // ── Salesforce ────────────────────────────────────────────────────────────
  {
    id: "orgSandbox",
    section: "Salesforce",
    label: "Sandbox org alias",
    hint: "The org agents will deploy to and validate against",
    type: "text",
    default: "sandbox",
    validate: (v) => (String(v).trim().length > 0 ? true : "Required"),
  },

  // ── Standards ─────────────────────────────────────────────────────────────
  {
    id: "apexCoverageThreshold",
    section: "Standards",
    label: "Apex test coverage threshold (%)",
    type: "number",
    default: DEFAULT_STANDARDS.apexCoverageThreshold,
    min: 0,
    max: 100,
    validate: (v) =>
      Number(v) >= 0 && Number(v) <= 100 ? true : "Must be between 0 and 100",
  },

  // ── Revenue Cloud (RCA) ────────────────────────────────────────────────────
  {
    id: "revenueCloudEnabled",
    section: "Standards",
    label: "Enable Revenue Cloud Advanced (RCA) skills & tooling?",
    hint: "Turn on for pricing procedures, quoting runtime, DocGen, context definitions and ARM approvals. Leave off for non-RCA projects.",
    type: "confirm",
    default: false,
  },

  // ── Design deliverable ─────────────────────────────────────────────────────
  {
    id: "designDeliverableTarget",
    section: "Design",
    label: "Where should the epic-level solution design be published?",
    hint: "The per-story design comment is always posted; this controls the additional cross-story synthesis page.",
    type: "select",
    options: DESIGN_DELIVERABLE_TARGET_OPTIONS,
    default: "default",
    when: (a) => designInScope(a as Partial<InterviewAnswers>),
  },
  {
    id: "designDeliverableSpaceKey",
    section: "Design",
    label: "Confluence space key for design pages (optional)",
    hint: "e.g. SOLDES — stored so the agent stops asking each run. Leave blank to be prompted the first time.",
    type: "text",
    default: "",
    optional: true,
    when: (a) => {
      const ans = a as Partial<InterviewAnswers>;
      if (!designInScope(ans)) return false;
      const t = ans.designDeliverableTarget;
      return t === "confluence" || ((t === "default" || t === undefined) && ans.pmTool === "JIRA");
    },
  },
  {
    id: "designDeliverableWikiIdentifier",
    section: "Design",
    label: "Azure DevOps wiki identifier for design pages (optional)",
    hint: "e.g. AcmeProj.wiki — stored so the agent stops asking each run. Leave blank to be prompted the first time.",
    type: "text",
    default: "",
    optional: true,
    when: (a) => {
      const ans = a as Partial<InterviewAnswers>;
      if (!designInScope(ans)) return false;
      const t = ans.designDeliverableTarget;
      return t === "wiki" || ((t === "default" || t === undefined) && ans.pmTool === "ADO");
    },
  },
];

export const STORY_GATE_LABELS: Record<
  keyof StoryStatusMap,
  string
> = {
  backlog: "Story created / not started",
  refineInProgress: "Refinement in progress",
  readyForDesign: "Refinement complete (gate)",
  designInProgress: "Design in progress",
  readyForBuild: "Design complete / Ready for Build (gate)",
  inDevelopment: "Build in progress",
  readyForTest: "Build complete / Ready for Test (gate)",
  done: "Done",
};

export const EPIC_GATE_LABELS: Record<
  keyof EpicStatusMap,
  string
> = {
  notStarted: "Epic not started",
  inProgress: "Epic in progress",
  done: "Epic done",
};

export const SUBTASK_GATE_LABELS: Record<
  keyof SubTaskStatusMap,
  string
> = {
  todo: "Sub-task not started",
  inDevelopment: "Sub-task in progress",
  readyForTest: "Sub-task ready for review",
  done: "Sub-task done",
};
