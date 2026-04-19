import { createTestHarness } from '@forge/testing-framework';
import { getEmbedding } from '../../embeddings.js';
import { upsertVector, queryVectors } from '../../vectordb.js';
import { analyzeDependencies, isLLMEnabled } from '../../llm-provider.js';

jest.mock('../../embeddings.js', () => ({
  getEmbedding: jest.fn(),
  composeIssueText: jest.fn((summary, desc) => `${summary} ${desc}`.trim()),
}));
jest.mock('../../vectordb.js', () => ({
  upsertVector: jest.fn(),
  queryVectors: jest.fn(),
}));
jest.mock('../../llm-provider.js', () => ({
  analyzeDependencies: jest.fn(),
  isLLMEnabled: jest.fn(),
}));

import { handler } from '../index';
import type { ScanDependenciesResponse, CreateIssueLinkResponse } from '../../types';

const mockGetEmbedding = getEmbedding as jest.Mock;
const mockUpsertVector = upsertVector as jest.Mock;
const mockQueryVectors = queryVectors as jest.Mock;
const mockAnalyzeDependencies = analyzeDependencies as jest.Mock;
const mockIsLLMEnabled = isLLMEnabled as jest.Mock;

const harness = createTestHarness({ manifest: './manifest.yml', handlers: { resolver: handler } });

const FAKE_EMBEDDING = new Array(1024).fill(0.1);

beforeEach(() => {
  harness.reset();
  mockGetEmbedding.mockReset();
  mockUpsertVector.mockReset();
  mockQueryVectors.mockReset();
  mockAnalyzeDependencies.mockReset();
  mockIsLLMEnabled.mockReset();

  mockGetEmbedding.mockResolvedValue(FAKE_EMBEDDING);
  mockUpsertVector.mockResolvedValue({});
  mockQueryVectors.mockResolvedValue([]);
  mockAnalyzeDependencies.mockResolvedValue(null);
  mockIsLLMEnabled.mockReturnValue(false);
});

// ─── Helper to add Jira issue fixture ────────────────────────────────────────

function addIssueFetchFixture(issueKey = 'TEST-1', fieldOverrides: Record<string, unknown> = {}) {
  harness.addFixture('GET', `/rest/api/3/issue/${issueKey}`, {
    status: 200,
    body: {
      key: issueKey,
      fields: {
        summary: 'Database connection timeout',
        description: {
          type: 'doc',
          content: [
            { type: 'paragraph', content: [{ type: 'text', text: 'Pool exhaustion under load' }] },
          ],
        },
        project: { key: 'TEST' },
        status: { name: 'In Progress' },
        updated: '2026-01-15T10:00:00.000Z',
        assignee: { displayName: 'Jane Doe', accountId: '12345' },
        ...fieldOverrides,
      },
    },
  });
}

// ─── scanDependencies resolver ───────────────────────────────────────────────

