import Resolver from '@forge/resolver';
import api, { route } from '@forge/api';
import { kvs } from '@forge/kvs';
import { getEmbedding, composeIssueText } from '../embeddings.js';
import { upsertVector, queryVectors } from '../vectordb.js';
import { analyzeDependencies, isLLMEnabled } from '../llm-provider.js';
import type {
  CandidateIssue,
  RiskLevel,
  DependencyType,
  ScanDependenciesResponse,
  CreateIssueLinkRequest,
  CreateIssueLinkResponse,
} from '../types';

interface ResolverRequest {
  payload?: unknown;
  context?: {
    accountId?: string;
    cloudId?: string;
    [key: string]: unknown;
  };
}

// ─── ADF → plain text ───────────────────────────────────────────────────────
interface AdfNode {
  type: string;
  text?: string;
  content?: AdfNode[];
}

function extractTextFromAdf(node: AdfNode | null | undefined): string {
  if (!node) return '';
  let result = '';
  if (node.text) result += node.text + ' ';
  if (node.content && Array.isArray(node.content)) {
    for (const child of node.content) {
      result += extractTextFromAdf(child);
    }
  }
  return result;
}

// ─── Cosine-threshold fallback ──────────────────────────────────────────────
function riskLevelFromScore(score: number): RiskLevel {
  if (score > 0.85) return 'CRITICAL';
  if (score > 0.70) return 'HIGH';
  if (score > 0.55) return 'MEDIUM';
  return 'LOW';
}

const resolver = new Resolver();

// ─── Error logging resolver ─────────────────────────────────────────────────
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

