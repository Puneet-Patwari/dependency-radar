# Forge Testing Framework

Zero-config testing for Atlassian Forge apps. Drop-in shims for `@forge/api`, `@forge/kvs`, `@forge/bridge`, `@forge/react`, `@forge/resolver`, and `@forge/events` — with realistic API fixtures, in-memory storage, and mock contexts for 60+ module types.

## Features

- **Test harness** with `invoke()` that resolves your manifest to match the real Forge runtime
- **Two context factories** — `createBackendContext()` for resolvers, `createFrontendContext()` for UI
- **60+ built-in API fixtures** across Jira, Confluence, Jira Software, and Jira Service Management
- **In-memory KVS** with full support for secrets, custom entities, index queries, and transactions
- **OpenAPI validation** against official Atlassian specs
- **Cold-start validation** to catch first-time-use failures

## Installation

See the `jest.config.cjs` in the template for `moduleNameMapper` configuration — it redirects `@forge/*` imports to the testing framework shims automatically.

## Quick Start

### Resolver Tests

```typescript
import { createTestHarness, createBackendContext } from '@forge/testing-framework';
import { handler } from '../src/resolvers';

// The handler key must match a function[].key in manifest.yml.
// Check your manifest.yml functions section: e.g. if it has key: "resolver", use 'resolver' here.
const harness = createTestHarness({
  manifest: './manifest.yml',
  handlers: { 'resolver': handler },
});

beforeEach(() => harness.reset());

test('resolver returns expected data', async () => {
  // result.data is the raw return value from your resolver function.
  // If your resolver returns { issues: [...] }, then result.data.issues is the array.
  const result = await harness.invoke('getIssueDetails', {
    payload: { issueKey: 'TEST-1' },
  });
  expect(result.data.key).toBe('TEST-1');
});

// Override API responses per-test with addFixture
test('handles missing resource gracefully', async () => {
  harness.addFixture('GET', '/rest/api/3/issue/MISSING-1', {
    status: 404,
    body: { errorMessages: ['Issue does not exist'] },
  });
  const result = await harness.invoke('getIssueDetails', {
    payload: { issueKey: 'MISSING-1' },
  });
  expect(result.data).toBeNull();
});
```

