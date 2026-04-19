import { createTestHarness } from '@forge/testing-framework';
import { handler } from '../resolvers';
import type { CreateIssueLinkResponse } from '../types';

const harness = createTestHarness({ manifest: './manifest.yml', handlers: { resolver: handler } });

beforeEach(() => {
  harness.reset();
});

describe('Dependency Radar - Integration', () => {
  describe('createIssueLink flow', () => {
    it('should create an issue link end-to-end', async () => {
      harness.addFixture('POST', '/rest/api/3/issueLink', {
        status: 201,
        body: {},
      });

      const result = await harness.invoke<CreateIssueLinkResponse>('createIssueLink', {
        payload: { sourceIssueKey: 'DEP-1', targetIssueKey: 'DEP-2' },
      });

      expect(result.data.success).toBe(true);

      // Verify the API was called
      const apiCall = harness.apiCalls.find(
        (c) => c.method === 'POST' && c.path.includes('/issueLink'),
      );
      expect(apiCall).toBeDefined();
    });

    it('should handle linking failure gracefully', async () => {
      harness.addFixture('POST', '/rest/api/3/issueLink', {
        status: 403,
        body: { errorMessages: ['You do not have permission to link issues'] },
      });

      const result = await harness.invoke<CreateIssueLinkResponse>('createIssueLink', {
        payload: { sourceIssueKey: 'DEP-1', targetIssueKey: 'DEP-2' },
      });

      expect(result.data.success).toBe(false);
      expect(result.data.error).toBeDefined();
    });

    it('should reject invalid input before making API calls', async () => {
      const result = await harness.invoke<CreateIssueLinkResponse>('createIssueLink', {
        payload: {},
      });

      expect(result.data.success).toBe(false);
      // No API calls should have been made for invalid input
      const linkCalls = harness.apiCalls.filter(
        (c) => c.method === 'POST' && c.path.includes('/issueLink'),
      );
      expect(linkCalls).toHaveLength(0);
    });
  });

  describe('Cold start', () => {
    it('all resolvers should handle empty storage without errors', async () => {
      harness.reset(); // Ensures storage is empty

      // createIssueLink should still work with valid input
      harness.addFixture('POST', '/rest/api/3/issueLink', {
        status: 201,
        body: {},
      });

      const linkResult = await harness.invoke<CreateIssueLinkResponse>('createIssueLink', {
        payload: { sourceIssueKey: 'COLD-1', targetIssueKey: 'COLD-2' },
      });
      expect(linkResult.data.success).toBe(true);

      // logError should work on cold start
      const logResult = await harness.invoke<{ success: boolean }>('logError', {
        payload: { message: 'Cold start error test', timestamp: '2026-01-01T00:00:00.000Z' },
      });
      expect(logResult.data.success).toBe(true);
    });
  });
});
