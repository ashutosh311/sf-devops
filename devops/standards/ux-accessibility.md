---
title: UX and Accessibility Standards
description: User experience and accessibility standards for all Salesforce UI — WCAG 2.1 compliance, SLDS usage, progressive disclosure, internationalisation, and consistency with the standard Salesforce UI.
scope: ux, accessibility, lwc, aura, omniscript, flow
enforce: always
---

# UX and Accessibility Standards

All custom UI (LWC, Aura, Flow Screens, OmniScript, Experience Cloud pages) MUST meet the standards in this document. Accessibility is non-negotiable — components that fail WCAG 2.1 will be rejected in code review.

> This document is the central UX/Accessibility reference for the build. Component-specific accessibility guidance also appears in `lwc.md §6` and `omniscript.md §8–§9`; where they differ from this document, this document takes precedence.

---

## 1. Accessibility — WCAG 2.1 Conformance

All custom UI MUST conform to **WCAG 2.1 Level AA** as a minimum. This is a prerequisite for release — there are no exceptions for internal tools.

### Prefer Standard Components Over Raw HTML

Use Salesforce base components (`<lightning-*>`, OOTB OmniScript elements, standard Flow Screen components) wherever possible. The platform components generate the HTML attributes required for screen readers, keyboard navigation, and focus management.

Raw HTML components WILL NOT pass WCAG 2.1 without explicit additional work to add ARIA attributes, keyboard handlers, focus traps, and semantic roles. When a raw HTML element is unavoidable, the implementation MUST be reviewed against WCAG 2.1 before merge.

### Core Accessibility Rules

| Rule | Requirement |
|------|-------------|
| Accessible names | Every interactive element MUST have a programmatic accessible name — visible text, `aria-label`, `aria-labelledby`, or `title`. |
| Colour is not the only cue | Information conveyed by colour MUST also be conveyed by text, icon, or pattern (WCAG 1.4.1). |
| Colour contrast | Body text ≥ 4.5:1, large text ≥ 3:1 against its background (WCAG 1.4.3). |
| Keyboard navigation | All functionality MUST be operable with the keyboard alone — no mouse-only interactions. Focus order MUST be logical. |
| Focus indication | A visible focus indicator MUST be present on every focusable element. Do NOT remove outlines with CSS `outline: none` without providing an alternative. |
| Form labels | Every input MUST have an associated `<label>` or `aria-label`. Placeholders are NOT labels. |
| Error identification | Errors MUST be identified in text (not colour alone) and programmatically associated with the offending field. |
| Time-based content | Avoid auto-advancing carousels, timeouts, or moving content unless the user can pause, extend, or dismiss them (WCAG 2.2.1). |
| Media | Images MUST have `alt` text describing their purpose. Decorative images MUST have `alt=""`. Video MUST have captions. |
| Language | The page and any language change within it MUST be declared via the `lang` attribute. |

### Standard Salesforce Components Already Compliant

When you use them correctly, these components produce WCAG 2.1 compliant markup out of the box:

- `lightning-button`, `lightning-button-icon`, `lightning-button-menu`
- `lightning-input`, `lightning-textarea`, `lightning-combobox`, `lightning-checkbox`
- `lightning-datatable`, `lightning-tree-grid`
- `lightning-modal`, `lightning-card`, `lightning-tabset`
- OOTB OmniScript elements (Text, Select, Checkbox, Radio, DatePicker, etc.)

"Correctly" means providing the documented properties: `label`, `title`, `alternative-text`, `field-level-help` as appropriate. An unlabelled `lightning-button-icon` is still inaccessible.

---

## 2. Salesforce Lightning Design System (SLDS)

**SLDS is the mandatory design system for all custom UI.** Custom stylesheets are only acceptable where SLDS does not provide the required pattern, and even then the first preference is to extend or compose SLDS utility classes rather than writing new CSS.

### Rules

- Use SLDS utility classes (`slds-p-around_medium`, `slds-grid`, `slds-m-top_small`) for spacing and layout — do not write equivalent custom CSS.
- Use SLDS design tokens (colours, font sizes, spacing scale) — do not hardcode hex values or pixel sizes.
- Custom CSS MUST be scoped to the component bundle — never apply styles that escape the shadow DOM and affect other components.
- Do NOT override SLDS base class behaviour (e.g. redefining `slds-button`) — create a bespoke class if a different visual style is genuinely needed.

### Consistency with Standard Salesforce UI

The look, feel, and behaviour of every custom component MUST be consistent with the standard Salesforce UI. This includes:

