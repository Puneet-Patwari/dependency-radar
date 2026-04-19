# Forge App Development Guide

This is an Atlassian Forge app built with TypeScript and Forge React (Forge UI Kit). It runs on the Forge platform.

## Project Structure

```
.testing-framework/.      # Provides drop-in shims, realistic API fixtures etc for Forge.
src/
├── index.ts              # Main entry point — exports resolver handler
├── resolvers/            # Backend resolver functions (Node.js runtime)
│   ├── index.ts          # Resolver implementation
│   └── __tests__/        # Resolver unit tests
├── frontend/             # React frontend (UI Kit 2)
│   ├── index.tsx         # App UI components
│   └── __tests__/        # Component tests
├── types/                # TypeScript type definitions
│   ├── index.ts          # Type exports
│   └── forge-ui-types.ts # Forge UI Kit component types (auto-generated)
├── __tests__/            # Integration and framework tests
└── setupTests.ts         # Jest test configuration

manifest.yml              # Forge app manifest — defines modules, permissions, resources
eslint.config.js          # ESLint with Forge-specific rules
jest.config.cjs           # Jest config with Forge shims
tsconfig.json             # TypeScript configuration
```

## Key Commands

```bash
npm run build             # TypeScript type-check (no emit — Forge compiles at deploy time)
npm run test              # Run all tests with Jest
npm run test:watch        # Run tests in watch mode
npm run test:coverage     # Tests with coverage report
npm run lint              # ESLint with Forge-specific rules
npm run lint:fix          # Auto-fix lint issues
npm run validate:manifest # Validate manifest.yml structure and rules
npm run ci                # Full validation: type-check + lint + manifest + tests
```

Important: You should run `npm run ci` regularly to validate your work as you go

## Forge Platform Concepts

- **Modules** define where the app appears (e.g., `jira:issuePanel`, `confluence:contentAction`). Configured in `manifest.yml`.
- **Resolvers** are backend functions invoked from the frontend via `@forge/bridge`. They run in Node.js and can call Atlassian APIs via `@forge/api`.
- **Resources** point to frontend entry files that render UI Kit 2 components.
- **UI Kit 2** uses React with Forge-specific components from `@forge/react` (e.g., `Text`, `Button`, `Table`).

## Testing

### Test Runner

Tests use **Jest** with `ts-jest` and `jsdom` environment. The testing framework provides drop-in shims for Forge platform modules so tests run locally without deploying.

### Module Shims (jest.config.cjs)

The Jest config maps `@forge/*` imports to local shims:

| Import | Shim | Purpose |
|--------|------|---------
| `@forge/api` | `.testing-framework/dist/shims/forge-api/` | Fake `fetch`, `route()`, `asApp()`, `asUser()` |
| `@forge/bridge` | `.testing-framework/dist/shims/forge-bridge/` | Fake `invoke()`, `view` |
| `@forge/kvs` | `.testing-framework/dist/shims/forge-kvs/` | In-memory key-value store with Custom Entity support |
| `@forge/react` | `.testing-framework/dist/shims/forge-react/` | Stub UI Kit components, `ForgeReconciler`, `xcss()` |

These shims are automatically active in tests — no manual setup needed.

### Testing Framework (`@forge/testing-framework`)

Import from `@forge/testing-framework` for test utilities:

```typescript
import {
  createFrontendContext,      // Frontend context (useProductContext)
  createBackendContext,       // Backend resolver context
  FixtureStore,               // API response fixture management
} from '@forge/testing-framework';
```

#### Mock Contexts

Generate realistic Forge contexts for any module type:

```typescript
// Frontend context — what useProductContext() returns
const ctx = createFrontendContext('jira:issuePanel', {
  extension: { issue: { key: 'BUG-42', type: 'Bug' } },
});
// ctx.extension.type === 'jira:issuePanel'
// ctx.extension.issue.key === 'BUG-42'

// Backend resolver context — what the resolver receives
const resolverCtx = createBackendContext('jira:issuePanel');
// resolverCtx.accountId, resolverCtx.installContext, etc.
```

#### Fixture Store

Manage API response fixtures with cascading priority:

