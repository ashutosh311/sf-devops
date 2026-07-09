import * as path from "node:path";
import * as fs from "node:fs";
import ExcelJS from "exceljs";

// ── Backlog data schema (mirrors devops/scripts/excel/create_backlog.py) ───────

export interface BacklogEpic {
  id?: string;
  name?: string;
  narrative_goal?: string;
  business_outcome?: string;
  solution_notes?: string;
  requirement_ids?: string;
  pain_points?: string;
  stakeholder_groups?: string;
  priority?: string;
  status?: string;
  demo_slice?: string;
  jira_key?: string;
  disregarded?: string;
}

export interface BacklogFeature {
  id?: string;
  epic_id?: string;
  epic_name?: string;
  name?: string;
  description?: string;
  system_components?: string;
  dependencies?: string;
  priority?: string;
  complexity?: string;
  status?: string;
  implementation_boundary?: string;
  jira_key?: string;
  disregarded?: string;
}

export interface BacklogStory {
  id?: string;
  epic_id?: string;
  epic_name?: string;
  feature_id?: string;
  feature_name?: string;
  user_story?: string;
  acceptance_criteria?: string;
  functional_requirements?: string;
  solution_notes?: string;
  use_case_labels?: string;
  size?: string;
  status?: string;
  jira_key?: string;
  disregarded?: string;
}

export interface BacklogOpenQuestion {
  id?: string;
  question?: string;
  owner?: string;
  status?: string;
  priority?: string;
  source?: string;
}

export interface BacklogData {
  project?: string;
  epics?: BacklogEpic[];
  features?: BacklogFeature[];
  stories?: BacklogStory[];
  open_questions?: BacklogOpenQuestion[];
}

// ── Styling constants ──────────────────────────────────────────────────────────

const HEADER_FILL = "FF1F3864"; // dark navy (ARGB)
const ALT_ROW_FILL = "FFEEF2F7"; // light blue-grey
const DISREGARDED_FILL = "FFE0E0E0"; // muted grey for disregarded rows
const TITLE_COLOR = "FF1F3864";
const SUBTITLE_COLOR = "FF666666";
const BORDER_COLOR = "FFCCCCCC";

const thinBorder: Partial<ExcelJS.Borders> = {
  top: { style: "thin", color: { argb: BORDER_COLOR } },
  left: { style: "thin", color: { argb: BORDER_COLOR } },
  bottom: { style: "thin", color: { argb: BORDER_COLOR } },
  right: { style: "thin", color: { argb: BORDER_COLOR } },
};

function styleHeaderRow(ws: ExcelJS.Worksheet, headers: string[], widths: number[]): void {
  ws.columns = headers.map((_, i) => ({ width: widths[i] ?? 20 }));
  const row = ws.getRow(1);
  headers.forEach((text, i) => {
    const cell = row.getCell(i + 1);
    cell.value = text;
    cell.font = { bold: true, color: { argb: "FFFFFFFF" }, size: 10 };
    cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: HEADER_FILL } };
    cell.border = thinBorder;
    cell.alignment = { wrapText: true, vertical: "middle" };
  });
  row.height = 20;
  ws.views = [{ state: "frozen", xSplit: 1, ySplit: 1 }];
}

function addDataRow(ws: ExcelJS.Worksheet, values: (string | undefined)[], rowIndex: number, disregarded = false): void {
  const row = ws.getRow(rowIndex);
  const shade = rowIndex % 2 === 0;
  values.forEach((val, i) => {
    const cell = row.getCell(i + 1);
    cell.value = val ?? "";
    cell.border = thinBorder;
    cell.alignment = { wrapText: true, vertical: "top" };
    if (disregarded) {
      cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: DISREGARDED_FILL } };
      cell.font = { color: { argb: "FF999999" }, italic: true };
    } else if (shade) {
      cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: ALT_ROW_FILL } };
    }
  });
}

// ── Sheet builders ──────────────────────────────────────────────────────────────