describe('scanDependencies resolver', () => {
  it('returns error when issueKey is missing', async () => {
    const result = await harness.invoke<ScanDependenciesResponse>('scanDependencies', {
      payload: {},
    });

    expect(result.data.success).toBe(false);
    expect(result.data.error).toBe('issueKey is required');
    expect(result.data.candidates).toEqual([]);
  });

  it('returns error when issueKey is not a string', async () => {
    const result = await harness.invoke<ScanDependenciesResponse>('scanDependencies', {
      payload: { issueKey: 123 },
    });

    expect(result.data.success).toBe(false);
    expect(result.data.error).toBe('issueKey is required');
  });

  it('returns error when Jira issue fetch fails', async () => {
    harness.addFixture('GET', '/rest/api/3/issue/NOPE-1', {
      status: 404,
      body: { errorMessages: ['Issue not found'] },
    });

    const result = await harness.invoke<ScanDependenciesResponse>('scanDependencies', {
      payload: { issueKey: 'NOPE-1' },
    });

    expect(result.data.success).toBe(false);
    expect(result.data.error).toBe('Failed to fetch issue details');
  });

  it('returns empty candidates when issue text is empty', async () => {
    addIssueFetchFixture('TEST-1', { summary: '', description: null });

    const result = await harness.invoke<ScanDependenciesResponse>('scanDependencies', {
      payload: { issueKey: 'TEST-1' },
    });

    expect(result.data.success).toBe(true);
    expect(result.data.candidates).toEqual([]);
    expect(mockGetEmbedding).not.toHaveBeenCalled();
  });

  it('returns empty candidates when Pinecone has no matches', async () => {
    addIssueFetchFixture();
    mockQueryVectors.mockResolvedValue([]);

    const result = await harness.invoke<ScanDependenciesResponse>('scanDependencies', {
      payload: { issueKey: 'TEST-1' },
    });

    expect(result.data.success).toBe(true);
    expect(result.data.candidates).toEqual([]);
    expect(mockGetEmbedding).toHaveBeenCalledWith(
      expect.stringContaining('Database connection timeout'),
      'search_document',
    );
    expect(mockGetEmbedding).toHaveBeenCalledWith(
      expect.stringContaining('Database connection timeout'),
      'search_query',
    );
    expect(mockUpsertVector).toHaveBeenCalledTimes(1);
  });

  it('embeds, upserts, queries, hydrates, and returns candidates', async () => {
    addIssueFetchFixture();

    mockQueryVectors.mockResolvedValue([
      { id: 'INFRA-10', score: 0.88, metadata: { summary: 'DB timeout', projectKey: 'INFRA', status: 'Open' } },
      { id: 'PERF-5', score: 0.60, metadata: { summary: 'Latency', projectKey: 'PERF', status: 'Open' } },
    ]);

    harness.addFixture('POST', '/rest/api/3/search/jql', {
      status: 200,
      body: {
        issues: [
          {
            key: 'INFRA-10',
            fields: {
              summary: 'Database timeout in infra',
              project: { key: 'INFRA', name: 'Infrastructure' },
              status: { name: 'Open' },
              description: null,
            },
          },
          {
            key: 'PERF-5',
            fields: {
              summary: 'Connection latency report',
              project: { key: 'PERF', name: 'Performance' },
              status: { name: 'In Review' },
              description: null,
            },
          },
        ],
      },
    });

    const result = await harness.invoke<ScanDependenciesResponse>('scanDependencies', {
      payload: { issueKey: 'TEST-1' },
    });

    expect(result.data.success).toBe(true);
    expect(result.data.candidates).toHaveLength(2);

    // Sorted by similarity descending
    expect(result.data.candidates[0].key).toBe('INFRA-10');
    expect(result.data.candidates[0].summary).toBe('Database timeout in infra');
    expect(result.data.candidates[0].projectName).toBe('Infrastructure');
    expect(result.data.candidates[0].similarity).toBe(0.88);
    expect(result.data.candidates[0].riskLevel).toBe('CRITICAL'); // 0.88 > 0.85

    expect(result.data.candidates[1].key).toBe('PERF-5');
    expect(result.data.candidates[1].riskLevel).toBe('MEDIUM'); // 0.60 > 0.55

    // Verify upsert was called with issue metadata
    expect(mockUpsertVector).toHaveBeenCalledWith(
      'TEST-1',
      FAKE_EMBEDDING,
      expect.objectContaining({
        projectKey: 'TEST',
        issueKey: 'TEST-1',
        summary: 'Database connection timeout',
        status: 'In Progress',
        assignee: 'Jane Doe',
      }),
    );

    // Verify Pinecone was queried with cross-project filter
    expect(mockQueryVectors).toHaveBeenCalledWith(
      FAKE_EMBEDDING,
      5,
      { projectKey: { $ne: 'TEST' } },
    );
  });

  it('uses Pinecone metadata as fallback when Jira hydration fails', async () => {
    addIssueFetchFixture();

    mockQueryVectors.mockResolvedValue([
      { id: 'OTHER-1', score: 0.72, metadata: { summary: 'Fallback summary', projectKey: 'OTHER', status: 'To Do' } },
    ]);

    harness.addFixture('POST', '/rest/api/3/search/jql', {
      status: 500,
      body: { errorMessages: ['Internal error'] },
    });

    const result = await harness.invoke<ScanDependenciesResponse>('scanDependencies', {
      payload: { issueKey: 'TEST-1' },
    });

    expect(result.data.success).toBe(true);
    expect(result.data.candidates).toHaveLength(1);
    expect(result.data.candidates[0].summary).toBe('Fallback summary');
    expect(result.data.candidates[0].projectName).toBe('OTHER');
    expect(result.data.candidates[0].status).toBe('To Do');
  });

  it('applies LLM analysis results when available', async () => {
    addIssueFetchFixture();
    mockIsLLMEnabled.mockReturnValue(true);

    mockQueryVectors.mockResolvedValue([
      { id: 'SEC-5', score: 0.75, metadata: { summary: 'Auth tokens', projectKey: 'SEC', status: 'Open' } },
    ]);

    harness.addFixture('POST', '/rest/api/3/search/jql', {
      status: 200,
      body: {
        issues: [{
          key: 'SEC-5',
          fields: {
            summary: 'Token refresh needs retry logic',
            project: { key: 'SEC', name: 'Security' },
            status: { name: 'Open' },
            description: null,
          },
        }],
      },
    });

    mockAnalyzeDependencies.mockResolvedValue([
      {
        key: 'SEC-5',
        riskLevel: 'HIGH',
        dependencyType: 'CONFLICT',
        explanation: 'Auth token expiry blocks downstream services.',
      },
    ]);

    const result = await harness.invoke<ScanDependenciesResponse>('scanDependencies', {
      payload: { issueKey: 'TEST-1' },
    });

    expect(result.data.success).toBe(true);
    expect(result.data.llmEnabled).toBe(true);
    expect(result.data.candidates[0].riskLevel).toBe('HIGH');
    expect(result.data.candidates[0].dependencyType).toBe('CONFLICT');
    expect(result.data.candidates[0].explanation).toBe('Auth token expiry blocks downstream services.');
  });

  it('falls back to cosine scoring when LLM returns null', async () => {
    addIssueFetchFixture();
    mockIsLLMEnabled.mockReturnValue(false);
    mockAnalyzeDependencies.mockResolvedValue(null);

    mockQueryVectors.mockResolvedValue([
      { id: 'X-1', score: 0.90, metadata: { summary: 'High sim', projectKey: 'X', status: 'Open' } },
    ]);

    harness.addFixture('POST', '/rest/api/3/search/jql', {
      status: 200,
      body: {
        issues: [{
          key: 'X-1',
          fields: {
            summary: 'High similarity match',
            project: { key: 'X', name: 'TeamX' },
            status: { name: 'Open' },
            description: null,
          },
        }],
      },
    });

    const result = await harness.invoke<ScanDependenciesResponse>('scanDependencies', {
      payload: { issueKey: 'TEST-1' },
    });

    expect(result.data.candidates[0].riskLevel).toBe('CRITICAL'); // 0.90 > 0.85
    expect(result.data.candidates[0].dependencyType).toBe('NONE');
    expect(result.data.candidates[0].explanation).toBeUndefined();
    expect(result.data.llmEnabled).toBe(false);
  });

  it('handles backfill failure gracefully and continues the pipeline', async () => {
    addIssueFetchFixture();
    mockGetEmbedding
      .mockRejectedValueOnce(new Error('Cohere API down'))  // backfill embed fails
      .mockResolvedValueOnce(FAKE_EMBEDDING);               // query embed succeeds

    mockQueryVectors.mockResolvedValue([]);

    const result = await harness.invoke<ScanDependenciesResponse>('scanDependencies', {
      payload: { issueKey: 'TEST-1' },
    });

    expect(result.data.success).toBe(true);
    expect(result.data.candidates).toEqual([]);
    // Pipeline continued past the backfill failure
    expect(mockQueryVectors).toHaveBeenCalled();
  });

  it('returns pipeline error when query embedding fails', async () => {
    addIssueFetchFixture();
    mockGetEmbedding
      .mockResolvedValueOnce(FAKE_EMBEDDING)    // backfill succeeds
      .mockRejectedValueOnce(new Error('boom')); // query embed fails

    const result = await harness.invoke<ScanDependenciesResponse>('scanDependencies', {
      payload: { issueKey: 'TEST-1' },
    });

    expect(result.data.success).toBe(false);
    expect(result.data.error).toBe('Dependency scan failed');
  });

  it('skips backfill when issue is already indexed at current version', async () => {
    addIssueFetchFixture('TEST-1', { updated: '2026-01-15T10:00:00.000Z' });

    // Pre-populate the cache with the same timestamp
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { kvs } = require('@forge/kvs');
    await kvs.set('indexed:TEST-1', '2026-01-15T10:00:00.000Z');

    mockQueryVectors.mockResolvedValue([]);

    await harness.invoke<ScanDependenciesResponse>('scanDependencies', {
      payload: { issueKey: 'TEST-1' },
    });

    // Backfill was skipped — upsert not called
    expect(mockUpsertVector).not.toHaveBeenCalled();
    // Only the query embedding was generated (not the document embedding)
    expect(mockGetEmbedding).toHaveBeenCalledTimes(1);
    expect(mockGetEmbedding).toHaveBeenCalledWith(
      expect.any(String),
      'search_query',
    );
  });
});

