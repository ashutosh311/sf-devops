# Learn Playbook

**Sub-Phase 2 of 4** | Week 2 (typical)

## Purpose

Validate and refine the current state understanding through stakeholder workshops. This is **validation, not information gathering** — you arrive with reaction materials from Prepare, and stakeholders correct and refine your understanding.

The outcome is shared understanding on: what the main issues are, where bottlenecks exist, how issues categorize across functional areas, and which cross-functional patterns emerge.

## Checklist

- [ ] All reaction materials from Prepare ready for presentation
- [ ] Workshop sessions scheduled with appropriate SMEs per functional area
- [ ] Note-taker or recording assigned for each session
- [ ] Process diagrams walked through with stakeholders and corrected
- [ ] Pain points validated, new pain points captured
- [ ] Cross-functional patterns identified
- [ ] Complexity areas validated with technical stakeholders
- [ ] Bottlenecks quantified where possible
- [ ] End-of-week synthesis session completed
- [ ] Validated materials ready for Ideate phase

## Key Activities

### Before Each Session
- Review what you know about this stakeholder group
- Compile relevant reaction materials (diagrams, pain points, Salesforce data)
- Prepare targeted questions based on Prepare analysis gaps
- Use `#sdlc/discover prep-workshop`

### During Each Session

**Present:** Walk through prepared materials — process diagrams, analysis findings, synthesized pain points

**Intake:** Capture corrections, new pain points, clarifications. Note direct quotes for impactful statements.

**Clarify:** Ask targeted questions. Validate assumptions. Resolve conflicts between documentation and reality.

### After Each Session

**Process notes** — clean up and structure using the session note template
- Use `#sdlc/discover process-session` to:
  - Create a structured session note in `artifacts/discovery/01 - Sessions/`
  - Queue candidate pain points, risks, decisions, and stakeholders as reviewable proposals for `00 - Registers/`

**Run conflict detection** — compare what this stakeholder said vs. previous stakeholders
- Use `#sdlc/discover conflict-check`

**Build structured analysis views** — capture current-state themes and evidence-backed findings
- Use `#sdlc/discover analyze` for prioritization and stakeholder tensions

### End of Week
- Synthesize across all sessions for cross-functional patterns
- Use `#sdlc/discover synthesize` for weekly rollups and current-state updates
- Run `#sdlc/discover hub-audit` to identify coverage gaps before Ideate

## Outputs

By end of Learn:
- Validated process diagrams, annotated with pain points
- Prioritized pain points, categorized by functional area
- Cross-functional patterns documented
- Stakeholder themes, decisions, risks, and tensions captured in `00 - Registers/`
- Updated session notes in `01 - Sessions/`
- Themes identified for Ideate

## Skills Used in This Phase

| Prompt | Purpose |
|--------|---------|
| `#sdlc/discover process-session` | Post-session note processing and register updates |
| `#sdlc/discover conflict-check` | Cross-session conflict detection |
| `#sdlc/discover synthesize` | Cross-session synthesis |
| `#sdlc/discover analyze` | Prioritization and stakeholder tension analysis |
| `#sdlc/discover prep-workshop` | Pre-session preparation |
| `#sdlc/discover hub-audit` | Completeness checks and gap reporting |