function buildOverview(wb: ExcelJS.Workbook, projectName: string, data: BacklogData): void {
  const ws = wb.addWorksheet("Overview");
  ws.getColumn(1).width = 30;
  ws.getColumn(2).width = 60;

  ws.getCell("A1").value = "Backlog Tracker";
  ws.getCell("A1").font = { bold: true, size: 14, color: { argb: TITLE_COLOR } };

  ws.getCell("A2").value = `Project: ${projectName}`;
  ws.getCell("A2").font = { italic: true, size: 10, color: { argb: SUBTITLE_COLOR } };

  ws.getCell("A3").value = `Generated: ${new Date().toISOString().slice(0, 10)}`;
  ws.getCell("A3").font = { italic: true, size: 10, color: { argb: SUBTITLE_COLOR } };

  ws.getCell("A5").value = "Contents";
  ws.getCell("A5").font = { bold: true, size: 11 };

  const summary: [string, number][] = [
    ["Epics", (data.epics ?? []).length],
    ["Features", (data.features ?? []).length],
    ["User Stories", (data.stories ?? []).length],
    ["Open Questions", (data.open_questions ?? []).length],
  ];
  summary.forEach(([label, count], i) => {
    const r = 6 + i;
    ws.getCell(`A${r}`).value = label;
    ws.getCell(`A${r}`).font = { bold: true };
    ws.getCell(`B${r}`).value = count;
  });

  ws.getCell("A12").value = "Status";
  ws.getCell("A12").font = { bold: true, size: 11 };
  ws.getCell("A13").value = "Pre-push (not yet in JIRA)";
  ws.getCell("A13").font = { italic: true, size: 10, color: { argb: SUBTITLE_COLOR } };
}

function buildEpics(wb: ExcelJS.Workbook, epics: BacklogEpic[]): void {
  const ws = wb.addWorksheet("Epics");
  const headers = [
    "ID", "Epic Name", "Narrative Goal", "Business Outcome",
    "Solution Notes", "Requirement IDs", "Pain Points Addressed",
    "Stakeholder Groups", "Priority", "Status", "Demo Narrative Slice", "JIRA Key", "Disregarded",
  ];
  styleHeaderRow(ws, headers, [12, 30, 40, 40, 40, 20, 20, 25, 8, 12, 30, 12, 12]);
  epics.forEach((e, i) => {
    addDataRow(ws, [
      e.id, e.name, e.narrative_goal, e.business_outcome, e.solution_notes,
      e.requirement_ids, e.pain_points, e.stakeholder_groups, e.priority,
      e.status ?? "Draft", e.demo_slice, e.jira_key, e.disregarded,
    ], i + 2, (e.disregarded || "").toUpperCase() === "Y");
  });
}

function buildFeatures(wb: ExcelJS.Workbook, features: BacklogFeature[]): void {
  const ws = wb.addWorksheet("Features");
  const headers = [
    "ID", "Epic ID", "Epic Name", "Feature Name", "Description",
    "System Components", "Dependencies", "Priority", "Complexity",
    "Status", "Implementation Boundary", "JIRA Key", "Disregarded",
  ];
  styleHeaderRow(ws, headers, [12, 12, 25, 30, 45, 25, 20, 8, 10, 12, 35, 12, 12]);
  features.forEach((f, i) => {
    addDataRow(ws, [
      f.id, f.epic_id, f.epic_name, f.name, f.description, f.system_components,
      f.dependencies, f.priority, f.complexity, f.status ?? "Draft",
      f.implementation_boundary, f.jira_key, f.disregarded,
    ], i + 2, (f.disregarded || "").toUpperCase() === "Y");
  });
}

function buildStories(wb: ExcelJS.Workbook, stories: BacklogStory[]): void {
  const ws = wb.addWorksheet("User Stories");
  const headers = [
    "Story ID", "Epic ID", "Epic Name", "Feature ID", "Feature Name",
    "User Story", "Acceptance Criteria", "Functional Requirements",
    "Solution Notes", "Use Case Labels", "Size", "Status", "JIRA Key", "Disregarded",
  ];
  styleHeaderRow(ws, headers, [12, 12, 25, 12, 25, 50, 50, 20, 30, 20, 8, 12, 12, 12]);
  stories.forEach((s, i) => {
    addDataRow(ws, [
      s.id, s.epic_id, s.epic_name, s.feature_id, s.feature_name, s.user_story,
      s.acceptance_criteria, s.functional_requirements, s.solution_notes,
      s.use_case_labels, s.size, s.status ?? "Draft", s.jira_key, s.disregarded,
    ], i + 2, (s.disregarded || "").toUpperCase() === "Y");
  });
}

function buildOpenQuestions(wb: ExcelJS.Workbook, questions: BacklogOpenQuestion[]): void {
  const ws = wb.addWorksheet("Open Questions");
  const headers = ["ID", "Question", "Owner", "Status", "Priority", "Source"];
  styleHeaderRow(ws, headers, [10, 60, 25, 12, 8, 30]);
  questions.forEach((q, i) => {
    addDataRow(ws, [
      q.id, q.question, q.owner, q.status ?? "Open", q.priority, q.source,
    ], i + 2);
  });
}

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Writes a Backlog Tracker workbook to `outputPath`. Creates parent dirs as needed.
 * Returns a short summary string of what was written.
 */
