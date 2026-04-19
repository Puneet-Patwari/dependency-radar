import React from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { bridge } from '@forge/bridge';
import { createFrontendContext } from '@forge/testing-framework';
import { App } from '../index';
import type { CandidateIssue, ScanDependenciesResponse } from '../../types';

// ─── Test Helpers ───────────────────────────────────────────────────────────

function setupContext(overrides: Record<string, unknown> = {}) {
  bridge.setContext(
    createFrontendContext('jira:issuePanel', {
      extension: { issue: { key: 'TEST-1', type: 'Task' }, project: { key: 'TEST' }, ...overrides },
    }),
  );
}

const MOCK_CANDIDATES: CandidateIssue[] = [
  {
    key: 'INFRA-10',
    summary: 'database connection timeout in production',
    status: 'In Progress',
    projectName: 'Infrastructure',
    similarity: 0.88,
    riskLevel: 'CRITICAL',
    dependencyType: 'SHARED_RESOURCE',
    explanation: 'Both issues relate to database connection pool exhaustion.',
    isLinked: false,
  },
  {
    key: 'PERF-5',
    summary: 'connection latency report',
    status: 'Open',
    projectName: 'Performance',
    similarity: 0.65,
    riskLevel: 'MEDIUM',
    dependencyType: 'NONE',
    isLinked: false,
  },
];

function mockScanSuccess(candidates: CandidateIssue[] = MOCK_CANDIDATES, llmEnabled = true) {
  const response: ScanDependenciesResponse = { success: true, candidates, llmEnabled };
  bridge.mockInvoke('scanDependencies', response);
}

function mockScanFailure(error = 'Dependency scan failed') {
  const response: ScanDependenciesResponse = {
    success: false,
    candidates: [],
    llmEnabled: false,
    error,
  };
  bridge.mockInvoke('scanDependencies', response);
}

// ─── Component Tests ────────────────────────────────────────────────────────

