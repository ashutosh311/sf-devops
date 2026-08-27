import { test } from "node:test";
import assert from "node:assert/strict";
import {
  renderPrompt,
  renderAllPrompts,
  resolveAlmTool,
  resolveProjectKey,
  OttoConfigSchema,
  QUESTIONS,
} from "../dist/index.js";

const story = {
  backlog: "Backlog",
  refineInProgress: "In Refinement",
  readyForDesign: "Ready for Design",
  designInProgress: "In Design",
  readyForBuild: "Ready for Build",
  inDevelopment: "In Development",
  readyForTest: "Ready for Test",
  done: "Done",
};
const epic = { notStarted: "To Do", inProgress: "In Progress", done: "Done" };
const subTask = { todo: "To Do", inDevelopment: "In Progress", readyForTest: "In Review", done: "Done" };

const base = {
  version: "1",
  generatedAt: "2026-01-01",
  toolVersion: "1",
  phases: ["discover", "refine", "design", "build", "test", "release"],
  team: { sprintLengthWeeks: 2, estimationApproach: "ta-assigns" },
  salesforce: { orgs: { sandbox: "uat" } },
  standards: { apexCoverageThreshold: 85 },
  branching: "gitflow",
  paths: { artifacts: "artifacts", standards: "devops/standards", forceApp: "force-app" },
};

const jiraCfg = {
  ...base,
  project: { name: "Demo", jiraKey: "PROJ" },
  alm: { tool: "JIRA", projectKey: "PROJ", site: "https://x.atlassian.net", email: "a@b.com" },
  jira: { statusMap: { story, epic, subTask } },
};

const adoCfg = {
  ...base,
  project: { name: "Demo" },
  alm: { tool: "ADO", organization: "https://dev.azure.com/o", project: "P" },
  ado: { statusMap: { story, epic, subTask } },
};

const localCfg = {
  ...base,
  project: { name: "Demo" },
  alm: { tool: "LOCAL", keyPrefix: "LOCAL" },
  // deliberately no jira/ado block — engine falls back to DEFAULT_STATUS_MAP
};

const jiraFieldCfg = {
  ...jiraCfg,
  design: { deliverable: { storyField: "customfield_10123" } },
};

const adoFieldCfg = {
  ...adoCfg,
  design: { deliverable: { storyField: "Custom.SolutionDescription" } },
};

const PHASES = ["discover", "refine", "design", "build", "test", "release"];

test("all example configs validate against the schema", () => {
  assert.equal(OttoConfigSchema.safeParse(jiraCfg).success, true);
  assert.equal(OttoConfigSchema.safeParse(adoCfg).success, true);
  assert.equal(OttoConfigSchema.safeParse(localCfg).success, true);
});

test("resolve helpers pick the active PM tool", () => {
  assert.equal(resolveAlmTool(jiraCfg), "JIRA");
  assert.equal(resolveAlmTool(adoCfg), "ADO");
  assert.equal(resolveAlmTool(localCfg), "LOCAL");
  assert.equal(resolveAlmTool({ ...base, project: { name: "X" } }), "JIRA");
  assert.equal(resolveProjectKey(jiraCfg), "PROJ");
  assert.equal(resolveProjectKey(adoCfg), "P");
  assert.equal(resolveProjectKey(localCfg), "LOCAL");
});

for (const [name, cfg] of [["JIRA", jiraCfg], ["ADO", adoCfg], ["LOCAL", localCfg]]) {
  test(`${name}: every template renders with no unresolved handlebars or blank status cells`, () => {
    const all = renderAllPrompts(cfg);
    for (const phase of PHASES) {
      const out = all[phase];
      assert.ok(out, `${phase} produced no output`);
      const unresolved = out.match(/\{\{[^}]+\}\}/g) || [];
      assert.deepEqual(unresolved, [], `${name}/${phase} has unresolved handlebars: ${unresolved}`);
      const blankCells = out.match(/\| \*\*\*\* \|/g) || [];
      assert.equal(blankCells.length, 0, `${name}/${phase} has blank status cells`);
    }
  });
}

test("JIRA design uses ADF/Jira MCP calls, not ADO calls", () => {
  const out = renderPrompt("design", jiraCfg);
  assert.ok(out.includes("addCommentToJiraIssue"));
  assert.ok(!out.includes("add_work_item_comment"));
  assert.ok(out.includes("Ready for Build"));
});