// ─── Scan dependencies (the full pipeline) ──────────────────────────────────
resolver.define('scanDependencies', async (req: ResolverRequest): Promise<ScanDependenciesResponse> => {
  const payload = req.payload as { issueKey?: string } | undefined;
  const issueKey = payload?.issueKey;

  if (!issueKey || typeof issueKey !== 'string') {
    return { success: false, candidates: [], llmEnabled: false, error: 'issueKey is required' };
  }

  try {
    // Step 1: Fetch current issue summary + description + existing links
    console.log('[scanDependencies] Fetching issue:', issueKey);
    const issueResp = await api.asApp().requestJira(
      route`/rest/api/3/issue/${issueKey}?fields=summary,description,project,status,updated,assignee,issuelinks`,
    );

    if (!issueResp.ok) {
      console.error('[scanDependencies] Failed to fetch issue, status:', issueResp.status);
      return { success: false, candidates: [], llmEnabled: false, error: 'Failed to fetch issue details' };
    }

    const issueData = await issueResp.json();
    const summary: string = issueData.fields?.summary || '';
    const description = issueData.fields?.description;
    const projectKey: string = issueData.fields?.project?.key || '';
    const statusName: string = issueData.fields?.status?.name || 'Unknown';
    const assignee: string = issueData.fields?.assignee?.displayName
      || issueData.fields?.assignee?.accountId || 'Unassigned';
    const updatedTimestamp: string = issueData.fields?.updated || '';
    const descriptionText = extractTextFromAdf(description as AdfNode);
    const issueText = composeIssueText(summary, descriptionText);

    // Build a set of already-linked issue keys
    const linkedKeys = new Set<string>();
    const issueLinks = issueData.fields?.issuelinks || [];
    for (const link of issueLinks) {
      if (link.inwardIssue?.key) linkedKeys.add(link.inwardIssue.key);
      if (link.outwardIssue?.key) linkedKeys.add(link.outwardIssue.key);
    }
    console.log('[scanDependencies] Existing linked issues:', [...linkedKeys]);

    if (!issueText) {
      return { success: true, candidates: [], llmEnabled: isLLMEnabled() };
    }

    // Step 2: Lazy backfill — embed & upsert if this version isn't cached yet
    let queryEmbedding: number[] | null = null;
    try {
      const cacheKey = `indexed:${issueKey}`;
      const cached = await kvs.get(cacheKey);
      const needsIndex = !cached || cached !== updatedTimestamp;

      if (needsIndex) {
        console.log('[scanDependencies] Backfilling index for:', issueKey);
        const docEmbedding: number[] = await getEmbedding(issueText, 'search_document');
        await upsertVector(issueKey, docEmbedding, {
          projectKey, issueKey, summary, status: statusName, assignee,
        });
        if (updatedTimestamp) {
          await kvs.set(cacheKey, updatedTimestamp);
        }
        console.log('[scanDependencies] Backfill complete for:', issueKey);
      } else {
        console.log('[scanDependencies] Issue already indexed at current version:', issueKey);
      }
    } catch (backfillErr) {
      console.warn('[scanDependencies] Non-critical: backfill failed:', backfillErr);
    }

    // Step 3: Generate search embedding for neighbor query
    console.log('[scanDependencies] Generating query embedding');
    queryEmbedding = await getEmbedding(issueText, 'search_query');

    // Step 4: Query Pinecone — exclude vectors from the same project
    console.log('[scanDependencies] Querying Pinecone for similar issues');
    const MIN_SIMILARITY = 0.40;
    const rawMatches: Array<{ id: string; score: number; metadata?: Record<string, string> }> =
      await queryVectors(queryEmbedding, 5, { projectKey: { $ne: projectKey } });

    console.log('[scanDependencies] Pinecone returned', rawMatches.length, 'raw matches:',
      rawMatches.map((m) => ({ key: m.id, score: m.score, similarity: Math.round(m.score * 100) + '%' })),
    );

    const matches = rawMatches.filter((m) => m.score >= MIN_SIMILARITY);
    console.log('[scanDependencies] After filtering (>=' + (MIN_SIMILARITY * 100) + '%):', matches.length, 'of', rawMatches.length, 'kept');

    if (matches.length === 0) {
      return { success: true, candidates: [], llmEnabled: isLLMEnabled() };
    }

    // Step 5: Hydrate matches with latest Jira data
    console.log('[scanDependencies] Hydrating', matches.length, 'matches from Jira');
    const matchKeys = matches.map((m) => m.id);
    const jql = `key in (${matchKeys.join(',')})`;
    const searchResp = await api.asApp().requestJira(
      route`/rest/api/3/search/jql`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          jql,
          maxResults: matches.length,
          fields: ['summary', 'project', 'status', 'description'],
        }),
      },
    );

    const hydrated: Record<string, { summary: string; projectName: string; status: string; description?: string }> = {};
    if (searchResp.ok) {
      const searchData = await searchResp.json();
      for (const issue of searchData.issues || []) {
        hydrated[issue.key] = {
          summary: issue.fields?.summary || '',
          projectName: issue.fields?.project?.name || issue.fields?.project?.key || '',
          status: issue.fields?.status?.name || 'Unknown',
          description: typeof issue.fields?.description === 'string'
            ? issue.fields.description
            : extractTextFromAdf(issue.fields?.description as AdfNode),
        };
      }
    } else {
      console.warn('[scanDependencies] Jira hydration failed, using Pinecone metadata');
    }

    // Build candidate list from matches + hydrated data (or Pinecone metadata fallback)
    const candidatesForLLM: Array<{ key: string; summary: string; score: number; description?: string }> = [];
    const scoreMap: Record<string, number> = {};

    for (const match of matches) {
      const jiraData = hydrated[match.id];
      const meta = match.metadata || {};
      scoreMap[match.id] = match.score;
      candidatesForLLM.push({
        key: match.id,
        summary: jiraData?.summary || meta.summary || match.id,
        score: match.score,
        description: jiraData?.description,
      });
    }

    // Step 6: LLM analysis or cosine-threshold fallback
    console.log('[scanDependencies] Running dependency analysis, llmEnabled:', isLLMEnabled());
    const llmResults = await analyzeDependencies(
      { key: issueKey, summary, description: descriptionText },
      candidatesForLLM,
    );

    const llmMap: Record<string, { riskLevel: RiskLevel; dependencyType: DependencyType; explanation: string }> = {};
    if (llmResults && Array.isArray(llmResults)) {
      for (const r of llmResults) {
        if (r.key) {
          llmMap[r.key] = {
            riskLevel: r.riskLevel as RiskLevel,
            dependencyType: r.dependencyType as DependencyType,
            explanation: r.explanation,
          };
        }
      }
    }

    // Step 7: Assemble final candidate list
    const candidates: CandidateIssue[] = matches.map((match) => {
      const jiraData = hydrated[match.id];
      const meta = match.metadata || {};
      const llm = llmMap[match.id];

      return {
        key: match.id,
        summary: jiraData?.summary || meta.summary || match.id,
        status: jiraData?.status || meta.status || 'Unknown',
        projectName: jiraData?.projectName || meta.projectKey || '',
        similarity: match.score,
        riskLevel: llm?.riskLevel || riskLevelFromScore(match.score),
        dependencyType: llm?.dependencyType || 'NONE',
        explanation: llm?.explanation,
        isLinked: linkedKeys.has(match.id),
      };
    });

    candidates.sort((a, b) => b.similarity - a.similarity);

    console.log('[scanDependencies] Returning', candidates.length, 'candidates:',
      candidates.map((c) => ({
        key: c.key,
        score: c.similarity,
        similarity: Math.round(c.similarity * 100) + '%',
        risk: c.riskLevel,
        type: c.dependencyType,
      })),
    );
    return { success: true, candidates, llmEnabled: isLLMEnabled() };
  } catch (error) {
    console.error('[scanDependencies] Pipeline error:', error);
    return { success: false, candidates: [], llmEnabled: false, error: 'Dependency scan failed' };
  }
});

