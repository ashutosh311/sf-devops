---
title: LWC Standards
description: Complete Lightning Web Component standards — naming, structure, wire vs imperative, error handling, accessibility, performance, and JEST testing.
scope: lwc, frontend, testing
enforce: always
---

# LWC Standards

---

## 1. Naming Conventions

| Type | Convention | Example |
|------|-----------|---------|
| Component folder | camelCase | `accountSummaryCard` |
| Global utility component | `glbl` prefix + camelCase | `glblDateFormatter` |
| Public properties (`@api`) | camelCase | `recordId`, `objectApiName` |
| Private properties | `_camelCase` | `_isLoading` |
| Event names | lowercase kebab-case | `record-selected`, `form-submitted` |
| Event handlers | `handle<Source><Action>` | `handleSaveButtonClick` |

- When a component is a utility intended for **global use across the application**, prefix it with `glbl` (e.g. `glblErrorDisplay`, `glblLoadingSpinner`).
- When a 1:1 relationship exists between an LWC and its Apex controller, name the component the same as the controller with the `Ctrl` suffix removed and the first character lowercased (e.g. `AccountMoveCtrl` → `accountMove`).
- When multiple components reference the same controller, name the component after the page or function it serves.

---

## 2. Component File Structure

```
accountSummaryCard/
  accountSummaryCard.js
  accountSummaryCard.html
  accountSummaryCard.css
  accountSummaryCard.js-meta.xml
  __tests__/
    accountSummaryCard.test.js
```

Every component MUST have a `__tests__` directory with at least one test file.

---

## 3. Component JS Template

```js
import { LightningElement, api, wire } from 'lwc';
import { getRecord }                   from 'lightning/uiRecordApi';
import { ShowToastEvent }              from 'lightning/platformShowToastEvent';
import { reduceErrors }                from 'c/ldsUtils';

import getAccountSummary from '@salesforce/apex/AccountSummaryController.getSummary';

// Always use schema tokens — never hardcoded field strings
import NAME_FIELD   from '@salesforce/schema/Account.Name';
import RATING_FIELD from '@salesforce/schema/Account.Rating';

const FIELDS = [NAME_FIELD, RATING_FIELD];

export default class AccountSummaryCard extends LightningElement {

    @api recordId;

    @wire(getRecord, { recordId: '$recordId', fields: FIELDS })
    account;

    _isLoading = false;
    _errorMessage = null;

    // Computed values belong in getters, not HTML
    get accountName() {
        return this.account?.data?.fields?.Name?.value ?? '';
    }

    get hasError() {
        return !!this._errorMessage;
    }

    handleSaveButtonClick() {
        this._isLoading = true;
        this._errorMessage = null;

        getAccountSummary({ accountId: this.recordId })
            .then(result => { /* handle result */ })
            .catch(error => {
                this._errorMessage = reduceErrors(error).join(', ');
                this.dispatchEvent(new ShowToastEvent({
                    title: 'Error', message: this._errorMessage, variant: 'error'
                }));
            })
            .finally(() => { this._isLoading = false; });
    }

    fireRecordSelected(recordId) {
        this.dispatchEvent(new CustomEvent('record-selected', {
            detail: { recordId },
            bubbles: true,
            composed: false
        }));
    }
}
```

---

## 4. Wire vs Imperative Apex

| Use Wire | Use Imperative |
|----------|---------------|
| Read data that should refresh reactively | User-triggered actions (save, submit, delete) |
| Data dependent on `@api` property changes | Need to call in `connectedCallback` conditionally |
| Display-only data binding | Need explicit loading state management |

---

## 5. Error Handling

- ALWAYS catch errors from imperative Apex calls.
- ALWAYS show user-facing feedback via `ShowToastEvent` — never silently fail.
- Use `c/ldsUtils` `reduceErrors()` to flatten LDS/Apex error shapes.
- NEVER display raw error objects or stack traces to end users.

---

## 6. Accessibility

- Every interactive element MUST have an accessible label (`aria-label`, `title`, or visible text).
- Use `lightning-button`, `lightning-input`, `lightning-combobox` over raw HTML equivalents. Standard Lightning components automatically generate the HTML required for WCAG 2.1 compliance and screen reader support.
- Color alone MUST NOT convey meaning — pair with icons or text.
- Keyboard navigation MUST work without a mouse.
- If a standard Lightning component cannot be used and a raw HTML element is required, the implementation MUST be reviewed against the **WCAG 2.1 standards** to ensure compliance. Raw HTML components will not pass WCAG 2.1 without explicit additional consideration.

