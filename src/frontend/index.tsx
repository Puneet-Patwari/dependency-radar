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
import { invoke, showFlag } from '@forge/bridge';
import { setupGlobalErrorHandlers, ErrorBoundary } from './utils/errorLogger';
import type {
  CandidateIssue,
  RiskLevel,
  ScanDependenciesResponse,
  CreateIssueLinkResponse,
} from '../types';

// ─── Preview Mode Detection ─────────────────────────────────────────────────
const isPreview =
  typeof window !== 'undefined' &&
  (window as unknown as Record<string, unknown>).__FORGE_PREVIEW__ === true;

// ─── Mock Data for Preview Mode ─────────────────────────────────────────────
const MOCK_CANDIDATES: CandidateIssue[] = [
  {
    key: 'INFRA-201',
    summary: 'Database connection pooling timeout under load',
    status: 'In Progress',
    projectName: 'Infrastructure',
    similarity: 0.91,
    riskLevel: 'CRITICAL',
    dependencyType: 'SHARED_RESOURCE',
    explanation: 'Both issues involve database connection pool exhaustion under concurrent load.',
    isLinked: false,
  },
  {
    key: 'PERF-88',
    summary: 'API response time degradation in authentication service',
    status: 'Open',
    projectName: 'Performance',
    similarity: 0.74,
    riskLevel: 'HIGH',
    dependencyType: 'SEQUENTIAL',
    explanation: 'Auth service latency directly blocks downstream API calls referenced in source ticket.',
    isLinked: false,
  },
  {
    key: 'SEC-45',
    summary: 'Token refresh mechanism needs retry logic',
    status: 'To Do',
    projectName: 'Security',
    similarity: 0.58,
    riskLevel: 'MEDIUM',
    dependencyType: 'CONFLICT',
    isLinked: false,
  },
  {
    key: 'DATA-12',
    summary: 'Migrate legacy user table to new schema',
    status: 'In Review',
    projectName: 'Data Platform',
    similarity: 0.42,
    riskLevel: 'LOW',
    dependencyType: 'NONE',
    isLinked: false,
  },
];

// ─── Risk-level → Lozenge mapping ───────────────────────────────────────────
function getLozengeAppearance(
  riskLevel: RiskLevel,
): 'removed' | 'moved' | 'success' | 'default' | 'new' {
  switch (riskLevel) {
    case 'CRITICAL':
      return 'removed';
    case 'HIGH':
      return 'new';
    case 'MEDIUM':
      return 'moved';
    case 'LOW':
      return 'success';
    case 'NONE':
      return 'default';
  }
}

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

const explanationStyle = xcss({
  padding: 'space.100',
  backgroundColor: 'color.background.information',
  borderRadius: 'radius.xsmall',
});

// ─── App Component ──────────────────────────────────────────────────────────
export const App = (): JSX.Element => {
  const context = useProductContext();
  const [candidates, setCandidates] = useState<CandidateIssue[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [llmEnabled, setLlmEnabled] = useState(false);

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
      setLlmEnabled(true);
      setLoading(false);
      return;
    }

    if (!context) return;

    const issueKey = context.extension?.issue?.key as string | undefined;
    if (!issueKey) {
      setError('Could not determine the current issue.');
      setLoading(false);
      return;
    }

    const scan = async () => {
      try {
        const result = (await invoke('scanDependencies', { issueKey })) as ScanDependenciesResponse;

        if (!result.success) {
          setError(result.error || 'Dependency scan failed.');
          return;
        }

        setCandidates(result.candidates);
        setLlmEnabled(result.llmEnabled);
      } catch (err) {
        console.error('Error scanning for dependencies:', err);
        setError('Failed to scan for dependencies. Please try again.');
      } finally {
        setLoading(false);
      }
    };

    scan();
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
          description="No related issues were found in other projects."
        />
      </Box>
    );
  }

  // ── Results ─────────────────────────────────────────────────────────────
  const issueKey = context?.extension?.issue?.key as string | undefined;

  return (
    <Box xcss={containerStyle}>
      <Stack space="space.150">
        <Inline space="space.100" alignBlock="center" spread="space-between">
          <Text color="color.text.subtle" size="small" weight="regular">
            {`Found ${candidates.length} potential ${candidates.length === 1 ? 'dependency' : 'dependencies'}`}
          </Text>
          {llmEnabled && (
            <Lozenge appearance="new">AI Analysis</Lozenge>
          )}
        </Inline>

        {candidates.map((candidate) => (
          <Box key={candidate.key} xcss={cardStyle}>
            <Stack space="space.100">
              {/* Header row: issue key + badges + link action */}
              <Inline space="space.100" alignBlock="center" spread="space-between">
                <Inline space="space.100" alignBlock="center">
                  <Link href={`/browse/${candidate.key}`}>
                    {candidate.key}
                  </Link>
                  <Lozenge
                    appearance={getLozengeAppearance(candidate.riskLevel)}
                    isBold
                  >
                    {candidate.riskLevel}
                  </Lozenge>
                  {candidate.dependencyType !== 'NONE' && (
                    <Lozenge appearance="default">
                      {candidate.dependencyType}
                    </Lozenge>
                  )}
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

              {/* Summary */}
              <Text size="small" weight="regular">{candidate.summary}</Text>

              {/* Metadata row: project, status, similarity */}
              <Inline space="space.100" alignBlock="center">
                <Text color="color.text.subtlest" size="small" weight="regular">
                  {candidate.projectName}
                </Text>
                <Text color="color.text.subtlest" size="small" weight="regular">
                  ·
                </Text>
                <Text color="color.text.subtlest" size="small" weight="regular">
                  {candidate.status}
                </Text>
                <Text color="color.text.subtlest" size="small" weight="regular">
                  ·
                </Text>
                <Text color="color.text.subtle" size="small" weight="bold">
                  {`${Math.round(candidate.similarity * 100)}% similar`}
                </Text>
              </Inline>

              {/* LLM explanation (when available) */}
              {candidate.explanation && (
                <Box xcss={explanationStyle}>
                  <Text color="color.text.information" size="small" weight="regular">
                    {candidate.explanation}
                  </Text>
                </Box>
              )}
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
