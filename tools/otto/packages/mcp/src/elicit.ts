import type { Server } from "@modelcontextprotocol/sdk/server/index.js";
import type { PrimitiveSchemaDefinition } from "@modelcontextprotocol/sdk/types.js";
import {
  QUESTIONS,
  STORY_GATE_LABELS,
  EPIC_GATE_LABELS,
  SUBTASK_GATE_LABELS,
  resolveExistingAnswer,
  defaultStatusMapFor,
  existingStatusMap,
  fetchJiraStatuses,
  type Question,
  type InterviewAnswers,
  type OttoConfig,
  type StatusMapTriple,
  type JiraStatus,
} from "@otto/core";

/**
 * The `/init` interview, run as MCP elicitation forms.
 *
 * This is the Claude Code counterpart to the VS Code extension's showInputBox /
 * showQuickPick sequence in packages/vscode/src/interview.ts. Both walk the same
 * `QUESTIONS` list from core and hand the answers to the same `buildOttoConfig`;
 * only the widget layer differs. The point is that the *server* asks and the user
 * answers directly — the model neither conducts the interview nor sees a chance to
 * paraphrase a question, invent a default, or skip a field.
 *
 * Elicitation is optional in the MCP spec, so every caller must check
 * `supportsElicitation()` first and fall back to the conversational prompt.
 */

/** A cancelled or declined form. Distinct from an error — the user just backed out. */
export const ABORTED = Symbol("aborted");
export type Aborted = typeof ABORTED;

export function supportsElicitation(server: Server): boolean {
  return Boolean(server.getClientCapabilities()?.elicitation);
}

// ── Question → elicitation schema ────────────────────────────────────────────

/** The MCP spec restricts elicitation forms to a flat object of primitives — string,
 *  number, boolean, or a single/multi-select enum. No nesting. */
type PrimitiveSchema = PrimitiveSchemaDefinition;

function toSchema(q: Question, def: unknown): PrimitiveSchema {
  // Assembled loosely then asserted: the SDK models each variant as a distinct object
  // type, so a switch that builds them by spread can't narrow without a cast.
  const common = {
    title: q.label,
    ...(q.hint ? { description: q.hint } : {}),
  };

  const build = (o: Record<string, unknown>): PrimitiveSchema => o as unknown as PrimitiveSchema;

  switch (q.type) {
    case "number":
      return build({
        ...common,
        type: "integer",
        ...(q.min !== undefined ? { minimum: q.min } : {}),
        ...(q.max !== undefined ? { maximum: q.max } : {}),
        ...(typeof def === "number" ? { default: def } : {}),
      });

    case "confirm":
      return build({ ...common, type: "boolean", ...(typeof def === "boolean" ? { default: def } : {}) });

    case "select":
      return build({
        ...common,
        type: "string",
        oneOf: (q.options ?? []).map((o) => ({ const: String(o.value), title: o.label })),
        ...(def !== undefined ? { default: String(def) } : {}),
      });

    case "multiselect":
      return build({
        ...common,
        type: "array",
        minItems: 1,
        items: { anyOf: (q.options ?? []).map((o) => ({ const: String(o.value), title: o.label })) },
        ...(Array.isArray(def) ? { default: def.map(String) } : {}),
      });

    default:
      return build({
        ...common,
        type: "string",
        ...(q.format ? { format: q.format } : {}),
        ...(typeof def === "string" ? { default: def } : {}),
      });
  }
}

// ── Low-level form helper ────────────────────────────────────────────────────

async function askForm(
  server: Server,
  message: string,
  properties: Record<string, PrimitiveSchema>,
  required: string[]
): Promise<Record<string, unknown> | Aborted> {
  if (Object.keys(properties).length === 0) return {};

  const result = await server.elicitInput({
    message,
    requestedSchema: { type: "object", properties, required },
  });

  if (result.action !== "accept" || !result.content) return ABORTED;
  return result.content as Record<string, unknown>;
}

