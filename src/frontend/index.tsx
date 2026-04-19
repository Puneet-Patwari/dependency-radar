import React, { useEffect, useState, useCallback } from 'react';
import ForgeReconciler, {
  Text,
  Button,
  Box,
  Stack,
  Inline,
  Lozenge,
  Spinner,
  EmptyState,
  Link,
  SectionMessage,
  xcss,
  useProductContext,
} from '@forge/react';
import { invoke, requestJira, showFlag } from '@forge/bridge';
import { setupGlobalErrorHandlers, ErrorBoundary } from './utils/errorLogger';
import type { CandidateIssue, CreateIssueLinkResponse } from '../types';

// ─── Preview Mode Detection ─────────────────────────────────────────────────
const isPreview =
  typeof window !== 'undefined' &&
  (window as unknown as Record<string, unknown>).__FORGE_PREVIEW__ === true;

// ─── Stop Words ─────────────────────────────────────────────────────────────
const STOP_WORDS = new Set([
  'the', 'and', 'is', 'to', 'a', 'in', 'for', 'of', 'it', 'on',
  'at', 'by', 'with', 'from', 'that', 'this', 'are', 'was', 'be',
  'as', 'an',
]);

// ─── ADF Text Extraction ────────────────────────────────────────────────────
interface AdfNode {
  type: string;
  text?: string;
  content?: AdfNode[];
}

export function extractTextFromAdf(node: AdfNode | null | undefined): string {
  if (!node) return '';
  let result = '';
  if (node.text) {
    result += node.text + ' ';
  }
  if (node.content && Array.isArray(node.content)) {
    for (const child of node.content) {
      result += extractTextFromAdf(child);
    }
  }
  return result;
}

// ─── Keyword Extraction ─────────────────────────────────────────────────────
export function extractKeywords(text: string): string[] {
  const tokens = text
    .split(/\s+/)
    .map((t) => t.toLowerCase().replace(/[^a-z0-9]/g, ''))
    .filter((t) => t.length >= 3)
    .filter((t) => !STOP_WORDS.has(t));

  const unique = [...new Set(tokens)];
  return unique.slice(0, 10);
}

// ─── Match Scoring ──────────────────────────────────────────────────────────
export function scoreCandidate(
  keywords: string[],
  summary: string,
  description: AdfNode | string | null | undefined,
  issueKey: string,
  projectName: string,
): CandidateIssue | null {
  const descText =
    typeof description === 'string'
      ? description
      : extractTextFromAdf(description as AdfNode | null | undefined);
  const combined = (summary + ' ' + descText).toLowerCase();

  let matchCount = 0;
  for (const kw of keywords) {
    if (combined.includes(kw)) {
      matchCount++;
    }
  }

  if (matchCount === 0) return null;

  let matchLevel: CandidateIssue['matchLevel'];
  if (matchCount >= 3) {
    matchLevel = 'High Match';
  } else if (matchCount === 2) {
    matchLevel = 'Medium Match';
  } else {
    matchLevel = 'Low Match';
  }

  return {
    key: issueKey,
    summary,
    projectName,
    matchCount,
    matchLevel,
    isLinked: false,
  };
}

// ─── Lozenge Appearance Mapping ─────────────────────────────────────────────
function getLozengeAppearance(
  matchLevel: CandidateIssue['matchLevel'],
): 'removed' | 'moved' | 'success' {
  switch (matchLevel) {
    case 'High Match':
      return 'removed';
    case 'Medium Match':
      return 'moved';
    case 'Low Match':
      return 'success';
  }
}

// ─── JQL Builder ────────────────────────────────────────────────────────────
export function buildJql(keywords: string[], currentProjectKey: string): string {
  const keywordsJql = keywords.join(' OR ');
  return `text ~ "${keywordsJql}" AND project != ${currentProjectKey} AND statusCategory != Done AND created >= -90d`;
}

// ─── Mock Data for Preview Mode ─────────────────────────────────────────────
const MOCK_CANDIDATES: CandidateIssue[] = [
  {
    key: 'INFRA-201',
    summary: 'Database connection pooling timeout under load',
    projectName: 'Infrastructure',
    matchCount: 4,
    matchLevel: 'High Match',
    isLinked: false,
  },
  {
    key: 'PERF-88',
    summary: 'API response time degradation in authentication service',
    projectName: 'Performance',
    matchCount: 2,
    matchLevel: 'Medium Match',
    isLinked: false,
  },
  {
    key: 'SEC-45',
    summary: 'Token refresh mechanism needs retry logic',
    projectName: 'Security',
    matchCount: 1,
    matchLevel: 'Low Match',
    isLinked: false,
  },
];

// ─── Styles ─────────────────────────────────────────────────────────────────
const containerStyle = xcss({
  padding: 'space.200',
});

const cardStyle = xcss({
  padding: 'space.150',
  backgroundColor: 'color.background.neutral.subtle',
  borderRadius: 'radius.small',
  borderWidth: 'border.width',
  borderStyle: 'solid',
  borderColor: 'color.border',
});