export async function writeBacklogWorkbook(outputPath: string, data: BacklogData): Promise<string> {
  const projectName = data.project || "Discovery Project";

  const wb = new ExcelJS.Workbook();
  wb.creator = "Slalom SDLC";
  wb.created = new Date();

  buildOverview(wb, projectName, data);
  buildEpics(wb, data.epics ?? []);
  buildFeatures(wb, data.features ?? []);
  buildStories(wb, data.stories ?? []);
  buildOpenQuestions(wb, data.open_questions ?? []);

  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  await wb.xlsx.writeFile(outputPath);

  return (
    `${(data.epics ?? []).length} epics, ` +
    `${(data.features ?? []).length} features, ` +
    `${(data.stories ?? []).length} stories, ` +
    `${(data.open_questions ?? []).length} open questions`
  );
}

// ── Reading a workbook back (round-trip: user edits xlsx → sync md) ──────────────

function cellText(row: ExcelJS.Row, col: number): string {
  const v = row.getCell(col).value;
  if (v === null || v === undefined) return "";
  if (typeof v === "object") {
    // Handle rich text / hyperlink / formula result objects.
    const rich = v as { text?: string; result?: unknown; richText?: Array<{ text: string }> };
    if (typeof rich.text === "string") return rich.text.trim();
    if (Array.isArray(rich.richText)) return rich.richText.map((r) => r.text).join("").trim();
    if (rich.result !== undefined && rich.result !== null) return String(rich.result).trim();
    return "";
  }
  return String(v).trim();
}

function rowIsEmpty(row: ExcelJS.Row, cols: number): boolean {
  for (let c = 1; c <= cols; c++) {
    if (cellText(row, c)) return false;
  }
  return true;
}

/**
 * Parse a Backlog Tracker workbook back into the schema, keyed by ID column.
 * Used to sync the markdown + manifest after a user edits the spreadsheet.
 * Header order must match the writers above.
 */
export async function readBacklogWorkbook(inputPath: string): Promise<BacklogData> {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile(inputPath);

  const data: BacklogData = { epics: [], features: [], stories: [], open_questions: [] };

  const epicsWs = wb.getWorksheet("Epics");
  if (epicsWs) {
    epicsWs.eachRow((row, n) => {
      if (n === 1 || rowIsEmpty(row, 12)) return;
      data.epics!.push({
        id: cellText(row, 1), name: cellText(row, 2), narrative_goal: cellText(row, 3),
        business_outcome: cellText(row, 4), solution_notes: cellText(row, 5),
        requirement_ids: cellText(row, 6), pain_points: cellText(row, 7),
        stakeholder_groups: cellText(row, 8), priority: cellText(row, 9),
        status: cellText(row, 10), demo_slice: cellText(row, 11), jira_key: cellText(row, 12),
        disregarded: cellText(row, 13) || undefined,
      });
    });
  }

  const featuresWs = wb.getWorksheet("Features");
  if (featuresWs) {
    featuresWs.eachRow((row, n) => {
      if (n === 1 || rowIsEmpty(row, 12)) return;
      data.features!.push({
        id: cellText(row, 1), epic_id: cellText(row, 2), epic_name: cellText(row, 3),
        name: cellText(row, 4), description: cellText(row, 5), system_components: cellText(row, 6),
        dependencies: cellText(row, 7), priority: cellText(row, 8), complexity: cellText(row, 9),
        status: cellText(row, 10), implementation_boundary: cellText(row, 11), jira_key: cellText(row, 12),
        disregarded: cellText(row, 13) || undefined,
      });
    });
  }

  const storiesWs = wb.getWorksheet("User Stories");
  if (storiesWs) {
    storiesWs.eachRow((row, n) => {
      if (n === 1 || rowIsEmpty(row, 13)) return;
      data.stories!.push({
        id: cellText(row, 1), epic_id: cellText(row, 2), epic_name: cellText(row, 3),
        feature_id: cellText(row, 4), feature_name: cellText(row, 5), user_story: cellText(row, 6),
        acceptance_criteria: cellText(row, 7), functional_requirements: cellText(row, 8),
        solution_notes: cellText(row, 9), use_case_labels: cellText(row, 10), size: cellText(row, 11),
        status: cellText(row, 12), jira_key: cellText(row, 13),
        disregarded: cellText(row, 14) || undefined,
      });
    });
  }

  const oqWs = wb.getWorksheet("Open Questions");
  if (oqWs) {
    oqWs.eachRow((row, n) => {
      if (n === 1 || rowIsEmpty(row, 6)) return;
      data.open_questions!.push({
        id: cellText(row, 1), question: cellText(row, 2), owner: cellText(row, 3),
        status: cellText(row, 4), priority: cellText(row, 5), source: cellText(row, 6),
      });
    });
  }

  return data;
}