/**
 * Ask a group of questions as one form, re-prompting if core's `validate` rejects
 * anything. Bounded at three attempts so a client that keeps returning the same bad
 * value can't spin here forever.
 */
async function askQuestions(
  server: Server,
  message: string,
  questions: Question[],
  answers: Partial<InterviewAnswers>,
  existing?: Partial<OttoConfig>
): Promise<Aborted | void> {
  const applicable = questions.filter((q) => !q.when || q.when(answers));
  if (applicable.length === 0) return;

  let prompt = message;

  for (let attempt = 0; attempt < 3; attempt++) {
    const properties: Record<string, PrimitiveSchema> = {};
    for (const q of applicable) {
      const current = (answers as Record<string, unknown>)[q.id];
      properties[q.id] = toSchema(q, current ?? resolveExistingAnswer(q.id, existing) ?? q.default);
    }

    const content = await askForm(server, prompt, properties, applicable.map((q) => q.id));
    if (content === ABORTED) return ABORTED;

    for (const q of applicable) {
      const raw = content[q.id];
      (answers as Record<string, unknown>)[q.id] = q.type === "number" ? Number(raw) : raw;
    }

    const errors = applicable
      .map((q) => {
        const v = (answers as Record<string, unknown>)[q.id];
        const r = q.validate?.(v as never, answers);
        return r === undefined || r === true ? null : `${q.label}: ${r}`;
      })
      .filter(Boolean);

    if (errors.length === 0) return;
    prompt = `${message}\n\nPlease correct:\n${errors.map((e) => `• ${e}`).join("\n")}`;
  }

  return ABORTED;
}

// ── The interview ────────────────────────────────────────────────────────────

/**
 * Which questions share a form. Grouping is explicit rather than derived from
 * `section` because the PM-tool questions are conditional on `pmTool`, which is
 * itself answered in the first group — they can't be in the same form.
 */
const FORM_GROUPS: { message: string; ids: string[] }[] = [
  {
    message: "Slalom Otto setup — project",
    ids: ["projectName", "pmTool"],
  },
  {
    message: "Slalom Otto setup — where work items live",
    ids: ["jiraKey", "jiraSite", "jiraEmail", "adoOrganization", "adoProject", "localKeyPrefix"],
  },
  {
    message: "Slalom Otto setup — delivery",
    ids: ["phases", "sprintLengthWeeks", "estimationApproach", "orgSandbox", "apexCoverageThreshold"],
  },
];

function byId(ids: string[]): Question[] {
  return ids.map((id) => QUESTIONS.find((q) => q.id === id)).filter((q): q is Question => Boolean(q));
}

/** Questions core has gained that no group claims — asked last rather than dropped. */
function ungrouped(): Question[] {
  const claimed = new Set(FORM_GROUPS.flatMap((g) => g.ids));
  return QUESTIONS.filter((q) => !claimed.has(q.id));
}

export async function runElicitedInterview(
  server: Server,
  existing?: Partial<OttoConfig>
): Promise<InterviewAnswers | Aborted> {
  const answers: Partial<InterviewAnswers> = {};

  for (const group of FORM_GROUPS) {
    if ((await askQuestions(server, group.message, byId(group.ids), answers, existing)) === ABORTED) {
      return ABORTED;
    }
  }

  const rest = ungrouped();
  if (rest.length && (await askQuestions(server, "Slalom Otto setup — other settings", rest, answers, existing)) === ABORTED) {
    return ABORTED;
  }

  return answers as InterviewAnswers;
}

// ── Status mapping ───────────────────────────────────────────────────────────

const STORY_KEYS   = Object.keys(STORY_GATE_LABELS)   as (keyof StatusMapTriple["story"])[];
const EPIC_KEYS    = Object.keys(EPIC_GATE_LABELS)    as (keyof StatusMapTriple["epic"])[];
const SUBTASK_KEYS = Object.keys(SUBTASK_GATE_LABELS) as (keyof StatusMapTriple["subTask"])[];

