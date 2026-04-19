import { fetch } from '@forge/api';

const DEFAULT_NAMESPACE = 'issues';

function getConfig() {
  const apiKey = process.env.PINECONE_API_KEY;
  if (!apiKey) {
    throw new Error(
      'PINECONE_API_KEY environment variable is not set. ' +
        'Use `forge variables set PINECONE_API_KEY <key>` to configure it.',
    );
  }

  const host = process.env.PINECONE_HOST;
  if (!host) {
    throw new Error(
      'PINECONE_HOST environment variable is not set. ' +
        'Use `forge variables set PINECONE_HOST <your-index-host>` to configure it.',
    );
  }

  const baseUrl = host.startsWith('https://') ? host : `https://${host}`;
  const namespace = process.env.PINECONE_NAMESPACE || DEFAULT_NAMESPACE;
  return { apiKey, baseUrl, namespace };
}

/**
 * Upserts a single vector with issue metadata into the Pinecone index.
 *
 * @param {string} id - Unique vector ID (e.g. issueKey).
 * @param {number[]} vector - Embedding vector (1024 dimensions).
 * @param {{ projectKey: string, issueKey: string, summary: string, status: string, assignee: string }} metadata
 * @returns {Promise<object>} Pinecone upsert response.
 */
async function upsertVector(id, vector, metadata) {
  if (!id || typeof id !== 'string') {
    throw new Error('id must be a non-empty string');
  }
  if (!Array.isArray(vector) || vector.length === 0) {
    throw new Error('vector must be a non-empty array of numbers');
  }
  if (!metadata || typeof metadata !== 'object') {
    throw new Error('metadata must be a non-null object');
  }

  const { apiKey, baseUrl, namespace } = getConfig();

  console.log('[vectordb] Upserting vector', {
    id,
    dimensions: vector.length,
    namespace,
    baseUrl,
    apiKeyPresent: !!apiKey,
    apiKeyPrefix: apiKey?.slice(0, 6) + '...',
  });

  const response = await fetch(`${baseUrl}/vectors/upsert`, {
    method: 'POST',
    headers: {
      'Api-Key': apiKey,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      vectors: [{ id, values: vector, metadata }],
      namespace,
    }),
  });

  if (!response.ok) {
    let errorBody;
    try {
      errorBody = await response.text();
    } catch {
      errorBody = 'Could not read response body';
    }
    console.error('[vectordb] Pinecone upsert error:', {
      status: response.status,
      body: errorBody,
    });
    throw new Error(`Pinecone upsert failed with status ${response.status}`);
  }

  return response.json();
}

/**
 * Queries the Pinecone index for the top-K nearest neighbors,
 * excluding vectors from the current project.
 *
 * @param {number[]} vector - Query embedding vector.
 * @param {number} topK - Number of results to return.
 * @param {{ projectKey: { $ne: string } }} filter - Metadata filter
 *   (typically `{ projectKey: { $ne: currentProject } }`).
 * @returns {Promise<Array<{ id: string, score: number, metadata: object }>>} Matched vectors.
 */
async function queryVectors(vector, topK = 10, filter = {}) {
  if (!Array.isArray(vector) || vector.length === 0) {
    throw new Error('vector must be a non-empty array of numbers');
  }
  if (typeof topK !== 'number' || topK < 1) {
    throw new Error('topK must be a positive integer');
  }

  const { apiKey, baseUrl, namespace } = getConfig();

  console.log('[vectordb] Querying vectors', {
    dimensions: vector.length,
    topK,
    filter,
    namespace,
    baseUrl,
    apiKeyPresent: !!apiKey,
  });

  const response = await fetch(`${baseUrl}/query`, {
    method: 'POST',
    headers: {
      'Api-Key': apiKey,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      vector,
      topK,
      filter,
      includeMetadata: true,
      namespace,
    }),
  });

  if (!response.ok) {
    let errorBody;
    try {
      errorBody = await response.text();
    } catch {
      errorBody = 'Could not read response body';
    }
    console.error('[vectordb] Pinecone query error:', {
      status: response.status,
      body: errorBody,
    });
    throw new Error(`Pinecone query failed with status ${response.status}`);
  }

  const data = await response.json();
  return data.matches || [];
}

export { upsertVector, queryVectors };