---

## 7. Consistent User Experience

All components MUST use the **Salesforce Lightning Design System (SLDS)** for styling. Custom CSS should be minimal and only used where SLDS does not provide the required styling. Never apply custom CSS that overrides or conflicts with standard SLDS patterns.

The look, feel, and behaviour of every custom component MUST be consistent with the standard Salesforce UI — including how errors, confirmations, loading states, and empty states are presented. Use `ShowToastEvent` for confirmations and errors, `lightning-spinner` for loading states, and SLDS utility classes for layout and spacing.

---

## 8. Component-Driven Development

Build LWCs using a **bottom-up, component-driven** approach:

- Start by building small, isolated, reusable components before assembling them into larger interfaces.
- Design each component with future reuse in mind — consider whether it can be made configurable via `@api` properties rather than hardcoded for a single use case.
- Assemble pages and features by composing modular components rather than building monolithic components.
- Expose key attributes as Design Attributes (`.js-meta.xml`) so administrators can configure components via Lightning App Builder without code changes.

For complex projects involving a large number of components, provide a **component architecture diagram** (e.g. using Lucidchart or equivalent) that breaks down the component hierarchy, their relationships, and which components share an Apex controller.

---

## 9. Performance

- NEVER call Apex inside a loop.
- NEVER use `@track` on primitives — reactivity is automatic.
- Use `@track` only for nested object mutations LWC won't catch automatically.
- Debounce `oninput` handlers that trigger Apex calls (300ms minimum).
- Use **progressive disclosure** — focus components on the user's current operation and defer loading context that isn't needed immediately.
- Implement **pagination or infinite scroll** for lists — never allow the UI to return an unbounded list.
- Limit event handlers: use `<template>` conditionals to avoid rendering handlers that are not needed, and avoid adding handlers inside iteration blocks.
- Prefer **Lightning Data Service** (wire) for read operations — it provides automatic caching and enforces field-level security out of the box.
- Custom Apex must only be used where LDS cannot satisfy the requirement.
- Before using a third-party JavaScript or CSS library, check compatibility with the Lightning Locker Service.
- Mark read-only Apex methods with `@AuraEnabled(cacheable=true)` so wire calls benefit from client-side caching and do not count against Apex call limits unnecessarily.

### Template Conditionals over CSS

Use `<template lwc:if={condition}>` for conditional rendering rather than toggling CSS `display` or `visibility`. Template conditionals remove elements from the DOM entirely, preventing unnecessary rendering and event handler registration:

```html
<!-- GOOD — element not rendered at all when condition is false -->
<template lwc:if={hasError}>
    <p class="slds-text-color_error">{errorMessage}</p>
</template>

<!-- AVOID — element exists in DOM, just hidden -->
<p class={errorClass}>{errorMessage}</p>
```

### LWC Sub-modules for Complex Logic

For simple components, include logic directly in the component's main JS class. If a component contains **significant business logic**, extract it into separate ES modules within the component bundle and import them:

```
accountSummaryCard/
  accountSummaryCard.js        ← orchestration only
  accountSummaryCard.html
  accountSummaryUtils.js       ← extracted logic
  accountSummaryCard.js-meta.xml
```

This keeps the main class focused on component lifecycle and event handling, and makes the logic independently testable.

### Base Components — Prefer `lightning` Namespace

Salesforce provides two base component libraries:

| Namespace | Status | Use |
|-----------|--------|-----|
| `<lightning-*>` | **Current** — actively maintained | ✅ Always prefer. Provides inbuilt client-side validation, native Lightning styling, improved performance, and built-in accessibility. |
| `<ui:*>` | Legacy | ❌ Do not use for new development. Only appears in old Aura components. |

All new LWCs MUST use the `lightning` namespace base components (`lightning-button`, `lightning-input`, `lightning-card`, `lightning-datatable`, etc.) over any equivalent `ui` namespace or raw HTML element.

### Caching — Storable Actions and Cacheable Apex

Caching MUST be used to reduce client-server roundtrips wherever the underlying data does not change on every render.