```typescript
import { FixtureStore } from '@forge/testing-framework';

const store = new FixtureStore({
  fixtureDir: './fixtures',  // Optional: load fixtures from files
});

// Built-in defaults cover common Jira and Confluence APIs (GET, POST, PUT, DELETE)
const result = store.lookup('GET', '/rest/api/3/issue/TEST-1');
// result.found === true, result.response.body contains realistic issue data

// Override for specific tests via the test harness
harness.addFixture('GET', '/rest/api/3/issue/TEST-1', {
  status: 200,
  body: { key: 'TEST-1', fields: { summary: 'Custom fixture' } },
});
```

### Writing Tests

**Resolver tests** — use the test harness to invoke resolvers with realistic context and API fixtures:

```typescript
import { createTestHarness } from '@forge/testing-framework';
import { handler } from '../resolvers/index';

const harness = createTestHarness({ manifest: './manifest.yml', handler });

beforeEach(() => {
  harness.reset(); // Clears storage, API call history, and fixture overrides
});

describe('my resolver', () => {
  it('returns data using default API fixtures', async () => {
    // Default fixtures for common Jira/Confluence APIs are provided automatically.
    // The harness auto-detects the module type from the manifest and populates
    // the context extension with realistic defaults.
    const result = await harness.invoke('getIssueData');
    expect(result.data).toBeDefined();
  });

  it('works with custom fixtures and payload', async () => {
    harness.addFixture('GET', '/rest/api/3/issue/BUG-1', {
      status: 200,
      body: { key: 'BUG-1', fields: { summary: 'Fix login' } },
    });

    const result = await harness.invoke('getIssueData', {
      payload: { issueKey: 'BUG-1' },
    });
    expect(result.data).toEqual({ summary: 'Fix login' });
  });

  it('can inspect API calls made by the resolver', async () => {
    await harness.invoke('getIssueData');
    expect(harness.apiCalls.some(c => c.path.includes('/issue/'))).toBe(true);
  });
});
```

**Frontend tests** — the `@forge/react` shim provides stub components automatically. Use the bridge shim to set up context and mock `invoke()` responses:

```typescript
import React from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import { bridge } from '@forge/bridge';
import { createFrontendContext } from '@forge/testing-framework';
import App from '../frontend/index';

beforeEach(() => {
  bridge.reset(); // Clears context, invoke handlers, and recorded interactions
});

describe('App', () => {
  it('should render with product context', async () => {
    // Set context — this populates view.getContext(), useProductContext(), AND useConfig()
    // For macros, put config values in extension.config (mirrors the real Forge runtime)
    bridge.setContext(createFrontendContext('jira:issuePanel', {
      extension: { issue: { key: 'TEST-1', type: 'Task' } },
    }));

    // Mock resolver responses for invoke() calls
    bridge.mockInvoke('getData', { items: [{ id: 1, title: 'Example' }] });

    render(<App />);

    await waitFor(() => {
      expect(screen.getByText('Example')).toBeDefined();
    });

    // Assert invoke was called with expected args
    expect(bridge.invocations).toHaveLength(1);
    expect(bridge.invocations[0].functionKey).toBe('getData');
  });

  it('should disable submit button when form is invalid', async () => {
    bridge.setContext(createFrontendContext('jira:issuePanel'));

    render(<App />);

    // Forge UI Kit behavioral props (isDisabled, isLoading, appearance, etc.)
    // are forwarded as data-* attributes on the shim's rendered div.
    const submitButton = screen.getByTestId('forge-button');
    expect(submitButton).toHaveAttribute('data-isdisabled', 'true');
  });
});
```

> **NEVER use `jest.mock()` for `@forge/*` modules** (e.g., `@forge/bridge`, `@forge/react`, `@forge/api`). These are already shimmed via `moduleNameMapper` in `jest.config.cjs`. Manually mocking them will override the shims and break tests. If a shim is genuinely missing from the test framework, then creating a mock is ok.

## Forge UI Kit Types

TypeScript definitions for Forge UI Kit components are in `src/types/forge-ui-types.ts`. These provide type safety for component props:

```typescript
import { ButtonProps, BoxProps } from '../types';
import { xcss } from '../types';

// Type-safe xcss styling
const styles = xcss({
  padding: 'space.200',
  backgroundColor: 'color.background.neutral',
});
```