// ─── App Component ──────────────────────────────────────────────────────────
export const App = (): JSX.Element => {
  const context = useProductContext();
  const [candidates, setCandidates] = useState<CandidateIssue[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const handleCreateLink = useCallback(
    async (sourceIssueKey: string, targetIssueKey: string) => {
      try {
        const response = (await invoke('createIssueLink', {
          sourceIssueKey,
          targetIssueKey,
        })) as CreateIssueLinkResponse;

        if (response.success) {
          setCandidates((prev) =>
            prev.map((c) =>
              c.key === targetIssueKey ? { ...c, isLinked: true } : c,
            ),
          );
        } else {
          showFlag({
            id: `link-error-${targetIssueKey}`,
            title: 'Failed to create link',
            description: response.error || 'An unknown error occurred',
            type: 'error',
            isAutoDismiss: true,
          });
        }
      } catch (err) {
        console.error('Failed to create issue link:', err);
        showFlag({
          id: `link-error-${targetIssueKey}`,
          title: 'Failed to create link',
          description: 'An unexpected error occurred while creating the link',
          type: 'error',
          isAutoDismiss: true,
        });
      }
    },
    [],
  );

  useEffect(() => {
    setupGlobalErrorHandlers();

    if (isPreview) {
      setCandidates(MOCK_CANDIDATES);
      setLoading(false);
      return;
    }

    // Wait for context to load
    if (!context) return;

    const issueKey = context.extension?.issue?.key as string | undefined;
    if (!issueKey) {
      setError('Could not determine the current issue.');
      setLoading(false);
      return;
    }

    const fetchDependencies = async () => {
      try {
        // Step 1: Fetch current issue
        const issueResponse = await requestJira(
          `/rest/api/3/issue/${issueKey}?fields=summary,description,project`,
        );

        if (!issueResponse.ok) {
          setError('Failed to fetch issue details. Please check your permissions.');
          setLoading(false);
          return;
        }

        const issueData = await issueResponse.json();
        const summary: string = issueData.fields?.summary || '';
        const description = issueData.fields?.description;
        const projectKey: string = issueData.fields?.project?.key || '';

        // Step 2: Extract keywords
        const descriptionText = extractTextFromAdf(description);
        const allText = summary + ' ' + descriptionText;
        const keywords = extractKeywords(allText);

        if (keywords.length === 0) {
          setCandidates([]);
          setLoading(false);
          return;
        }

        // Step 3: Build JQL and search
        const jql = buildJql(keywords, projectKey);
        const encodedJql = encodeURIComponent(jql);
        const searchResponse = await requestJira(
          `/rest/api/3/search?jql=${encodedJql}&maxResults=20&fields=summary,project,description`,
        );

        if (!searchResponse.ok) {
          setCandidates([]);
          setLoading(false);
          return;
        }

        const searchData = await searchResponse.json();
        const issues = searchData.issues || [];

        // Step 4: Score and sort candidates
        const scored: CandidateIssue[] = [];
        for (const issue of issues) {
          const candidate = scoreCandidate(
            keywords,
            issue.fields?.summary || '',
            issue.fields?.description,
            issue.key,
            issue.fields?.project?.name || issue.fields?.project?.key || '',
          );
          if (candidate) {
            scored.push(candidate);
          }
        }

        scored.sort((a, b) => b.matchCount - a.matchCount);
        setCandidates(scored);
      } catch (err) {
        console.error('Error scanning for dependencies:', err);
        setCandidates([]);
      } finally {
        setLoading(false);
      }
    };

    fetchDependencies();
  }, [context]);

  // ── Loading State ───────────────────────────────────────────────────────
  if (loading) {
    return (
      <Box xcss={containerStyle}>
        <Stack space="space.200" alignInline="center">
          <Spinner size="medium" label="Scanning for hidden dependencies..." />
          <Text color="color.text.subtle" size="small" weight="regular">
            Scanning for hidden dependencies...
          </Text>
        </Stack>
      </Box>
    );
  }

  // ── Error State ─────────────────────────────────────────────────────────
  if (error) {
    return (
      <Box xcss={containerStyle}>
        <SectionMessage appearance="error" title="Error">
          <Text>{error}</Text>
        </SectionMessage>
      </Box>
    );
  }

  // ── Empty State ─────────────────────────────────────────────────────────
  if (candidates.length === 0) {
    return (
      <Box xcss={containerStyle}>
        <EmptyState
          header="No latent dependencies detected"
          description="No related issues were found in other projects within the last 90 days."
        />
      </Box>
    );
  }

  // ── Results ─────────────────────────────────────────────────────────────
  const issueKey = context?.extension?.issue?.key as string | undefined;

  return (
    <Box xcss={containerStyle}>
      <Stack space="space.150">
        <Text color="color.text.subtle" size="small" weight="regular">
          {`Found ${candidates.length} potential ${candidates.length === 1 ? 'dependency' : 'dependencies'}`}
        </Text>
        {candidates.map((candidate) => (
          <Box key={candidate.key} xcss={cardStyle}>
            <Stack space="space.100">
              <Inline space="space.100" alignBlock="center" spread="space-between">
                <Inline space="space.100" alignBlock="center">
                  <Link href={`/browse/${candidate.key}`}>
                    {candidate.key}
                  </Link>
                  <Lozenge
                    appearance={getLozengeAppearance(candidate.matchLevel)}
                    isBold
                  >
                    {candidate.matchLevel}
                  </Lozenge>
                </Inline>
                {candidate.isLinked ? (
                  <Text color="color.text.subtle" size="small" weight="regular">
                    Linked ✓
                  </Text>
                ) : (
                  <Button
                    appearance="subtle"
                    onClick={() =>
                      handleCreateLink(issueKey || '', candidate.key)
                    }
                  >
                    Create Link
                  </Button>
                )}
              </Inline>
              <Text size="small" weight="regular">{candidate.summary}</Text>
              <Text color="color.text.subtlest" size="small" weight="regular">
                {candidate.projectName}
              </Text>
            </Stack>
          </Box>
        ))}
      </Stack>
    </Box>
  );
};

// ─── Render ─────────────────────────────────────────────────────────────────
ForgeReconciler.render(
  <ErrorBoundary>
    <App />
  </ErrorBoundary>,
);