**Key pattern:** Use `harness.addFixture(method, path, { status, body })` to control what `api.asUser().requestJira()` or `api.asUser().requestConfluence()` returns in each test. The fixture intercepts the API call made by your resolver — no `jest.mock()` needed. See [API Fixtures](#api-fixtures) for full details.

### Frontend Tests

The `@forge/bridge` shim exposes a `bridge` object (`FakeBridge` instance) for controlling `invoke()` and `view.getContext()` in tests. **Do not** cast `invoke` or `view.getContext` as `jest.MockedFunction` — they are not Jest mocks.

```typescript
import { render, screen, waitFor } from '@testing-library/react';
import { bridge } from '@forge/bridge';
import { App } from '../index';

beforeEach(() => bridge.reset());

test('renders data from resolver', async () => {
  // Mock what invoke('getText') returns
  bridge.mockInvoke('getText', 'Hello world');
  // Mock what view.getContext() returns
  bridge.mockGetContext({
    extension: { config: { name: 'My App' } },
  });

  render(<App />);
  await waitFor(() => {
    expect(screen.getByText('Hello world')).toBeDefined();
  });
  // Assert the invoke call was made with expected args
  expect(bridge.invocations).toContainEqual(
    expect.objectContaining({ functionKey: 'getText' })
  );
});
```

- `bridge.mockInvoke(key, value)` — registers a static response for `invoke(key)`. Pass a function for dynamic responses: `bridge.mockInvoke('getItem', (payload) => items[payload.id])`.
- `bridge.mockGetContext(context)` — sets what `view.getContext()` returns. Use this to provide extension config, cloud ID, etc.
- `bridge.reset()` — clears all mocks and resets context to defaults.

For product context, use `createFrontendContext()`:

```typescript
import { createFrontendContext } from '@forge/testing-framework';

test('renders with Jira context', () => {
  const ctx = createFrontendContext('jira:issuePanel');
  render(<App productContext={ctx} />);
  expect(screen.getByText('sample')).toBeDefined();
});
```

### Storage Tests

```typescript
test('stores and retrieves data', async () => {
  const result = await harness.invoke('saveItem', {
    payload: { key: 'item-1', value: 'hello' },
  });
  const stored = await harness.invoke('getItem', {
    payload: { key: 'item-1' },
  });
  expect(stored.data).toBe('hello');
});
```

## Test Harness

### How `invoke()` Maps to Your Resolver

The harness reads your `manifest.yml` to map `defineKey` → `functionKey` → `moduleType`, then builds a realistic context:

```
invoke('getIssueDetails')
  → manifest lookup: getIssueDetails is in function 'resolver'
  → function 'resolver' is used by jira:issuePanel
  → createBackendContext('jira:issuePanel') → merged with your overrides
  → calls handler with { payload, context, accountId }
```

Override any part: `harness.invoke('getIssueDetails', { payload: {...}, moduleType: 'jira:issuePanel', context: {...} })`.

## Contexts

Forge has two context shapes:

| Testing... | Function | Returns |
|---|---|---|
| UI (`useProductContext()`) | `createFrontendContext()` | `ProductContext` — `locale`, `timezone`, `extension` |
| Resolver (`req.context`) | `createBackendContext()` | `ResolverContext` — `accountType`, `installContext`, `extension` |

Both auto-populate module-specific `extension` data for 60+ module types.

**Overrides** — pass partials to customise:

```typescript
const ctx = createFrontendContext('jira:issueActivity', {
  extension: { issue: { key: 'BUG-456', type: 'Bug' } }
});
```

**Scenarios** — pre-configured contexts for common situations:

```typescript
import { listScenarios, createScenarioContext } from '@forge/testing-framework';

const scenarios = listScenarios('jira:issueActivity'); // ['bugReport', 'featureDevelopment', ...]
const ctx = createScenarioContext('jira:issueActivity', 'bugReport');
```

**Discovery:**

```typescript
import { getSupportedModules, isModuleSupported } from '@forge/testing-framework';
const modules = getSupportedModules(); // ['jira:issueActivity', 'macro', ...]
```

## API Mocking

60+ default fixtures return realistic responses with zero configuration across Jira Platform, Jira Software, Jira Service Management, and Confluence.

### Fixture Priority

1. **Per-test overrides** — `harness.addFixture()` (highest)
2. **User fixture files** — JSON in your `fixtures/` directory
3. **Programmatic handlers** — `harness.addFixtureHandler()`
4. **Built-in defaults** — realistic responses shipped with the framework

```typescript
// Per-test override
harness.addFixture('GET', '/rest/api/3/issue/TEST-1', {
  status: 200,
  body: { key: 'TEST-1', fields: { summary: 'Custom issue' } },
});

// Query-param-specific matching via handler
harness.addFixtureHandler((method, path) => {
  if (method === 'GET' && path.includes('statusCategory'))
    return { status: 200, body: { issues: [], total: 3 } };
});

// Disable defaults (errors on unmocked calls)
const harness = createTestHarness({ ..., fixtures: { useDefaults: false } });
```

### Fixture Files

Place JSON files in a `fixtures/` directory alongside your test. The filename pattern is `METHOD-path-segments.json`:

```
fixtures/
  GET-rest-api-3-search-jql.json → matches GET /rest/api/3/search/jql
  POST-rest-api-3-issue.json     → matches POST /rest/api/3/issue
```

### Strict Fixture Validation

With `strictFixtures: true`, fixture response bodies are validated against OpenAPI specs:

```typescript
const harness = createTestHarness({ ..., strictFixtures: true });
```

## Test Isolation

Call `harness.reset()` in `beforeEach` to clear all state between tests: API calls, fixture overrides, programmatic handlers, KVS storage, events queue, and ForgeReconciler rendered state. The framework uses singletons — your app's `import api from '@forge/api'` references the same `FakeApi` instance the harness controls.

For advanced scenarios, access singletons directly:

```typescript
import { _api, resetForgeApiShim } from '@forge/testing-framework';
expect(_api.apiCalls).toHaveLength(1);
```

## Debugging Test Failures

### `invoke()` returns `undefined` or wrong data

`invoke()` returns `{ data }` where `data` is the **raw return value** of your resolver function. If `result.data` is `undefined`, your resolver isn't returning a value. Check:

1. **Does your resolver explicitly `return` a value?** Async functions that don't return anything give `undefined`.
2. **Are the API fixtures matching?** Use `harness.apiCalls` to see what API calls your resolver made:

```typescript
const result = await harness.invoke('getWorkload', { payload: { projectKey: 'TEST' } });
// Debug: see all API calls the resolver made and whether fixtures matched
console.log('API calls:', harness.apiCalls);
// Each call shows: { method, path, status, responseBody }
```

3. **Are defaults matching correctly?** When built-in fixtures match, the test output shows log lines like:
   ```
   [test-harness] Using default fixture 'jira/issue.json' for GET /rest/api/3/issue/TEST-1
   ```
   If the wrong default is matching, add a specific fixture with `addFixture()` to override it.

### How fixtures connect to your resolver

When your resolver calls `api.asUser().requestJira(route`/rest/api/3/issue/${key}`)`, the framework intercepts this and looks up a fixture for `GET /rest/api/3/issue/TEST-1`. The `path` you pass to `addFixture` must match the path your resolver constructs with `route`:

```typescript
// If your resolver does:
const response = await api.asUser().requestJira(route`/rest/api/3/search/jql?jql=${jql}`);

// Then your fixture needs:
harness.addFixture('GET', '/rest/api/3/search/jql?jql=project%3DTEST', {
  status: 200,
  body: { issues: [{ key: 'TEST-1' }], total: 1 },
});
```

### Handler key mismatch

If you see: `Handler key 'index.handler' does not match any function defined in the manifest`

Open `manifest.yml` and find the `functions:` section:
```yaml
functions:
  - key: resolver        # ← Use THIS as your handler key
    handler: index.handler
```
Then use: `handlers: { 'resolver': handler }` — not `'index.handler'`.

## Common Pitfalls

### 1. Wrong `addFixture` call style

```typescript
// ❌ WRONG — object-style
harness.addFixture({ method: 'GET', path: '/rest/api/3/issue/TEST-1', body: { key: 'TEST-1' } });

// ✅ CORRECT — positional arguments
harness.addFixture('GET', '/rest/api/3/issue/TEST-1', { status: 200, body: { key: 'TEST-1' } });
```

### 2. Asserting on wrong `result` shape

```typescript
// If your resolver returns: return { success: true, items: [...] }
const result = await harness.invoke('getItems', { payload: {} });

// ❌ WRONG — result.success doesn't exist. data IS the return value.
expect(result.success).toBe(true);

// ✅ CORRECT — access through result.data
expect(result.data.success).toBe(true);
expect(result.data.items).toHaveLength(3);
```

### 3. Confluence property lookup — use query parameter, not path

```typescript
// ❌ WRONG — /properties/{key} expects a numeric property ID, not a string key
// This will return 400 at runtime
api.asUser().requestConfluence(route`/wiki/api/v2/pages/${pageId}/properties/${propertyKey}`);

// ✅ CORRECT — use the collection endpoint with a ?key= query parameter
api.asUser().requestConfluence(route`/wiki/api/v2/pages/${pageId}/properties?key=${propertyKey}`);
```

The test framework validates API paths against OpenAPI specs and will warn you in the test output if a path parameter type doesn't match (e.g. string where integer is expected).

## Platform Shims

All shims are configured via `moduleNameMapper` in `jest.config.cjs` — app code works unchanged.

| Shim | Key Features |
|------|-------------|
| `@forge/api` | `api.asApp().requestJira/Confluence()`, `route` template tag, `storage.get/set/delete` |
| `@forge/kvs` | Full KVS: get/set/delete, secrets, custom entities with index queries, transactions |
| `@forge/bridge` | `invoke()`, `view.getContext/getToken/refresh()`, `router`, `showFlag`, `Modal`, `events` |
| `@forge/react` | Stub UI Kit components with `data-testid="forge-{name}"`, behavioral props as `data-*` attributes (e.g., `isDisabled` → `data-isdisabled`), `ForgeReconciler.render()`, `xcss()`, `useProductContext()` |
| `@forge/resolver` | `Resolver.define()`, `getDefinitions()` — drop-in replacement |
| `@forge/events` | Async event queue with `emit()` and handlers via `resolver.define()` |

**Preview mode:** The bridge shim defaults to `cloudId: 'preview-mode'`. Override for live-mode testing: `bridge.setContext({ cloudId: 'real-cloud-id' })`.

## Web Triggers and Async Events

```typescript
import Resolver from '@forge/resolver';
const resolver = new Resolver();

// Async event handler
resolver.define('onIssueCreated', async (event) => {
  await storage.set(`issue-${event.payload.issueKey}`, event.payload);
});

// Test it
const harness = createTestHarness({ manifest: './manifest.yml', handlers: { 'webtrigger': resolver.getDefinitions() } });
const result = await harness.invoke('onIssueCreated', {
  payload: { issueKey: 'TEST-1' },
  context: createBackendContext('jira:globalPage'),
});
```

## OpenAPI Integration

Browse and validate against official Atlassian API specs:

```typescript
import { SpecLoader, listAPIs, generateFixture, validateFixture } from '@forge/testing-framework';

const loader = new SpecLoader({ specsDir: '.testing-framework/specs' });
const endpoints = listAPIs(loader, 'jira-platform');               // Browse available APIs
const fixture = generateFixture(loader, 'jira-platform', '/rest/api/3/issue/{issueIdOrKey}'); // Generate template
const result = validateFixture(loader, 'jira-platform', '/rest/api/3/issue/{issueIdOrKey}', myFixture); // Validate
```

## Testing First-Time Use (Cold Start)

Apps often work in preview mode but crash on first real use due to empty storage, empty content IDs, or preview-mode data leaking into live responses.

**Macro first insertion** — test with empty `content.id` (before the page is saved):

```typescript
const ctx = createScenarioContext('macro', 'macroFirstInsertion');
const result = await harness.invoke('getWorkflowState', {
  moduleType: 'macro',
  context: { extension: ctx.extension },
});
expect(result.data).toBeDefined(); // Should return a default state, not throw
```

**`validateColdStart()`** — automatically tests all resolvers with empty storage and live-mode context:

```typescript
const result = await harness.validateColdStart({
  defineKeys: ['getState', 'updateState', 'getUsers'],
  previewIndicators: ['preview-mode', 'MOCK_DATA'], // optional custom indicators
});
expect(result.passed).toBe(true);
for (const r of result.results) {
  expect(r.warnings).toEqual([]);
}
```

**Best practices:** Always test with empty storage. When fixing a bug class (e.g. empty `content.id`) in one resolver, apply the fix to all resolvers. Use real-looking context (`cloudId: 'test-cloud-id'`), not `'preview-mode'`.

## Jest / Vitest Configuration

The app template's `jest.config.cjs` includes `moduleNameMapper` entries that redirect all `@forge/*` imports to the framework shims. No additional setup is needed — just import and test.

For Vitest, add equivalent aliases in `vitest.config.ts`:

```typescript
resolve: {
  alias: {
    '@forge/api': '.testing-framework/dist/shims/forge-api',
    '@forge/bridge': '.testing-framework/dist/shims/forge-bridge',
    // ... etc
  }
}
```

---

## Feedback

Found a bug or need a feature? Contact the Studio App Builder team.