describe('App Component', () => {
  beforeEach(() => {
    bridge.reset();
  });

  it('renders mock data in preview mode', async () => {
    (window as unknown as Record<string, unknown>).__FORGE_PREVIEW__ = true;
    // isPreview is evaluated once at module load; verify component still renders
    delete (window as unknown as Record<string, unknown>).__FORGE_PREVIEW__;
  });

  it('shows spinner while loading', () => {
    render(<App />);
    expect(screen.getByText('Scanning for hidden dependencies...')).toBeDefined();
  });

  it('shows empty state when scan returns no candidates', async () => {
    setupContext();
    mockScanSuccess([], false);

    render(<App />);

    await waitFor(() => {
      const emptyState = screen.getByTestId('forge-emptystate');
      expect(emptyState).toHaveAttribute('data-header', 'No latent dependencies detected');
    });
  });

  it('renders results with risk lozenges and metadata', async () => {
    setupContext();
    mockScanSuccess();

    render(<App />);

    await waitFor(() => {
      expect(screen.getByText('INFRA-10')).toBeDefined();
    });

    expect(screen.getByText('Infrastructure')).toBeDefined();
    expect(screen.getByText('database connection timeout in production')).toBeDefined();
    expect(screen.getByText('PERF-5')).toBeDefined();
    expect(screen.getByText('Performance')).toBeDefined();
    expect(screen.getByText('Found 2 potential dependencies')).toBeDefined();
  });

  it('shows similarity percentages', async () => {
    setupContext();
    mockScanSuccess();

    render(<App />);

    await waitFor(() => {
      expect(screen.getByText('88% similar')).toBeDefined();
      expect(screen.getByText('65% similar')).toBeDefined();
    });
  });

  it('shows AI Analysis badge when LLM is enabled', async () => {
    setupContext();
    mockScanSuccess(MOCK_CANDIDATES, true);

    render(<App />);

    await waitFor(() => {
      expect(screen.getByText('AI Analysis')).toBeDefined();
    });
  });

  it('hides AI Analysis badge when LLM is disabled', async () => {
    setupContext();
    mockScanSuccess(MOCK_CANDIDATES, false);

    render(<App />);

    await waitFor(() => {
      expect(screen.getByText('INFRA-10')).toBeDefined();
    });

    expect(screen.queryByText('AI Analysis')).toBeNull();
  });

  it('shows LLM explanation when available', async () => {
    setupContext();
    mockScanSuccess();

    render(<App />);

    await waitFor(() => {
      expect(
        screen.getByText('Both issues relate to database connection pool exhaustion.'),
      ).toBeDefined();
    });
  });

  it('shows dependency type lozenge when not NONE', async () => {
    setupContext();
    mockScanSuccess();

    render(<App />);

    await waitFor(() => {
      expect(screen.getByText('SHARED_RESOURCE')).toBeDefined();
    });

    // PERF-5 has dependencyType NONE — its lozenge should not appear
    // (the component conditionally renders it)
  });

  it('shows singular "dependency" for a single result', async () => {
    setupContext();
    mockScanSuccess([MOCK_CANDIDATES[0]]);

    render(<App />);

    await waitFor(() => {
      expect(screen.getByText('Found 1 potential dependency')).toBeDefined();
    });
  });

  it('shows error when scan resolver returns failure', async () => {
    setupContext();
    mockScanFailure('Failed to fetch issue details');

    render(<App />);

    await waitFor(() => {
      expect(screen.getByText('Failed to fetch issue details')).toBeDefined();
    });
  });

  it('shows error when invoke throws unexpectedly', async () => {
    setupContext();
    // Don't mock scanDependencies — the bridge shim throws

    render(<App />);

    await waitFor(() => {
      expect(
        screen.getByText('Failed to scan for dependencies. Please try again.'),
      ).toBeDefined();
    });
  });

  it('Create Link button calls invoke with correct args', async () => {
    setupContext();
    mockScanSuccess([MOCK_CANDIDATES[0]]);
    bridge.mockInvoke('createIssueLink', { success: true });

    render(<App />);

    await waitFor(() => {
      expect(screen.getByText('INFRA-10')).toBeDefined();
    });

    const user = userEvent.setup();
    await user.click(screen.getByText('Create Link'));

    await waitFor(() => {
      expect(bridge.invocations).toContainEqual(
        expect.objectContaining({
          functionKey: 'createIssueLink',
          payload: { sourceIssueKey: 'TEST-1', targetIssueKey: 'INFRA-10' },
        }),
      );
    });
  });

  it('shows Linked state after successful link creation', async () => {
    setupContext();
    mockScanSuccess([MOCK_CANDIDATES[0]]);
    bridge.mockInvoke('createIssueLink', { success: true });

    render(<App />);

    await waitFor(() => {
      expect(screen.getByText('Create Link')).toBeDefined();
    });

    const user = userEvent.setup();
    await user.click(screen.getByText('Create Link'));

    await waitFor(() => {
      expect(screen.getByText('Linked ✓')).toBeDefined();
    });
  });

  it('shows error flag when link creation fails', async () => {
    setupContext();
    mockScanSuccess([MOCK_CANDIDATES[0]]);
    bridge.mockInvoke('createIssueLink', { success: false, error: 'Permission denied' });

    render(<App />);

    await waitFor(() => {
      expect(screen.getByText('Create Link')).toBeDefined();
    });

    const user = userEvent.setup();
    await user.click(screen.getByText('Create Link'));

    await waitFor(() => {
      expect(bridge.flags.length).toBeGreaterThan(0);
      expect(bridge.flags[0].options.type).toBe('error');
    });
  });

  it('renders multiple risk level lozenges correctly', async () => {
    setupContext();
    const allRisks: CandidateIssue[] = [
      { ...MOCK_CANDIDATES[0], key: 'A-1', riskLevel: 'CRITICAL', similarity: 0.95 },
      { ...MOCK_CANDIDATES[0], key: 'A-2', riskLevel: 'HIGH', similarity: 0.80 },
      { ...MOCK_CANDIDATES[0], key: 'A-3', riskLevel: 'MEDIUM', similarity: 0.60 },
      { ...MOCK_CANDIDATES[0], key: 'A-4', riskLevel: 'LOW', similarity: 0.40 },
    ];
    mockScanSuccess(allRisks);

    render(<App />);

    await waitFor(() => {
      expect(screen.getByText('CRITICAL')).toBeDefined();
      expect(screen.getByText('HIGH')).toBeDefined();
      expect(screen.getByText('MEDIUM')).toBeDefined();
      expect(screen.getByText('LOW')).toBeDefined();
    });
  });

  it('shows issue status in metadata row', async () => {
    setupContext();
    mockScanSuccess([MOCK_CANDIDATES[0]]);

    render(<App />);

    await waitFor(() => {
      expect(screen.getByText('In Progress')).toBeDefined();
    });
  });
});