| Mechanism | When to use |
|-----------|-------------|
| **Lightning Data Service (wire)** | First choice for reading sObject data — provides automatic client-side caching and field-level security enforcement. |
| **`@AuraEnabled(cacheable=true)`** | Any read-only Apex method exposed to LWC. Enables client-side caching of the response and allows the method to be called via `@wire`. Methods with this annotation MUST NOT perform DML. |
| **Custom JavaScript cache (static resource)** | Where LDS and cacheable Apex cannot satisfy the requirement — e.g. caching derived/computed data. The component is responsible for checking the cache before every call and invalidating stale entries. |

Storable Actions (the legacy Aura `action.setStorable()` mechanism with 30s `refreshAge` / 900s `expirationAge`) MUST NOT be introduced into new components — migrate to `@AuraEnabled(cacheable=true)` instead.

### Performance Tuning Tools

Use the following tools to monitor and optimise component performance:

- **Chrome DevTools Timeline** — profile rendering and scripting cost
- **Salesforce Lightning Inspector** (Chrome extension) — inspect component trees, wire state, and event flow
- **Salesforce Community Page Optimizer** (Chrome extension) — identify slow components on Experience Cloud pages
- **Chrome Developer Tools (general)** — view HTML source and tag names, review and tweak CSS, step through JavaScript, set breakpoints, and use `console` statements for debug output during active development

### Developer Sandbox Settings

Apply these settings in **development sandboxes only** to aid debugging. Both MUST be reverted before UAT and production.

| Setting | Location | Value in Dev | Value in UAT/Prod |
|---|---|---|---|
| Browser caching | Setup → Session Settings → "Enable secure and persistent browser caching to improve performance" | `false` | `true` |
| Debug Mode | Setup → Users → Advanced Settings → Debug Mode | Enabled per developer | Disabled |

Disabling caching ensures component changes are immediately reflected in the browser. Enabling Debug Mode prevents JavaScript minification so code can be stepped through in browser dev tools.

---

## 10. Component Target Configuration

All components MUST have a `.js-meta.xml` with explicit `isExposed` and `targets`:

```xml
<?xml version="1.0" encoding="UTF-8"?>
<LightningComponentBundle xmlns="http://soap.sforce.com/2006/04/metadata">
    <apiVersion>62.0</apiVersion>
    <isExposed>true</isExposed>
    <targets>
        <target>lightning__RecordPage</target>
    </targets>
</LightningComponentBundle>
```

---

## 11. LWC vs Aura

**Lightning Web Components are the standard custom component technology.** They provide better performance, align with modern web standards, and are easier to develop than Aura components.

- NEVER create new Aura components unless LWC does not support the required feature.
- If an LWC cannot use a specific Aura-only feature, wrap the LWC inside a thin Aura component that solely accesses the missing feature. Approval for this approach is required from the Lead Technical Architect.
- **Visualforce is prohibited** for new development. All UI must be built on the Lightning platform.

---

## 12. Custom Labels

All **static text** displayed in an LWC MUST use Custom Labels. This enables:
- Centralised updates to text without touching markup.
- Automatic translation when the user's language is not the default.

```js
import SAVE_BUTTON_LABEL from '@salesforce/label/c.AccountMove_SaveButtonValue';
```

NEVER hardcode user-facing strings in LWC JS or HTML templates.

---

## 13. Data Security

### Lightning Data Service (Preferred)

Use LDS (`getRecord`, `getFieldValue`, `lightning-record-form`) wherever possible. LDS enforces field-level security automatically and provides caching.

### Custom Apex — WITH SECURITY_ENFORCED

When LDS cannot satisfy the requirement and a custom Apex controller is needed, SOQL queries MUST use `WITH SECURITY_ENFORCED` to throw an exception when the running user lacks field access:

```apex
List<Account> accounts = [SELECT Id, Name, HiddenField__c
                            FROM Account
                            WITH SECURITY_ENFORCED];
```

The calling LWC MUST handle the resulting exception and display a user-friendly error message.

### Third-Party Libraries

- Avoid third-party JavaScript and CSS libraries wherever possible. Use the LWC framework and Salesforce Lightning Design System (SLDS) instead.
- Where a third-party library is necessary, use the **minimised version** and verify compatibility with the Lightning Locker Service.
- **Any use of a third-party library or stylesheet requires approval from the Lead Technical Architect.**

---

