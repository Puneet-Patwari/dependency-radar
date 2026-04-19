// Re-export all Forge UI types for convenient importing
export * from './forge-ui-types';

// Domain types for Dependency Radar

export type RiskLevel = 'CRITICAL' | 'HIGH' | 'MEDIUM' | 'LOW' | 'NONE';
export type DependencyType = 'CONFLICT' | 'SHARED_RESOURCE' | 'SEQUENTIAL' | 'DUPLICATE' | 'NONE';

/**
 * Represents a candidate issue that may be a hidden dependency.
 */
export interface CandidateIssue {
  /** Jira issue key, e.g. "PROJ-123" */
  key: string;
  /** Issue summary text */
  summary: string;
  /** Current issue status */
  status: string;
  /** Display name of the project */
  projectName: string;
  /** Cosine similarity score from Pinecone (0–1) */
  similarity: number;
  /** Risk level — from LLM analysis or derived from cosine thresholds */
  riskLevel: RiskLevel;
  /** Type of dependency relationship (LLM-provided, defaults to NONE) */
  dependencyType: DependencyType;
  /** LLM-generated explanation, absent when using cosine-only scoring */
  explanation?: string;
  /** Whether a link has been created in this session */
  isLinked: boolean;
}

/**
 * Response shape returned by the scanDependencies resolver.
 */
export interface ScanDependenciesResponse {
  success: boolean;
  candidates: CandidateIssue[];
  llmEnabled: boolean;
  error?: string;
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
