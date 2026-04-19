// Re-export all Forge UI types for convenient importing
export * from './forge-ui-types';

// Domain types for Dependency Radar

/**
 * Represents a candidate issue that may be a hidden dependency.
 */
export interface CandidateIssue {
  /** Jira issue key, e.g. "PROJ-123" */
  key: string;
  /** Issue summary text */
  summary: string;
  /** Display name of the project */
  projectName: string;
  /** Number of keywords matched (1, 2, or 3+) */
  matchCount: number;
  /** Match level label */
  matchLevel: 'High Match' | 'Medium Match' | 'Low Match';
  /** Whether a link has been created in this session */
  isLinked: boolean;
}

/**
 * Request payload for creating an issue link.
 */
export interface CreateIssueLinkRequest {
  /** Key of the current issue */
  sourceIssueKey: string;
  /** Key of the candidate issue to link */
  targetIssueKey: string;
}

/**
 * Response from the createIssueLink resolver.
 */
export interface CreateIssueLinkResponse {
  success: boolean;
  error?: string;
}