## 14. Event Communication

### Parent–Child: Custom Events

Child-to-parent communication MUST use `CustomEvent` dispatched with `bubbles: false, composed: false` unless the event genuinely needs to cross shadow DOM boundaries.

```js
// Child
this.dispatchEvent(new CustomEvent('record-selected', { detail: { recordId } }));

// Parent HTML
<c-child-component onrecord-selected={handleRecordSelected}></c-child-component>
```

### Unrelated Components: Lightning Message Service

For components that do not share a parent/child relationship, use **Lightning Message Service (LMS)** via a Lightning Message Channel. LMS works across components on the same page or across multiple Experience pages.

### Application Events

**Application events are prohibited** without explicit architect approval. They are non-specific, break encapsulation, and make debugging and security review significantly harder. Always prefer component events or LMS.

---

## 15. Component Documentation

Every component bundle MUST include:

1. **Documentation file** — describes the component's purpose, usage, and how to include it in a parent component or page.
2. **Design file** (`.js-meta.xml`) — exposes only the properties that should be configurable in Lightning App Builder. Each exposed property MUST have a label describing its purpose. Where appropriate, constrain to a list of values with a default.
3. **Inline descriptions** — all `@api` properties and custom events MUST have a comment describing their purpose so the component documentation is self-explanatory.

---

## 16. JEST Testing

### Setup

```json
{
  "scripts": {
    "test:unit": "lwc-jest",
    "test:unit:coverage": "lwc-jest --coverage"
  },
  "jest": {
    "testMatch": ["**/__tests__/**/*.test.js"],
    "collectCoverageFrom": ["**/lwc/**/*.js", "!**/__tests__/**"]
  }
}
```

Run `npm run test:unit:coverage` before every PR merge.

### Test File Template

```js
import { createElement }  from 'lwc';
import AccountSummaryCard from 'c/accountSummaryCard';
import { getRecord }      from 'lightning/uiRecordApi';
import getAccountSummary  from '@salesforce/apex/AccountSummaryController.getSummary';

jest.mock(
    '@salesforce/apex/AccountSummaryController.getSummary',
    () => ({ default: jest.fn() }),
    { virtual: true }
);

describe('c-account-summary-card', () => {

    afterEach(() => {
        while (document.body.firstChild) {
            document.body.removeChild(document.body.firstChild);
        }
        jest.clearAllMocks();
    });

    it('renders account name from wire data', () => {
        const element = createElement('c-account-summary-card', { is: AccountSummaryCard });
        element.recordId = '001000000000001AAA';
        document.body.appendChild(element);

        getRecord.emit({ fields: { Name: { value: 'Acme Corp' }, Rating: { value: 'Hot' } } });

        return Promise.resolve().then(() => {
            const nameEl = element.shadowRoot.querySelector('[data-id="account-name"]');
            expect(nameEl.textContent).toBe('Acme Corp');
        });
    });

    it('calls apex on save button click', async () => {
        getAccountSummary.mockResolvedValue({ summary: 'All good' });

        const element = createElement('c-account-summary-card', { is: AccountSummaryCard });
        element.recordId = '001000000000001AAA';
        document.body.appendChild(element);

        element.shadowRoot.querySelector('[data-id="save-btn"]').click();
        await Promise.resolve();

        expect(getAccountSummary).toHaveBeenCalledWith({ accountId: '001000000000001AAA' });
    });
});
```

### Mocking Patterns

```js
// Wire — emit data
getRecord.emit({ fields: { Name: { value: 'Acme' } } });

// Wire — emit error
getRecord.error({ message: 'Unauthorized' });

// Apex — resolve
getAccountSummary.mockResolvedValue({ result: 'ok' });

// Apex — reject
getAccountSummary.mockRejectedValue(new Error('boom'));
```

### Coverage Requirements

| Metric | Minimum |
|--------|---------|
| Line coverage | 85% |
| Branch coverage | 80% |
| Required scenarios | Happy path, wire error, Apex error, custom event dispatch |

### JEST Rules

- `afterEach` MUST clean up DOM and call `jest.clearAllMocks()`.
- NEVER use `setTimeout` in tests — flush with `await Promise.resolve()`.
- NEVER query DOM before emitting wire data.
- Use `data-id` attributes for test selectors — not class names or element types.
- Snapshot tests are PROHIBITED.
