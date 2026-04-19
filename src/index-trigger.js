import { kvs } from '@forge/kvs';
import { getDocumentEmbedding, composeIssueText } from './embeddings.js';
import { upsertVector } from './vectordb.js';

console.log('[index-trigger] Module loaded successfully');

/**
 * Extracts plain text from an ADF (Atlassian Document Format) node tree.
 *
 * @param {object|null|undefined} node
 * @returns {string}
 */
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

/**
 * Forge event trigger handler for `avi:jira:created:issue` and
 * `avi:jira:updated:issue`.
 */
export async function indexIssue(event, context) {
  console.log('[index-trigger] ▶ Handler invoked');
  console.log('[index-trigger] Event type:', typeof event);
  console.log('[index-trigger] Event keys:', event ? Object.keys(event) : 'null/undefined');
  console.log('[index-trigger] Event payload (truncated):', JSON.stringify(event)?.slice(0, 1000));

  if (context) {
    console.log('[index-trigger] Context keys:', Object.keys(context));
    console.log('[index-trigger] Context (truncated):', JSON.stringify(context)?.slice(0, 500));
  } else {
    console.log('[index-trigger] No context argument received');
  }

  try {
    const issue = event?.issue;
    console.log('[index-trigger] event.issue present:', !!issue);

    if (!issue) {
      console.warn('[index-trigger] Event has no "issue" property. Available top-level keys:', Object.keys(event || {}));
      console.warn('[index-trigger] Attempting fallback: checking event.body, event.data, event.event');
      const fallback = event?.body?.issue || event?.data?.issue || event?.event?.issue;
      if (fallback) {
        console.log('[index-trigger] Found issue under alternate path, keys:', Object.keys(fallback));
      } else {
        console.warn('[index-trigger] No issue found under any known path, aborting');
        return;
      }
    }

    const resolvedIssue = issue || event?.body?.issue || event?.data?.issue || event?.event?.issue;

    const issueKey = resolvedIssue.key;
    const fields = resolvedIssue.fields || {};

    console.log('[index-trigger] Issue key:', issueKey);
    console.log('[index-trigger] Fields keys:', Object.keys(fields));
    console.log('[index-trigger] Summary:', fields.summary?.slice(0, 100));
    console.log('[index-trigger] Project:', fields.project?.key);
    console.log('[index-trigger] Status:', fields.status?.name);
    console.log('[index-trigger] Updated:', fields.updated);
    console.log('[index-trigger] Description type:', typeof fields.description);

    const summary = fields.summary || '';
    const description = fields.description;
    const projectKey = fields.project?.key || '';
    const status = fields.status?.name || 'Unknown';
    const assignee = fields.assignee?.displayName || fields.assignee?.accountId || 'Unassigned';
    const updatedTimestamp = fields.updated || '';

    if (!issueKey) {
      console.warn('[index-trigger] No issueKey found, aborting');
      return;
    }

    // Cache check
    if (updatedTimestamp) {
      const cacheKey = `indexed:${issueKey}`;
      console.log('[index-trigger] Checking cache for:', cacheKey);
      const cached = await kvs.get(cacheKey);
      console.log('[index-trigger] Cached value:', cached, '| Current updated:', updatedTimestamp);
      if (cached === updatedTimestamp) {
        console.log('[index-trigger] Already indexed at this version, skipping:', issueKey);
        return;
      }
    } else {
      console.log('[index-trigger] No updated timestamp — will index without cache check');
    }

    const descriptionText = typeof description === 'string'
      ? description
      : extractTextFromAdf(description);
    const issueText = composeIssueText(summary, descriptionText);

    console.log('[index-trigger] Composed issue text length:', issueText.length);
    console.log('[index-trigger] Issue text preview:', issueText.slice(0, 200));

    if (!issueText) {
      console.log('[index-trigger] Issue has no text content, skipping:', issueKey);
      return;
    }

    // Step 1: Embed
    console.log('[index-trigger] Step 1/3: Calling Cohere embed for:', issueKey);
    const embedStart = Date.now();
    const embedding = await getDocumentEmbedding(issueText);
    console.log('[index-trigger] Embedding received, dimensions:', embedding?.length, 'time:', Date.now() - embedStart, 'ms');

    // Step 2: Upsert to Pinecone
    console.log('[index-trigger] Step 2/3: Upserting to Pinecone for:', issueKey);
    const upsertStart = Date.now();
    const upsertResult = await upsertVector(issueKey, embedding, {
      projectKey,
      issueKey,
      summary,
      status,
      assignee,
    });
    console.log('[index-trigger] Upsert complete, time:', Date.now() - upsertStart, 'ms, result:', JSON.stringify(upsertResult));

    // Step 3: Cache the timestamp
    if (updatedTimestamp) {
      console.log('[index-trigger] Step 3/3: Caching timestamp for:', issueKey);
      await kvs.set(`indexed:${issueKey}`, updatedTimestamp);
      console.log('[index-trigger] Cache updated');
    }

    console.log('[index-trigger] ✅ Successfully indexed:', issueKey);
  } catch (error) {
    console.error('[index-trigger] ❌ Failed to index issue:', error);
    console.error('[index-trigger] Error name:', error?.name);
    console.error('[index-trigger] Error message:', error?.message);
    console.error('[index-trigger] Error stack:', error?.stack);
  }
}
