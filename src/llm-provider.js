import { fetch } from '@forge/api';

const COHERE_CHAT_URL = 'https://api.cohere.ai/v2/chat';
const COHERE_MODEL = 'command-r-plus-08-2024';

const SYSTEM_PROMPT = `
You are a strict dependency classifier for Jira issues.

TASK
- Compare one SOURCE ticket against CANDIDATE tickets.
- For each candidate, output:
  { key, riskLevel, dependencyType, explanation }.

OUTPUT FORMAT (MANDATORY)
- Return ONLY a valid JSON array.
- No markdown, no prose, no code fences.
- Each object must include exactly these fields:
  key, riskLevel, dependencyType, explanation.

ALLOWED VALUES
- riskLevel: CRITICAL | HIGH | MEDIUM | LOW | NONE
- dependencyType: CONFLICT | SHARED_RESOURCE | SEQUENTIAL | DUPLICATE | NONE

DECISION RULES (USE IN THIS ORDER)
1) DUPLICATE:
   Same problem/solution scope; likely redundant implementation.
2) CONFLICT:
   Changes are incompatible, contradictory, or one breaks/deprecates what the other depends on.
3) SHARED_RESOURCE:
   Touches same API/service/db/component and may contend or require coordination.
4) SEQUENTIAL:
   One must happen before/after the other (clear prerequisite ordering).
5) NONE:
   No meaningful dependency.

CONSISTENCY REQUIREMENTS
- explanation MUST justify the chosen dependencyType explicitly.
- Start explanation with this exact prefix:
  "<dependencyType>: "
  Example: "CONFLICT: Both tickets modify /api/v2/auth in incompatible ways..."
- If your explanation indicates conflict but type is DUPLICATE (or any mismatch), fix the type.
- Keep explanation concise: one to two sentences after the prefix, maximum 50 words.

RISK GUIDANCE
- CRITICAL: high probability + high impact cross-team delivery risk.
- HIGH: significant dependency risk needing active coordination.
- MEDIUM: moderate risk with manageable coordination.
- LOW: weak but plausible dependency signal.
- NONE: no actionable dependency.

STATUS-AWARE RISK ESCALATION
Each ticket includes "status" and "statusCategory" fields.
For risk rules, normalize statusCategory into exactly one of:
- ToDo
- InProgress
- Done
Normalization:
- "To Do" -> ToDo
- "In Progress" -> InProgress
- "Done" -> Done
Use these rules to adjust riskLevel AFTER determining dependencyType:
- If dependencyType is CONFLICT or SHARED_RESOURCE:
  - Source is InProgress and candidate is ToDo -> escalate riskLevel by one tier (e.g. MEDIUM -> HIGH).
  - Candidate is InProgress -> escalate riskLevel by one tier (e.g. MEDIUM -> HIGH).
  - Both source AND candidate are InProgress -> escalate by two tiers (e.g. MEDIUM -> CRITICAL).
  - Candidate or Source is Done -> don't change riskLevel.
- For SEQUENTIAL dependencies:
  - If the prerequisite ticket is ToDo or InProgress and the dependent ticket is also active -> escalate by one tier.
- DUPLICATE: no status-based adjustment.
- Never escalate above CRITICAL or de-escalate below NONE.
- Hard constraint: ToDo + ToDo must never be treated as status-based escalation.
- Mention the status-based reasoning in your explanation when it affects riskLevel.
`;

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
      temperature: 0.1,
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
 * @param {{ key: string, summary: string, description?: string, status?: string, statusCategory?: string }} sourceTicket
 *   The Jira issue currently being viewed.
 * @param {Array<{ key: string, summary: string, score: number, status?: string, statusCategory?: string }>} candidateTickets
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
