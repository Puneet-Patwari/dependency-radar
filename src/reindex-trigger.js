import api, { route } from '@forge/api';
import { kvs } from '@forge/kvs';
import { getDocumentEmbedding, composeIssueText } from './embeddings.js';
import { upsertVector } from './vectordb.js';

const MAX_ISSUES = 500;

function extractTextFromAdf(node) {
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

function parseRequest(request) {
  let projects = [];
  let forceAll = true;

  const queryString = request.queryParameters || {};
  if (queryString.projects) {
    const raw = Array.isArray(queryString.projects)
      ? queryString.projects[0]
      : queryString.projects;
    projects = raw.split(',').map((p) => p.trim().toUpperCase()).filter(Boolean);
  }

  if (queryString.force) {
    const raw = Array.isArray(queryString.force) ? queryString.force[0] : queryString.force;
    forceAll = raw !== 'false';
  }

  if (request.body) {
    try {
      const body = JSON.parse(request.body);
      if (body.projects) {
        projects = Array.isArray(body.projects)
          ? body.projects.map((p) => p.trim().toUpperCase())
          : body.projects.split(',').map((p) => p.trim().toUpperCase());
      }
      if (typeof body.force === 'boolean') forceAll = body.force;
    } catch {
      // ignore parse errors, fall through to query params
    }
  }

  return { projects, forceAll };
}

function authenticateRequest(request) {
  const token = process.env.REINDEX_SECRET;
  if (!token) return true; // no secret configured = open (demo mode)

  const authHeader = (request.headers || {})['authorization'] || '';
  const queryToken = (request.queryParameters || {}).token;
  const providedToken = queryToken
    ? (Array.isArray(queryToken) ? queryToken[0] : queryToken)
    : authHeader.replace(/^Bearer\s+/i, '');

  return providedToken === token;
}

async function indexSingleIssue(issue, projectKey, forceAll) {
  const issueKey = issue.key;
  const fields = issue.fields || {};
  const summary = fields.summary || '';
  const description = fields.description;
  const status = fields.status?.name || 'Unknown';
  const assignee = fields.assignee?.displayName || fields.assignee?.accountId || 'Unassigned';
  const updatedTimestamp = fields.updated || '';

  if (!forceAll && updatedTimestamp) {
    const cached = await kvs.get(`indexed:${issueKey}`);
    if (cached === updatedTimestamp) return 'skipped';
  }

  const descriptionText = typeof description === 'string'
    ? description
    : extractTextFromAdf(description);
  const issueText = composeIssueText(summary, descriptionText);

  if (!issueText) return 'skipped';

  const embedding = await getDocumentEmbedding(issueText);
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

  return 'indexed';
}

export async function reindexWebTrigger(request) {
  console.log('[reindex-trigger] Invoked');
  console.log('[reindex-trigger] Request keys:', Object.keys(request || {}));
  console.log('[reindex-trigger] Query params:', JSON.stringify(request?.queryParameters));

  try {
    if (!authenticateRequest(request)) {
      return {
        statusCode: 401,
        headers: { 'Content-Type': ['application/json'] },
        body: JSON.stringify({ error: 'Unauthorized. Provide token via ?token= or Authorization header.' }),
      };
    }

    const { projects, forceAll } = parseRequest(request);

    if (projects.length === 0) {
      return {
        statusCode: 400,
        headers: { 'Content-Type': ['application/json'] },
        body: JSON.stringify({
          error: 'No projects specified.',
          usage: 'GET ?projects=KAN,AUT or POST {"projects": ["KAN","AUT"]}',
        }),
      };
    }

    console.log('[reindex-trigger] Projects:', projects, '| forceAll:', forceAll);

    const results = { total: 0, indexed: 0, skipped: 0, failed: 0, projects: {}, errors: [] };

    for (const projectKey of projects) {
      try {
        console.log(`[reindex-trigger] Starting ${projectKey}...`);
        results.projects[projectKey] = { total: 0, indexed: 0, skipped: 0, failed: 0 };

        const maxResults = 50;
        let nextPageToken = null;
        let pageCount = 0;
        let totalIssuesProcessed = 0;

        while (true) {
          pageCount++;
          const requestBody = {
            jql: `project = ${projectKey} ORDER BY updated DESC`,
            maxResults,
            fields: ['summary', 'description', 'project', 'status', 'assignee', 'updated'],
          };
          if (nextPageToken) {
            requestBody.nextPageToken = nextPageToken;
          }

          console.log(`[reindex-trigger] Fetching ${projectKey} page=${pageCount} token=${nextPageToken || 'first'}`);
          const searchResponse = await api.asApp().requestJira(
            route`/rest/api/3/search/jql`,
            {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify(requestBody),
            },
          );

          console.log(`[reindex-trigger] Response status: ${searchResponse.status}`);

          if (!searchResponse.ok) {
            const errText = await searchResponse.text().catch(() => 'unknown');
            console.error(`[reindex-trigger] Search failed for ${projectKey}:`, searchResponse.status, errText);
            results.errors.push(`Search failed for ${projectKey} page ${pageCount}: ${searchResponse.status} - ${errText}`);
            break;
          }

          const searchData = await searchResponse.json();
          const issues = searchData.issues || [];
          console.log(`[reindex-trigger] Got ${issues.length} issues, isLast=${searchData.isLast}, total=${searchData.total}`);

          if (issues.length === 0) break;

          totalIssuesProcessed += issues.length;

          if (pageCount === 1 && totalIssuesProcessed === 0) {
            console.log(`[reindex-trigger] No issues found for ${projectKey}`);
            break;
          }

          if (totalIssuesProcessed > MAX_ISSUES) {
            const msg = `Project ${projectKey} has >${MAX_ISSUES} issues. Stopping. Use a bulk pipeline for large projects.`;
            console.warn(`[reindex-trigger] ${msg}`);
            results.errors.push(msg);
            results.projects[projectKey].status = 'TOO_LARGE';
            break;
          }

          for (const issue of issues) {
            try {
              const outcome = await indexSingleIssue(issue, projectKey, forceAll);
              results.projects[projectKey][outcome]++;
              results[outcome]++;
              console.log(`[reindex-trigger] ${issue.key}: ${outcome}`);
            } catch (error) {
              results.projects[projectKey].failed++;
              results.failed++;
              results.errors.push(`${issue.key}: ${error.message}`);
              console.error(`[reindex-trigger] ❌ ${issue.key}:`, error.message);
            }
          }

          if (searchData.isLast || !searchData.nextPageToken) break;
          nextPageToken = searchData.nextPageToken;
        }

        results.projects[projectKey].total = totalIssuesProcessed;
        results.total += totalIssuesProcessed;
        console.log(`[reindex-trigger] ✅ ${projectKey} done:`, JSON.stringify(results.projects[projectKey]));
      } catch (projectError) {
        console.error(`[reindex-trigger] ❌ Unhandled error for project ${projectKey}:`, projectError?.message, projectError?.stack);
        results.errors.push(`${projectKey}: unhandled error - ${projectError?.message}`);
      }
    }

    console.log('[reindex-trigger] Complete:', JSON.stringify(results));
    const statusCode = results.errors.length > 0 ? 207 : 200;

    return {
      statusCode,
      headers: { 'Content-Type': ['application/json'] },
      body: JSON.stringify(results, null, 2),
    };
  } catch (error) {
    console.error('[reindex-trigger] ❌ Top-level error:', error?.message, error?.stack);
    return {
      statusCode: 500,
      headers: { 'Content-Type': ['application/json'] },
      body: JSON.stringify({ error: error?.message || 'Internal error' }),
    };
  }
}