// ─── Create issue link ──────────────────────────────────────────────────────
resolver.define('createIssueLink', async (req: ResolverRequest): Promise<CreateIssueLinkResponse> => {
  const payload = req.payload as CreateIssueLinkRequest | undefined;
  const sourceIssueKey = payload?.sourceIssueKey;
  const targetIssueKey = payload?.targetIssueKey;

  console.log('[createIssueLink] Received request:', { sourceIssueKey, targetIssueKey });

  if (!sourceIssueKey || typeof sourceIssueKey !== 'string') {
    return { success: false, error: 'sourceIssueKey is required' };
  }

  if (!targetIssueKey || typeof targetIssueKey !== 'string') {
    return { success: false, error: 'targetIssueKey is required' };
  }

  try {
    const response = await api.asUser().requestJira(route`/rest/api/3/issueLink`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        type: { name: 'Relates' },
        inwardIssue: { key: sourceIssueKey },
        outwardIssue: { key: targetIssueKey },
      }),
    });

    if (response.status === 201) {
      console.log('[createIssueLink] Issue link created successfully');
      return { success: true };
    }

    let errorBody: string;
    try {
      errorBody = await response.text();
    } catch {
      errorBody = 'Could not read response body';
    }
    console.error('[createIssueLink] API error:', { status: response.status, body: errorBody });
    return { success: false, error: 'Failed to create issue link' };
  } catch (error) {
    console.error('[createIssueLink] Unexpected error:', error);
    return { success: false, error: 'Failed to create issue link' };
  }
});

// ─── Bulk re-index ──────────────────────────────────────────────────────────
interface ReindexResult {
  success: boolean;
  total: number;
  indexed: number;
  skipped: number;
  failed: number;
  errors: string[];
}

resolver.define('reindexAll', async (req: ResolverRequest): Promise<ReindexResult> => {
  const payload = req.payload as { projectKey?: string; forceAll?: boolean } | undefined;
  const projectKey = payload?.projectKey;
  const forceAll = payload?.forceAll ?? true;

  if (!projectKey || typeof projectKey !== 'string') {
    return { success: false, total: 0, indexed: 0, skipped: 0, failed: 0, errors: ['projectKey is required'] };
  }

  console.log('[reindexAll] Starting bulk re-index', { projectKey, forceAll });

  const result: ReindexResult = { success: true, total: 0, indexed: 0, skipped: 0, failed: 0, errors: [] };
  let startAt = 0;
  const maxResults = 50;

  while (true) {
    const jql = `project = ${projectKey} ORDER BY updated DESC`;
    const searchResponse = await api.asUser().requestJira(
      route`/rest/api/3/search/jql`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          jql,
          startAt,
          maxResults,
          fields: ['summary', 'description', 'project', 'status', 'assignee', 'updated'],
        }),
      },
    );

    if (!searchResponse.ok) {
      const errText = await searchResponse.text().catch(() => 'unknown');
      console.error('[reindexAll] JQL search failed:', { status: searchResponse.status, body: errText });
      result.success = false;
      result.errors.push(`JQL search failed at offset ${startAt}: ${searchResponse.status}`);
      break;
    }

    const searchData = await searchResponse.json();
    const issues = searchData.issues || [];
    result.total = searchData.total ?? result.total;

    if (issues.length === 0) break;

    for (const issue of issues) {
      const issueKey: string = issue.key;
      const fields = issue.fields || {};
      const summary: string = fields.summary || '';
      const description = fields.description;
      const status: string = fields.status?.name || 'Unknown';
      const assignee: string = fields.assignee?.displayName || fields.assignee?.accountId || 'Unassigned';
      const updatedTimestamp: string = fields.updated || '';

      try {
        if (!forceAll && updatedTimestamp) {
          const cached = await kvs.get(`indexed:${issueKey}`);
          if (cached === updatedTimestamp) {
            result.skipped++;
            continue;
          }
        }

        const descriptionText = extractTextFromAdf(description as AdfNode);
        const issueText = composeIssueText(summary, descriptionText);

        if (!issueText) {
          result.skipped++;
          continue;
        }

        const embedding = await getEmbedding(issueText, 'search_document');
        await upsertVector(issueKey, embedding, {
          projectKey: fields.project?.key || projectKey,
          issueKey,
          summary,
          status,
          assignee,
        });

        if (updatedTimestamp) {
          await kvs.set(`indexed:${issueKey}`, updatedTimestamp);
        }

        result.indexed++;
        console.log(`[reindexAll] ✅ ${issueKey} (${result.indexed}/${result.total})`);
      } catch (error) {
        result.failed++;
        const msg = `${issueKey}: ${(error as Error).message}`;
        result.errors.push(msg);
        console.error(`[reindexAll] ❌ ${msg}`);
      }
    }

    startAt += issues.length;
    if (startAt >= (searchData.total ?? 0)) break;
  }

  console.log('[reindexAll] Complete:', result);
  return result;
});

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const handler = resolver.getDefinitions() as any;