These types are auto-generated. Do not edit `forge-ui-types.ts` manually.

## Important Notes

- **Do not import Node.js built-ins in frontend code** — frontend runs in a sandboxed browser environment
- **Use `@forge/api` for HTTP requests in resolvers** — direct `fetch` won't have the right auth context
- **`@forge/react` components only** in frontend — standard HTML elements are not supported in UI Kit 2
- **Manifest changes require redeployment** — `forge deploy` after modifying `manifest.yml`
- **The `app.id` field** in `manifest.yml` must be set via `forge register` before first deploy

## Development Rules

### ⛔ NEVER DO

- **NEVER use `forge create`** — the app already exists
- **NEVER create new apps from scratch** — only modify the existing app
- **NEVER delete the existing app** — modify and extend the provided project
- **NEVER skip linting** — fix ALL errors before completing
- **NEVER deploy or install the app** — the user will publish through the UI
- **NEVER ask users to run commands** — execute all commands yourself using tools
- **NEVER ask users for manual intervention** — complete all tasks autonomously
- **NEVER leave incomplete code** — never leave TODOs or unfinished code
- **NEVER leave `it.todo` test placeholders unchanged** — replace with real tests
  or delete the file if that test type doesn't apply
- **NEVER create test files alongside existing test stubs** — update the existing
  file, don't create parallel files
- **NEVER write tests that only test mocks** — test real code with real functions
- **NEVER write `expect(true).toBe(true)` or no-op assertions** — every test must
  exercise real app code
- **NEVER manually mock `@forge/*` modules** (`@forge/react`, `@forge/bridge`,
  `@forge/api`, `@forge/kvs`) — these are shimmed via `jest.config.cjs`
- **NEVER ignore code coverage** — meet the thresholds configured in jest.config.cjs
- **NEVER use deprecated Atlassian REST APIs** — check API docs for current versions
- **NEVER fall back to mock data on error** — in live mode, display errors to the user

### ✅ ALWAYS DO

- **Work within the project root only**
- **Use the `forge-cli` tool for ALL Forge commands** — never use bash to run forge
  commands. The forge-cli tool handles credentials automatically
- **Read existing code** before making changes
- **Run `npm run ci` regularly** — this runs type-check, lint, manifest validation,
  and tests with coverage enforcement
- **Implement Preview Mode** — users must see mock data in preview, not loading/error
  states. Live mode must use real data
- **Follow tech spec modules** — don't swap modules during development
- **Use correct manifest module keys** — Confluence macros use the top-level key `macro`,
  NOT `confluence:macro`. Other Confluence modules use prefixed keys like `confluence:fullPage`,
  `confluence:contentBylineItem`. Jira modules use `jira:issuePanel`, `jira:issueAction`, etc.
- **Write useful tests** — use the testing framework in `.testing-framework/`.
  Spend time understanding it. Use createTestHarness for resolver tests
- **Test cold-start and edge cases** — test with empty storage and edge-case inputs
- **Implement proper error handling** — log with console.error() in resolvers.
  Return errors to frontend for display. Add generous console logs for debugging
- **Verify scopes match API usage** — before completing, review every API call
  and confirm correct scope + allowImpersonation settings in manifest
- **Take screenshots of ALL UI modules** after development — verify they render
  correctly with mock data

## Quality Gates — MUST ALL PASS before completing

Run these checks in order after development or any changes:

1. **`npm run ci`** — type-checking, linting, manifest validation, tests with
   coverage. Fix ALL errors, re-run until clean.
2. **`forge lint`** (via forge-cli tool) — fix ALL errors, re-run until zero errors.
3. **`forge build`** (via forge-cli tool) — verify webpack bundling succeeds.
   Note: webpack does NOT support TypeScript path aliases (e.g. `@/...`).
4. **Take screenshots** (via `take-screenshot` tool) — capture ALL UI modules.
   Verify layout, styling, Atlassian Design System compliance, no errors,
   mock data visible in preview mode.
5. **Review screenshots** — if any show errors, blank screens, or missing content,
   fix and re-screenshot.

## API Authentication

Forge apps use `@forge/api` to call Atlassian REST APIs. Choose the right identity:

