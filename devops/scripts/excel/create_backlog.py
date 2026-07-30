#!/usr/bin/env python3
"""
create_backlog.py — Create or update the Backlog Tracker Excel workbook.

Usage:
    python3 devops/scripts/excel/create_backlog.py \
        --output "artifacts/04 - Backlog/Backlog Tracker.xlsx" \
        --data '{"epics": [...], "features": [...], "stories": [...]}'

    Or pass --data-file path/to/data.json instead of --data.

Input JSON schema:
{
  "project": "Project name (optional)",
  "epics": [
    {
      "id": "EPIC-01",
      "name": "Epic Name",
      "narrative_goal": "...",
      "business_outcome": "...",
      "solution_notes": "...",
      "requirement_ids": "REQ-001, REQ-002",
      "pain_points": "PP-001, PP-003",
      "stakeholder_groups": "Sales, Operations",
      "priority": "P1",
      "status": "Draft",
      "demo_slice": "..."
    }
  ],
  "features": [
    {
      "id": "FEAT-01",
      "epic_id": "EPIC-01",
      "epic_name": "Epic Name",
      "name": "Feature Name",
      "description": "...",
      "system_components": "Salesforce, External API",
      "dependencies": "FEAT-02",
      "priority": "P1",
      "complexity": "M",
      "status": "Draft",
      "implementation_boundary": "..."
    }
  ],
  "stories": [
    {
      "id": "STORY-001",
      "epic_id": "EPIC-01",
      "epic_name": "Epic Name",
      "feature_id": "FEAT-01",
      "feature_name": "Feature Name",
      "user_story": "As a ..., I want ..., so that ...",
      "acceptance_criteria": "Given ... When ... Then ...",
      "functional_requirements": "REQ-001",
      "solution_notes": "...",
      "use_case_labels": "...",
      "size": "M",
      "status": "Draft"
    }
  ],
  "open_questions": [
    {
      "id": "OQ-001",
      "question": "...",
      "owner": "...",
      "status": "Open",
      "priority": "P1",
      "source": "Session 2026-07-01"
    }
  ]
}

Exit codes: 0 = success, 1 = error.
"""

import argparse
import json
import os
import sys
from datetime import date
from pathlib import Path

try:
    import openpyxl
    from openpyxl.styles import Font, PatternFill, Alignment, Border, Side
    from openpyxl.utils import get_column_letter
except ImportError:
    print("ERROR: openpyxl is required. Install with: pip install openpyxl", file=sys.stderr)
    sys.exit(1)


# ── Colours ──────────────────────────────────────────────────────────────────

HEADER_FILL   = PatternFill("solid", fgColor="1F3864")  # dark navy
HEADER_FONT   = Font(bold=True, color="FFFFFF", size=10)
ALT_ROW_FILL  = PatternFill("solid", fgColor="EEF2F7")  # light blue-grey
TITLE_FONT    = Font(bold=True, size=14, color="1F3864")
SUBTITLE_FONT = Font(italic=True, size=10, color="666666")
BORDER_SIDE   = Side(style="thin", color="CCCCCC")
CELL_BORDER   = Border(
    left=BORDER_SIDE, right=BORDER_SIDE,
    top=BORDER_SIDE,  bottom=BORDER_SIDE,
)


def _header_row(ws, headers, row=1):
    for col, text in enumerate(headers, start=1):
        cell = ws.cell(row=row, column=col, value=text)
        cell.font   = HEADER_FONT
        cell.fill   = HEADER_FILL
        cell.border = CELL_BORDER
        cell.alignment = Alignment(wrap_text=True, vertical="center")


def _data_row(ws, values, row):
    fill = ALT_ROW_FILL if row % 2 == 0 else None
    for col, val in enumerate(values, start=1):
        cell = ws.cell(row=row, column=col, value=val or "")
        cell.border = CELL_BORDER
        cell.alignment = Alignment(wrap_text=True, vertical="top")
        if fill:
            cell.fill = fill


def _set_col_widths(ws, widths):
    for i, w in enumerate(widths, start=1):
        ws.column_dimensions[get_column_letter(i)].width = w


def _freeze(ws, cell="B2"):
    ws.freeze_panes = cell


# ── Sheet builders ────────────────────────────────────────────────────────────

def _build_overview(wb, project_name, data):
    ws = wb.active
    ws.title = "Overview"

    ws.column_dimensions["A"].width = 30
    ws.column_dimensions["B"].width = 60

    ws["A1"] = "Backlog Tracker"
    ws["A1"].font = TITLE_FONT

    ws["A2"] = f"Project: {project_name}"
    ws["A2"].font = SUBTITLE_FONT

    ws["A3"] = f"Generated: {date.today().isoformat()}"
    ws["A3"].font = SUBTITLE_FONT

    ws["A5"] = "Contents"
    ws["A5"].font = Font(bold=True, size=11)

    summary = [
        ("Epics",          len(data.get("epics", []))),
        ("Features",       len(data.get("features", []))),
        ("User Stories",   len(data.get("stories", []))),
        ("Open Questions", len(data.get("open_questions", []))),
    ]
    for i, (label, count) in enumerate(summary, start=6):
        ws.cell(row=i, column=1, value=label).font = Font(bold=True)
        ws.cell(row=i, column=2, value=count)

    ws["A12"] = "Status"
    ws["A12"].font = Font(bold=True, size=11)
    ws["A13"] = "Pre-push (not yet in JIRA)"
    ws["A13"].font = SUBTITLE_FONT


