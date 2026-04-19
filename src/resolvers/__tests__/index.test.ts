import { createTestHarness } from '@forge/testing-framework';
import { handler } from '../index';
import type { CreateIssueLinkResponse } from '../../types';

const harness = createTestHarness({ manifest: './manifest.yml', handlers: { resolver: handler } });

beforeEach(() => {
  harness.reset();
});

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

    // Verify the request body contains the correct issue keys and link type
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
