import { fetch } from '@forge/api';

const COHERE_CHAT_URL = 'https://api.cohere.ai/v2/chat';
const COHERE_MODEL = 'command-r-plus-08-2024';

const SYSTEM_PROMPT =
  'You are a dependency risk analyzer. Given a SOURCE ticket and CANDIDATE tickets ' +
  'from other teams, classify each candidate\'s hidden dependency risk as CRITICAL, ' +
  'HIGH, MEDIUM, LOW, or NONE. Return ONLY valid JSON array: ' +
  '[{key, riskLevel, dependencyType, explanation}]. ' +
  'dependencyType is one of: CONFLICT, SHARED_RESOURCE, SEQUENTIAL, DUPLICATE, NONE.';

/**
 * Returns the configured LLM provider mode.
 *
 * Reads `LLM_PROVIDER` from Forge environment variables.
 * Valid values: 'none' | 'cohere' | 'forge-llm'.
 * Defaults to 'none' so the app works out-of-the-box without any LLM.
 *
 * @returns {string}
 */
function getProvider() {
  return (process.env.LLM_PROVIDER || 'none').toLowerCase();
}

/**
 * Whether an LLM provider is active.
 * Useful for the frontend/resolvers to skip LLM-related work early.
 *
 * @returns {boolean}
 */
function isLLMEnabled() {
  return getProvider() !== 'none';
}

/**
 * Calls Cohere Chat v2 API to analyze dependencies.
 *
 * @param {string} userMessage - Stringified source + candidate tickets.
 * @returns {Promise<Array|null>} Parsed JSON array or null on failure.
 */
async function callCohere(userMessage) {
  const apiKey = process.env.COHERE_API_KEY;
  if (!apiKey) {
    console.warn('[llm-provider] COHERE_API_KEY not set, skipping LLM analysis');
    return null;
  }

  const response = await fetch(COHERE_CHAT_URL, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: COHERE_MODEL,
      messages: [
        { role: 'system', content: SYSTEM_PROMPT },
        { role: 'user', content: userMessage },
      ],
    }),
  });

  if (!response.ok) {
    const body = await response.text().catch(() => 'unreadable');
    console.warn('[llm-provider] Cohere API error:', { status: response.status, body });
    return null;
  }

  const data = await response.json();
  const text = data.message?.content?.[0]?.text;
  if (!text) {
    console.warn('[llm-provider] Cohere returned no text content');
    return null;
  }

  return JSON.parse(text);
}

/**
 * Plug-and-play LLM analysis for dependency risk classification.
 *
 * The provider is selected via the `LLM_PROVIDER` Forge environment variable:
 *
 *   'none'   → returns null immediately; app uses cosine-similarity scoring.
 *   'cohere' → calls Cohere Command-R via REST (uses existing COHERE_API_KEY).
 *
 * Every code path is wrapped in try/catch so a failing or misconfigured LLM
 * never breaks the app — it gracefully degrades to cosine-only results.
 *
 * @param {{ key: string, summary: string, description?: string }} sourceTicket
 *   The Jira issue currently being viewed.
 * @param {Array<{ key: string, summary: string, score: number }>} candidateTickets
 *   Candidate matches returned by Pinecone vector search.
 * @returns {Promise<Array<{ key: string, riskLevel: string, dependencyType: string, explanation: string }>|null>}
 *   Structured risk classifications, or null when LLM is disabled / errored.
 */
async function analyzeDependencies(sourceTicket, candidateTickets) {
  try {
    const provider = getProvider();

    if (provider === 'none') {
      return null;
    }

    const userMessage = JSON.stringify({ sourceTicket, candidateTickets });

    if (provider === 'cohere') {
      return await callCohere(userMessage);
    }

    console.warn(`[llm-provider] Unknown LLM_PROVIDER: '${provider}', skipping`);
    return null;
  } catch (error) {
    console.warn('[llm-provider] LLM analysis failed, falling back to cosine scoring:', error);
    return null;
  }
}

export { analyzeDependencies, isLLMEnabled };