/**
 * Map each SDLC gate onto a status name in the user's workflow.
 *
 * When a JIRA token is available the real workflow is fetched and each gate becomes a
 * dropdown of statuses that actually exist — the same thing the VS Code interview does,
 * and the reason a typo can't silently produce a config whose transitions all fail.
 */
export async function runElicitedStatusMap(
  server: Server,
  answers: InterviewAnswers,
  existing?: Partial<OttoConfig>
): Promise<StatusMapTriple | Aborted> {
  const defaults = existingStatusMap(existing) ?? defaultStatusMapFor(answers.pmTool);
  const toolName = answers.pmTool === "ADO" ? "Azure DevOps" : "JIRA";

  const fetched = await tryFetchJiraStatuses(answers);

  const choice = await askForm(
    server,
    `${toolName} workflow — how should SDLC stages map to your statuses?`,
    {
      mode: {
        type: "string",
        title: "Status mapping",
        description: fetched
          ? "Statuses were read from your project — you can pick each one from a list."
          : `Defaults are ${answers.pmTool === "ADO" ? "the out-of-the-box Agile states" : "Slalom's standard names"}.`,
        oneOf: [
          { const: "defaults", title: "Use defaults" },
          { const: "customise", title: "Customise each stage" },
        ],
        default: "defaults",
      },
    },
    ["mode"]
  );

  if (choice === ABORTED) return ABORTED;
  if (choice.mode !== "customise") return defaults;

  const story = await askStatusGroup(server, "Story statuses", STORY_GATE_LABELS, STORY_KEYS, defaults.story, fetched?.story);
  if (story === ABORTED) return ABORTED;

  const epic = await askStatusGroup(server, "Epic statuses", EPIC_GATE_LABELS, EPIC_KEYS, defaults.epic, fetched?.epic);
  if (epic === ABORTED) return ABORTED;

  const subTask = await askStatusGroup(server, "Sub-task statuses", SUBTASK_GATE_LABELS, SUBTASK_KEYS, defaults.subTask, fetched?.subTask);
  if (subTask === ABORTED) return ABORTED;

  return { story, epic, subTask } as StatusMapTriple;
}

async function askStatusGroup<K extends string>(
  server: Server,
  title: string,
  labels: Record<K, string>,
  keys: K[],
  defaults: Record<K, string>,
  available?: JiraStatus[]
): Promise<Record<K, string> | Aborted> {
  const properties: Record<string, PrimitiveSchema> = {};

  for (const key of keys) {
    properties[key] = (available?.length
      ? {
          type: "string",
          title: labels[key],
          oneOf: available.map((s) => ({ const: s.name, title: s.name })),
          default: available.some((s) => s.name === defaults[key]) ? defaults[key] : available[0].name,
        }
      : { type: "string", title: labels[key], default: defaults[key] }) as unknown as PrimitiveSchema;
  }

  const content = await askForm(server, `Slalom Otto setup — ${title}`, properties, keys);
  if (content === ABORTED) return ABORTED;

  return Object.fromEntries(keys.map((k) => [k, String(content[k] ?? defaults[k])])) as Record<K, string>;
}

/** Best-effort JIRA workflow read. Any failure just means manual entry — never fatal. */
async function tryFetchJiraStatuses(
  answers: InterviewAnswers
): Promise<{ story: JiraStatus[]; epic: JiraStatus[]; subTask: JiraStatus[] } | null> {
  if (answers.pmTool !== "JIRA") return null;

  const apiToken = process.env.ATLASSIAN_TOKEN;
  if (!apiToken) return null;

  try {
    const result = await fetchJiraStatuses(answers.jiraSite, answers.jiraKey, {
      email: answers.jiraEmail,
      apiToken,
    });
    if (!result.success) return null;

    const story = result.byType["story"] ?? [];
    return {
      story,
      epic:    result.byType["epic"]?.length    ? result.byType["epic"]    : story,
      subTask: result.byType["subTask"]?.length ? result.byType["subTask"] : story,
    };
  } catch {
    return null;
  }
}