### `asApp()` — App identity
Use when the action doesn't need to appear as a specific user:
- Reading public data, background tasks, scheduled jobs, webhooks, admin operations

```typescript
import api, { route } from '@forge/api';
const response = await api.asApp().requestJira(route`/rest/api/3/issue/${issueKey}`);
```

### `asUser()` — User identity (inline impersonation)
Use when the action should appear as the current user (available in UI Kit modules):
- Creating/updating content, commenting, assigning issues, any user-facing write
- The user gets an OAuth consent prompt automatically — no special manifest config needed

```typescript
const response = await api.asUser().requestJira(route`/rest/api/3/issue/${issueKey}`, {
  method: 'PUT',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(updateData),
});
```

**Manifest — simple scopes are sufficient for `asUser()`:**
```yaml
permissions:
  scopes:
    - write:jira-work
```

**Note:** `allowImpersonation: true` is only required for offline impersonation
(`api.asUser(accountId)`) — e.g., acting as a specific user from a scheduled trigger.
It is NOT needed for the standard `api.asUser()` call in UI Kit modules.

**Decision rules:**
- If the user is present and should see themselves as the author → `asUser()`
- If it's a system/background action or the user is not present → `asApp()`
- When in doubt in a UI module → `asUser()` (respects user permissions)

## Resolver Context Shapes

Each resolver receives `(req)` where `req.payload` is frontend data and
`req.context` is product context:

- **Confluence macro**: `req.context.extension.content.id`, `req.context.extension.space.key`
- **Jira issue panel**: `req.context.extension.issue.key`, `req.context.extension.issue.id`
- **Jira project page**: `req.context.extension.project.key`
- **Jira dashboard gadget**: `req.context.extension.dashboard.id`
- **Global page**: No specific extension context (just `req.context.accountId`)

## xcss Token Reference

When using `xcss()` for styling Forge UI Kit `Box` components, use these design tokens:

### Spacing tokens (for padding, margin, gap, etc.)
`space.0`, `space.025`, `space.050`, `space.075`, `space.100`, `space.150`,
`space.200`, `space.250`, `space.300`, `space.400`, `space.500`, `space.600`,
`space.800`, `space.1000`

### Color tokens
- **Background**: `color.background.neutral`, `color.background.neutral.subtle`,
  `color.background.brand.bold`, `color.background.success`, `color.background.danger`,
  `color.background.warning`, `color.background.information`, `color.background.input`
- **Text**: `color.text`, `color.text.subtle`, `color.text.subtlest`,
  `color.text.brand`, `color.text.success`, `color.text.danger`,
  `color.text.warning`, `color.text.information`, `color.text.inverse`
- **Border**: `color.border`, `color.border.bold`, `color.border.brand`,
  `color.border.success`, `color.border.danger`

### Border tokens
- **Width**: `border.width`, `border.width.outline`
- **Radius**: `radius.xsmall`, `radius.small`, `radius.medium`, `radius.large`,
  `radius.xlarge`, `radius.xxlarge`, `radius.full`, `radius.tile`
- **Style**: Use string values like `'solid'`, `'none'`

### Example
```typescript
const containerStyles = xcss({
  padding: 'space.200',
  backgroundColor: 'color.background.neutral',
  borderRadius: 'radius.small',
  borderWidth: 'border.width',
  borderStyle: 'solid',
  borderColor: 'color.border',
});
```
## Pinecone (Vector Database)

⚠️ **MANDATORY: If you need to help with Pinecone, vector databases, embeddings, semantic search, RAG, or recommendations, you MUST read `.agents/PINECONE.md` first** to determine:

- What questions to ask the user
- How to select the programming language
- Which guide files to consult for implementation details

Do not proceed with Pinecone-related tasks without consulting the appropriate guide files. Use `.agents/PINECONE.md` as your entry point and follow its "Choosing the Right Guide" section to navigate to the appropriate resources.

### Pinecone Instructions Catalog

@./.agents/PINECONE.md
@./.agents/PINECONE-cli.md
@./.agents/PINECONE-python.md
@./.agents/PINECONE-typescript.md
@./.agents/PINECONE-go.md
@./.agents/PINECONE-java.md
@./.agents/PINECONE-quickstart.md
@./.agents/PINECONE-troubleshooting.md
