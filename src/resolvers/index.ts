import Resolver from '@forge/resolver';
import api, { route } from '@forge/api';
import type { CreateIssueLinkRequest, CreateIssueLinkResponse } from '../types';

// Basic type for Forge resolver request
interface ResolverRequest {
  payload?: unknown;
  context?: {
    accountId?: string;
    cloudId?: string;
    [key: string]: unknown;
  };
}

const resolver = new Resolver();

// Error logging resolver — used by the frontend error logging utility
resolver.define('logError', (req: ResolverRequest) => {
  const errorData = req.payload as {
    message: string;
    stack?: string;
    source?: string;
    lineno?: number;
    colno?: number;
    timestamp: string;
    userAgent?: string;
    url?: string;
  };

  // Log structured error data to Forge logging platform
  console.error('[Frontend Error]', {
    message: errorData.message,
    stack: errorData.stack,
    source: errorData.source,
    line: errorData.lineno,
    column: errorData.colno,
    timestamp: errorData.timestamp,
    userAgent: errorData.userAgent,
    url: errorData.url,
  });

  return { success: true };
});

// Creates a 'relates to' issue link between two Jira issues
resolver.define('createIssueLink', async (req: ResolverRequest): Promise<CreateIssueLinkResponse> => {
  const payload = req.payload as CreateIssueLinkRequest | undefined;

  const sourceIssueKey = payload?.sourceIssueKey;
  const targetIssueKey = payload?.targetIssueKey;

  console.log('[createIssueLink] Received request:', { sourceIssueKey, targetIssueKey });

  // Validate required fields
  if (!sourceIssueKey || typeof sourceIssueKey !== 'string') {
    console.log('[createIssueLink] Validation failed: missing sourceIssueKey');
    return { success: false, error: 'sourceIssueKey is required' };
  }

  if (!targetIssueKey || typeof targetIssueKey !== 'string') {
    console.log('[createIssueLink] Validation failed: missing targetIssueKey');
    return { success: false, error: 'targetIssueKey is required' };
  }

  try {
    console.log('[createIssueLink] Creating issue link from', sourceIssueKey, 'to', targetIssueKey);

    const response = await api.asUser().requestJira(route`/rest/api/3/issueLink`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        type: { name: 'Relates' },
        inwardIssue: { key: sourceIssueKey },
        outwardIssue: { key: targetIssueKey },
      }),
    });

    console.log('[createIssueLink] API response status:', response.status);

    if (response.status === 201) {
      console.log('[createIssueLink] Issue link created successfully');
      return { success: true };
    }

    // Handle non-201 responses
    let errorBody: string;
    try {
      errorBody = await response.text();
    } catch {
      errorBody = 'Could not read response body';
    }
    console.error('[createIssueLink] API error:', {
      status: response.status,
      body: errorBody,
    });
    return { success: false, error: 'Failed to create issue link' };
  } catch (error) {
    console.error('[createIssueLink] Unexpected error:', error);
    return { success: false, error: 'Failed to create issue link' };
  }
});

// Type assertion to avoid export naming issues
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const handler = resolver.getDefinitions() as any;
