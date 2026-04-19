import { fetch } from '@forge/api';

const COHERE_EMBED_URL = 'https://api.cohere.ai/v1/embed';
const MODEL = 'embed-english-v3.0';
const EMBEDDING_DIMENSION = 1024;

function getApiKey() {
  const key = process.env.COHERE_API_KEY;
  if (!key) {
    throw new Error(
      'COHERE_API_KEY environment variable is not set. ' +
        'Use `forge variables set COHERE_API_KEY <key>` to configure it.',
    );
  }
  return key;
}

/**
 * Calls the Cohere Embed API and returns a 1024-dimension float embedding.
 *
 * @param {string} text - The text to embed (e.g. issue summary + description).
 * @param {'search_document' | 'search_query'} inputType
 *   Use 'search_document' when indexing content, 'search_query' when querying.
 * @returns {Promise<number[]>} 1024-dimension embedding vector.
 */
async function getEmbedding(text, inputType = 'search_document') {
  if (!text || typeof text !== 'string') {
    throw new Error('text must be a non-empty string');
  }

  if (inputType !== 'search_document' && inputType !== 'search_query') {
    throw new Error(
      `Invalid input_type: ${inputType}. Must be 'search_document' or 'search_query'.`,
    );
  }

  const apiKey = getApiKey();

  console.log('[embeddings] Requesting embedding', {
    model: MODEL,
    inputType,
    textLength: text.length,
    apiKeyPresent: !!apiKey,
    apiKeyPrefix: apiKey?.slice(0, 6) + '...',
  });

  const response = await fetch(COHERE_EMBED_URL, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      texts: [text],
      model: MODEL,
      input_type: inputType,
      embedding_types: ['float'],
    }),
  });

  if (!response.ok) {
    let errorBody;
    try {
      errorBody = await response.text();
    } catch {
      errorBody = 'Could not read response body';
    }
    console.error('[embeddings] Cohere API error:', {
      status: response.status,
      body: errorBody,
    });
    throw new Error(`Cohere API request failed with status ${response.status}`);
  }

  const data = await response.json();
  const embedding = data.embeddings?.float?.[0];

  if (!embedding || embedding.length !== EMBEDDING_DIMENSION) {
    console.error('[embeddings] Unexpected response shape:', JSON.stringify(data).slice(0, 500));
    throw new Error(
      `Expected ${EMBEDDING_DIMENSION}-dimension embedding, got ${embedding?.length ?? 'none'}`,
    );
  }

  return embedding;
}

/**
 * Extracts technical identifiers from text to front-load key signals
 * that the embedding model should weight heavily.
 *
 * @param {string} text
 * @returns {string[]}
 */
function extractKeyTerms(text) {
  const terms = new Set();

  // API paths: /api/v2/auth, /rest/api/3/issue
  const apiPaths = text.match(/\/[a-zA-Z0-9/._-]{3,}/g) || [];
  apiPaths.forEach((p) => terms.add(p));

  // Version references: v2, v3, OAuth2.0
  const versions = text.match(/\b[vV]\d+(\.\d+)?\b|OAuth\d+(\.\d+)?/g) || [];
  versions.forEach((v) => terms.add(v));

  // Package-style names: @forge/api, @scope/name
  const packages = text.match(/@[\w-]+\/[\w-]+/g) || [];
  packages.forEach((p) => terms.add(p));

  // Technical compound terms: camelCase, PascalCase identifiers
  const camelCase = text.match(/\b[a-z]+[A-Z][a-zA-Z]{2,}\b/g) || [];
  camelCase.forEach((t) => terms.add(t));

  return [...terms];
}

/**
 * Composes a structured text representation for embedding.
 *
 * Produces a format that front-loads the summary and key technical terms
 * so the embedding model gives them stronger signal weight. The summary
 * is repeated at the end to anchor the vector around the core topic.
 *
 * @param {string} summary - Issue title / summary.
 * @param {string} description - Plain-text description (already extracted from ADF).
 * @returns {string}
 */
function composeIssueText(summary, description) {
  const fullText = (summary || '') + ' ' + (description || '');
  const keyTerms = extractKeyTerms(fullText);

  let text = `Title: ${summary || ''}`;
  if (keyTerms.length > 0) {
    text += `\nKey terms: ${keyTerms.join(', ')}`;
  }
  if (description) {
    text += `\nDescription: ${description}`;
  }
  text += `\nTitle: ${summary || ''}`;

  return text.trim();
}

/** Embed text for indexing (stored documents). */
async function getDocumentEmbedding(text) {
  return getEmbedding(text, 'search_document');
}

/** Embed text for search queries. */
async function getQueryEmbedding(text) {
  return getEmbedding(text, 'search_query');
}

export { getEmbedding, getDocumentEmbedding, getQueryEmbedding, composeIssueText };