test("ADO design uses Azure DevOps work-item calls, not Jira calls", () => {
  const out = renderPrompt("design", adoCfg);
  assert.ok(out.includes("add_work_item_comment"));
  assert.ok(out.includes("update_work_item"));
  assert.ok(!out.includes("addCommentToJiraIssue"));
  assert.ok(out.includes("Ready for Build"));
});

test("design template supports Local mode for both tools", () => {
  for (const cfg of [jiraCfg, adoCfg]) {
    const out = renderPrompt("design", cfg);
    assert.ok(out.includes("Local mode"), "design should describe Local mode");
    assert.ok(
      out.includes("04 - Backlog/stories/{EPIC-ID}/{STORY-KEY}/refinement-notes.md"),
      "design Local mode should read refinement notes from the backlog folder"
    );
  }
});

test("refine template supports Local mode for both tools", () => {
  for (const cfg of [jiraCfg, adoCfg]) {
    const out = renderPrompt("refine", cfg);
    assert.ok(out.includes("Local mode"), "refine should describe Local mode");
  }
});

test("misconfiguration (no status map) fails loudly", () => {
  const broken = { ...base, project: { name: "X" } };
  assert.throws(() => renderPrompt("design", broken), /status map/);
});

test("ADO status map falls back to nothing configured throws for ADO too", () => {
  const brokenAdo = { ...base, project: { name: "X" }, alm: { tool: "ADO", organization: "https://dev.azure.com/o", project: "P" } };
  assert.throws(() => renderPrompt("build", brokenAdo), /status map/);
});

test("LOCAL config renders without a status map (falls back to defaults, no throw)", () => {
  // A LOCAL project intentionally has no jira/ado block; the engine must supply
  // DEFAULT_STATUS_MAP so the guard never fires and stage labels still render.
  assert.doesNotThrow(() => renderPrompt("design", localCfg));
  const out = renderPrompt("design", localCfg);
  assert.ok(out.includes("Ready for Build"), "LOCAL should render default stage labels");
  assert.ok(out.includes("Local mode"), "LOCAL should describe Local mode");
});

test("design.deliverable.storyField switches design to field mode, not the full comment", () => {
  const out = renderPrompt("design", jiraFieldCfg);
  assert.ok(out.includes("customfield_10123"), "design should name the configured field");
  assert.ok(out.includes("Field mode"), "design should describe field mode");
  assert.ok(
    out.includes("flat build checklist") || out.includes("flat numbered list"),
    "design should describe the checklist deliverable, not the full comment"
  );
  assert.ok(
    !/post the full solution design as a comment/.test(out.replace(/\{\{[^}]*\}\}/g, "")),
    "design should not instruct posting the full comment when storyField is configured"
  );
  // §5c step 1 verification guard must be present so a misconfigured field key fails
  // loudly instead of silently falling back to comment mode.
  assert.ok(out.includes("isn't a valid, writable field"), "design should verify the field before writing to it");
});

test("design.deliverable.storyField keeps state-machine decisions (0a-sync, resume matrix) mode-aware", () => {
  const out = renderPrompt("design", jiraFieldCfg);
  assert.ok(
    out.includes("customfield_10123` field still empty") || out.includes("customfield_10123\\` field still empty"),
    "resume matrix should test field emptiness, not a hardcoded design comment, in field mode"
  );
  assert.ok(
    !out.includes("no design comment yet"),
    "field mode should not fall back to comment-only language in the resume matrix"
  );
});

test("build reads design.deliverable.storyField first, and still names the field as the design of record", () => {
  const out = renderPrompt("build", jiraFieldCfg);
  assert.ok(out.includes("customfield_10123"), "build should read the configured field");
  assert.ok(out.includes("getJiraIssue"), "build should fetch the field via getJiraIssue");
  assert.ok(
    !out.includes("Solution Design comment (step 1) remains the design of record"),
    "build should not contradict itself by calling the comment the design of record in field mode"
  );
});

test("build without storyField still uses the comment as the design of record (regression)", () => {
  const out = renderPrompt("build", jiraCfg);
  assert.ok(
    out.includes("Solution Design comment (step 1) remains the design of record"),
    "build should still name the comment as the design of record when storyField is not configured"
  );
});