| UI Concern | Standard Pattern |
|-----------|------------------|
| Success/error feedback | `ShowToastEvent` (LWC) / SLDS toast markup |
| Loading states | `lightning-spinner` inline or over content |
| Empty states | SLDS illustration + helper text + primary action |
| Destructive actions | `variant="destructive"` button + confirmation modal |
| Inline errors | SLDS `slds-has-error` + `slds-form-element__help` |
| Field help | `field-level-help` on `lightning-input` (popover) |

---

## 3. Progressive Disclosure

Screens MUST focus on the user's current task. Do not overload users with information or controls that are not relevant to what they are trying to accomplish right now.

### Techniques

- **Tabs** (`lightning-tabset`) — group related content so only one set is visible at a time.
- **Conditional rendering** (`<template lwc:if>`) — hide sections until the user's input makes them relevant.
- **Actions / utility bar / modals** — move secondary workflows out of the primary screen.
- **Lazy loading** — defer the query for data until the component that consumes it is visible.
- **Pagination or infinite scroll** — never render an unbounded list.

### Rules

- Every custom list view or table MUST implement pagination or infinite scroll — never return an unbounded result set to the UI.
- Multi-step processes MUST use a wizard pattern (OmniScript steps, or Flow screens) rather than a single long form.
- Keep the default view to the minimum fields required for the decision in front of the user. Additional detail belongs behind an "Edit" action, expandable section, or a record detail page.

---

## 4. Forms and Data Entry

- Every input MUST have a visible label. Placeholders MUST NOT be used in place of labels.
- Required fields MUST be marked with the `required` attribute (which Salesforce renders as an accessible indicator).
- Client-side validation MUST run on blur and on submit — not on every keypress (except for length counters).
- Errors MUST identify the specific field and state what to do next — not just "Invalid input".
- Use the correct input `type`: `email`, `tel`, `url`, `date`, `number` — so mobile browsers show the right keyboard and the platform provides native validation.

---

## 5. Mobile and Responsive Behaviour

- All custom UI MUST work on the Salesforce Mobile App (iOS and Android) unless the `js-meta.xml` explicitly excludes it.
- Touch targets MUST be at least **44×44 px** (WCAG 2.5.5 — AAA, required here for mobile).
- Use SLDS responsive grid classes (`slds-size_12-of-12`, `slds-large-size_6-of-12`) rather than fixed-width layouts.
- Avoid hover-only interactions — mobile has no hover.

---

## 6. Internationalisation and Custom Labels

All user-facing static text in LWC, Aura, Flow, and OmniScript MUST come from **Custom Labels**. Hardcoded strings in markup or JavaScript are forbidden. This enables automatic translation into the user's language without touching markup.

See `configuration.md §5 Custom Labels` for naming conventions.

- Dates, times, numbers, and currency MUST be rendered via `lightning-formatted-date-time`, `lightning-formatted-number`, `lightning-formatted-time`, etc. — never via string concatenation.
- Do not assume left-to-right layout — use logical SLDS properties (e.g. `slds-m-start`, `slds-m-end`) so right-to-left languages render correctly.

---

## 7. Feedback and Error Presentation

- Every user-initiated action MUST produce visible feedback within **200 ms** — either the resulting change, a loading indicator, or an error.
- Use `ShowToastEvent` for confirmations and non-blocking errors.
- Use modal dialogs for blocking errors that require acknowledgement.
- Raw error objects, stack traces, and unformatted Apex exception messages MUST NEVER be displayed to end users. Wrap errors via `c/ldsUtils` `reduceErrors()` (see `lwc.md §5`) and show a human-readable message.
- Every empty state (no records, no results, no access) MUST have an illustration or icon, a short explanation, and — where applicable — a primary action ("Create first record").

---

## 8. Review Checklist

Before merging any custom UI, the reviewer MUST confirm:

- [ ] All interactive elements have accessible names.
- [ ] All colour contrast passes WCAG 2.1 AA (use the Salesforce WCAG checklist or a tool like Axe).
- [ ] The component is fully keyboard-operable with a visible focus indicator.
- [ ] All static text is sourced from Custom Labels.
- [ ] Only `lightning` namespace / OOTB OmniScript / standard Flow elements are used — any raw HTML is justified in the PR description.
- [ ] Custom CSS uses SLDS tokens and utility classes, and is scoped to the component.
- [ ] Empty, loading, and error states are all implemented.
- [ ] The component works in the Salesforce Mobile App at the expected breakpoints.
- [ ] Pagination or a bounded result set is enforced for any list.