// ─── createIssueLink resolver ────────────────────────────────────────────────

describe('createIssueLink resolver', () => {
  it('should successfully create an issue link', async () => {
    harness.addFixture('POST', '/rest/api/3/issueLink', {
      status: 201,
      body: {},
    });

    const result = await harness.invoke<CreateIssueLinkResponse>('createIssueLink', {
      payload: { sourceIssueKey: 'PROJ-1', targetIssueKey: 'PROJ-2' },
    });

    expect(result.data.success).toBe(true);
    expect(result.data.error).toBeUndefined();
  });

  it('should return error when Jira API fails with 500', async () => {
    harness.addFixture('POST', '/rest/api/3/issueLink', {
      status: 500,
      body: { errorMessages: ['Internal server error'] },
    });

    const result = await harness.invoke<CreateIssueLinkResponse>('createIssueLink', {
      payload: { sourceIssueKey: 'PROJ-1', targetIssueKey: 'PROJ-2' },
    });

    expect(result.data.success).toBe(false);
    expect(result.data.error).toBe('Failed to create issue link');
  });

  it('should return error when sourceIssueKey is missing', async () => {
    const result = await harness.invoke<CreateIssueLinkResponse>('createIssueLink', {
      payload: { targetIssueKey: 'PROJ-2' },
    });

    expect(result.data.success).toBe(false);
    expect(result.data.error).toBe('sourceIssueKey is required');
  });

  it('should return error when targetIssueKey is missing', async () => {
    const result = await harness.invoke<CreateIssueLinkResponse>('createIssueLink', {
      payload: { sourceIssueKey: 'PROJ-1' },
    });

    expect(result.data.success).toBe(false);
    expect(result.data.error).toBe('targetIssueKey is required');
  });

  it('should return error when both keys are missing', async () => {
    const result = await harness.invoke<CreateIssueLinkResponse>('createIssueLink', {
      payload: {},
    });

    expect(result.data.success).toBe(false);
    expect(result.data.error).toBe('sourceIssueKey is required');
  });

  it('should make the correct API call with proper payload', async () => {
    harness.addFixture('POST', '/rest/api/3/issueLink', {
      status: 201,
      body: {},
    });

    await harness.invoke<CreateIssueLinkResponse>('createIssueLink', {
      payload: { sourceIssueKey: 'ABC-10', targetIssueKey: 'XYZ-20' },
    });

    const linkCall = harness.apiCalls.find(
      (c) => c.method === 'POST' && c.path.includes('/issueLink'),
    );
    expect(linkCall).toBeDefined();
    expect(linkCall!.path).toContain('/rest/api/3/issueLink');

    const body = typeof linkCall!.body === 'string' ? JSON.parse(linkCall!.body) : linkCall!.body;
    expect(body.type.name).toBe('Relates');
    expect(body.inwardIssue.key).toBe('ABC-10');
    expect(body.outwardIssue.key).toBe('XYZ-20');
  });

  it('should handle API returning 400 (bad request)', async () => {
    harness.addFixture('POST', '/rest/api/3/issueLink', {
      status: 400,
      body: { errorMessages: ['Issue does not exist'] },
    });

    const result = await harness.invoke<CreateIssueLinkResponse>('createIssueLink', {
      payload: { sourceIssueKey: 'PROJ-1', targetIssueKey: 'INVALID-999' },
    });

    expect(result.data.success).toBe(false);
    expect(result.data.error).toBe('Failed to create issue link');
  });
});

// ─── logError resolver ───────────────────────────────────────────────────────

describe('logError resolver', () => {
  it('should log error data and return success', async () => {
    const result = await harness.invoke<{ success: boolean }>('logError', {
      payload: {
        message: 'Test error',
        stack: 'Error: Test error\n    at test.ts:1',
        timestamp: '2026-01-01T00:00:00.000Z',
      },
    });

    expect(result.data.success).toBe(true);
  });
});