def _build_epics(wb, epics):
    ws = wb.create_sheet("Epics")
    headers = [
        "ID", "Epic Name", "Narrative Goal", "Business Outcome",
        "Solution Notes", "Requirement IDs", "Pain Points Addressed",
        "Stakeholder Groups", "Priority", "Status", "Demo Narrative Slice",
    ]
    _header_row(ws, headers)
    _set_col_widths(ws, [12, 30, 40, 40, 40, 20, 20, 25, 8, 12, 30])
    ws.row_dimensions[1].height = 20
    _freeze(ws)

    for i, e in enumerate(epics, start=2):
        _data_row(ws, [
            e.get("id"), e.get("name"), e.get("narrative_goal"),
            e.get("business_outcome"), e.get("solution_notes"),
            e.get("requirement_ids"), e.get("pain_points"),
            e.get("stakeholder_groups"), e.get("priority"),
            e.get("status", "Draft"), e.get("demo_slice"),
        ], row=i)


def _build_features(wb, features):
    ws = wb.create_sheet("Features")
    headers = [
        "ID", "Epic ID", "Epic Name", "Feature Name", "Description",
        "System Components", "Dependencies", "Priority", "Complexity",
        "Status", "Implementation Boundary",
    ]
    _header_row(ws, headers)
    _set_col_widths(ws, [12, 12, 25, 30, 45, 25, 20, 8, 10, 12, 35])
    ws.row_dimensions[1].height = 20
    _freeze(ws)

    for i, f in enumerate(features, start=2):
        _data_row(ws, [
            f.get("id"), f.get("epic_id"), f.get("epic_name"),
            f.get("name"), f.get("description"), f.get("system_components"),
            f.get("dependencies"), f.get("priority"), f.get("complexity"),
            f.get("status", "Draft"), f.get("implementation_boundary"),
        ], row=i)


def _build_stories(wb, stories):
    ws = wb.create_sheet("User Stories")
    headers = [
        "Story ID", "Epic ID", "Epic Name", "Feature ID", "Feature Name",
        "User Story", "Acceptance Criteria", "Functional Requirements",
        "Solution Notes", "Use Case Labels", "Size", "Status",
    ]
    _header_row(ws, headers)
    _set_col_widths(ws, [12, 12, 25, 12, 25, 50, 50, 20, 30, 20, 8, 12])
    ws.row_dimensions[1].height = 20
    _freeze(ws)

    for i, s in enumerate(stories, start=2):
        _data_row(ws, [
            s.get("id"), s.get("epic_id"), s.get("epic_name"),
            s.get("feature_id"), s.get("feature_name"), s.get("user_story"),
            s.get("acceptance_criteria"), s.get("functional_requirements"),
            s.get("solution_notes"), s.get("use_case_labels"),
            s.get("size"), s.get("status", "Draft"),
        ], row=i)


def _build_open_questions(wb, questions):
    ws = wb.create_sheet("Open Questions")
    headers = [
        "ID", "Question", "Owner", "Status", "Priority", "Source",
    ]
    _header_row(ws, headers)
    _set_col_widths(ws, [10, 60, 25, 12, 8, 30])
    ws.row_dimensions[1].height = 20
    _freeze(ws)

    for i, q in enumerate(questions, start=2):
        _data_row(ws, [
            q.get("id"), q.get("question"), q.get("owner"),
            q.get("status", "Open"), q.get("priority"), q.get("source"),
        ], row=i)


# ── Main ──────────────────────────────────────────────────────────────────────

def create_workbook(output_path: str, data: dict) -> None:
    project_name = data.get("project", "Discovery Project")

    wb = openpyxl.Workbook()
    _build_overview(wb, project_name, data)
    _build_epics(wb, data.get("epics", []))
    _build_features(wb, data.get("features", []))
    _build_stories(wb, data.get("stories", []))
    _build_open_questions(wb, data.get("open_questions", []))

    output = Path(output_path)
    output.parent.mkdir(parents=True, exist_ok=True)
    wb.save(output)
    print(f"OK: {output} created ({len(data.get('epics',[]))} epics, "
          f"{len(data.get('features',[]))} features, "
          f"{len(data.get('stories',[]))} stories)")


def main():
    parser = argparse.ArgumentParser(description="Create Backlog Tracker Excel workbook.")
    parser.add_argument("--output", required=True, help="Output .xlsx path")
    group = parser.add_mutually_exclusive_group(required=True)
    group.add_argument("--data", help="JSON string")
    group.add_argument("--data-file", help="Path to JSON file")
    args = parser.parse_args()

    if args.data_file:
        with open(args.data_file, encoding="utf-8") as f:
            data = json.load(f)
    else:
        data = json.loads(args.data)

    create_workbook(args.output, data)


if __name__ == "__main__":
    try:
        main()
    except Exception as exc:
        print(f"ERROR: {exc}", file=sys.stderr)
        sys.exit(1)