test("ADO field mode stays platform-neutral — no JIRA vocabulary leaks into the ADO branch", () => {
  for (const phase of ["design", "build"]) {
    const out = renderPrompt(phase, adoFieldCfg);
    assert.ok(out.includes("Custom.SolutionDescription"), `${phase} should name the configured ADO field`);
    assert.ok(
      !out.includes("customfield_"),
      `${phase} must not tell an ADO project to use a JIRA customfield_ key`
    );
    assert.ok(
      !/getJiraIssue|editJiraIssue|getJiraIssueTypeMetaWithFields/.test(out),
      `${phase} must not instruct JIRA MCP calls on an ADO project`
    );
  }
});

test("field-mode verification guard is present and per-tool correct", () => {
  const jira = renderPrompt("design", jiraFieldCfg);
  assert.ok(
    jira.includes("getJiraIssueTypeMetaWithFields"),
    "JIRA should verify the field against the editable-field schema"
  );
  assert.ok(
    jira.includes("customfield_10123`), not the display name"),
    "JIRA guard should explain the internal-key requirement"
  );

  const ado = renderPrompt("design", adoFieldCfg);
  assert.ok(ado.includes("get_work_item"), "ADO should verify via get_work_item");
  assert.ok(
    ado.includes("reference name"),
    "ADO guard should explain the reference-name requirement, not JIRA's key format"
  );
  // An unset-but-valid ADO field is omitted from get_work_item, so the guard must not
  // treat absence as a failure — that would hard-stop correctly-configured projects.
  assert.ok(
    ado.includes("inconclusive and proceed"),
    "ADO guard must not treat an omitted (unpopulated) field as a config failure"
  );
});

test("field mode keeps a pre-existing design comment as a fallback source", () => {
  const out = renderPrompt("design", jiraFieldCfg);
  assert.ok(
    out.includes("or a design comment (from before"),
    "Review Mode should still consider a legacy comment when storyField is configured"
  );
});

test("no imperative literal mcp__ tool calls leak into rendered output (host-naming regression)", () => {
  // Illustrative mentions (e.g. `mcp__Salesforce_DX__get_username` as a Claude Code
  // example, or the `mcp__<server>__<tool>` pattern) are fine — this only guards
  // against reintroducing an imperative "Call `mcp__...`" instruction that hardcodes
  // one host's naming convention as the way to invoke a tool.
  const imperativeMcpCall = /\b(?:call|invoke)\s+`mcp__/i;
  for (const cfg of [jiraCfg, adoCfg, localCfg]) {
    const all = renderAllPrompts(cfg);
    for (const phase of PHASES) {
      const match = all[phase].match(imperativeMcpCall);
      assert.equal(match, null, `${phase} has an imperative literal mcp__ call: ${match}`);
    }
  }
});

test("/init offers JIRA, ADO and LOCAL, and gates credential questions correctly", () => {
  const pmTool = QUESTIONS.find((q) => q.id === "pmTool");
  assert.ok(pmTool, "pmTool question must exist");
  assert.deepEqual(
    pmTool.options.map((o) => o.value).sort(),
    ["ADO", "JIRA", "LOCAL"],
    "pmTool must offer all three sources"
  );

  const shows = (id, pmToolValue) => {
    const q = QUESTIONS.find((x) => x.id === id);
    return q.when ? q.when({ pmTool: pmToolValue }) : true;
  };
  // JIRA creds only for JIRA; ADO fields only for ADO; localKeyPrefix only for LOCAL
  for (const id of ["jiraKey", "jiraSite", "jiraEmail"]) {
    assert.equal(shows(id, "JIRA"), true, `${id} should show for JIRA`);
    assert.equal(shows(id, "ADO"), false, `${id} should be hidden for ADO`);
    assert.equal(shows(id, "LOCAL"), false, `${id} should be hidden for LOCAL`);
  }
  for (const id of ["adoOrganization", "adoProject"]) {
    assert.equal(shows(id, "ADO"), true, `${id} should show for ADO`);
    assert.equal(shows(id, "LOCAL"), false, `${id} should be hidden for LOCAL`);
  }
  assert.equal(shows("localKeyPrefix", "LOCAL"), true, "localKeyPrefix should show for LOCAL");
  assert.equal(shows("localKeyPrefix", "JIRA"), false, "localKeyPrefix should be hidden for JIRA");
});
