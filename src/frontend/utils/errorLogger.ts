import { invoke } from '@forge/bridge';
import React from 'react';
import { Text } from '@forge/react';

interface ErrorData {
  message: string;
  stack?: string;
  source?: string;
  lineno?: number;
  colno?: number;
  timestamp: string;
  userAgent?: string;
  url?: string;
  errorType?: string;
  componentStack?: string;
}

/**
 * Logs frontend errors to the backend resolver for Forge logging
 */
export const logError = async (errorData: Partial<ErrorData>): Promise<void> => {
  try {
    const fullErrorData: ErrorData = {
      message: errorData.message || 'Unknown error',
      stack: errorData.stack,
      source: errorData.source,
      lineno: errorData.lineno,
      colno: errorData.colno,
      timestamp: new Date().toISOString(),
      userAgent: typeof navigator !== 'undefined' ? navigator.userAgent : undefined,
      url: typeof window !== 'undefined' ? window.location?.href : undefined,
      ...errorData,
    };

    await invoke('logError', fullErrorData);
  } catch (loggerError) {
    // Fallback: if error logging fails, log to console
    console.error('Failed to log error to backend:', loggerError);
    console.error('Original error:', errorData);
  }
};

/**
 * Sets up global error handlers for the application
 * Call this once when your app initializes - it will catch ALL frontend errors automatically
 */
export const setupGlobalErrorHandlers = (): void => {
  if (typeof window !== 'undefined') {
    // Handle JavaScript runtime errors (syntax errors, reference errors, etc.)
    window.addEventListener('error', (event) => {
      logError({
        message: event.message,
        source: event.filename,
        lineno: event.lineno,
        colno: event.colno,
        stack: event.error?.stack,
        errorType: 'javascript',
      });
    });

    // Handle unhandled promise rejections (async operations that fail)
    window.addEventListener('unhandledrejection', (event) => {
      // Prevent the default console.error behavior
      event.preventDefault();
      
      logError({
        message: `Unhandled Promise Rejection: ${event.reason}`,
        stack: event.reason?.stack || String(event.reason),
        errorType: 'promise',
      });
    });
  }
};

/**
 * Simple React Error Boundary component for catching React component errors
 * This catches errors that the global handlers might miss
 */
interface ErrorBoundaryState {
  hasError: boolean;
  error?: Error;
}

export class ErrorBoundary extends React.Component<
  React.PropsWithChildren<{ fallback?: React.ComponentType<{ error: Error }> }>,
  ErrorBoundaryState
> {
  constructor(props: React.PropsWithChildren<{ fallback?: React.ComponentType<{ error: Error }> }>) {
    super(props);
    this.state = { hasError: false };
  }

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, errorInfo: React.ErrorInfo): void {
    // Log the React error automatically
    logError({
      message: `React Error: ${error.message}`,
      stack: error.stack || undefined,
      componentStack: errorInfo.componentStack || undefined,
      errorType: 'react',
    });

    // Signal error state to parent frame so the preview renderer can suppress
    // the error-boundary fallback ForgeDoc and show appropriate UI instead.
    try {
      if (typeof window !== 'undefined' && window.parent && window.parent !== window) {
        window.parent.postMessage({
          type: 'forge-app-error-state',
          isError: true,
          error: { message: error.message, stack: error.stack },
        }, '*');
      }
    } catch {
      // Ignore cross-origin errors
    }
  }

  render(): React.ReactNode {
    if (this.state.hasError && this.state.error) {
      // Use custom fallback if provided, otherwise show default error UI
      if (this.props.fallback) {
        const FallbackComponent = this.props.fallback;
        return React.createElement(FallbackComponent, { error: this.state.error });
      }
      
      const isPreview = typeof window !== 'undefined' && (window as unknown as Record<string, unknown>).__FORGE_PREVIEW__ === true;

      if (isPreview) {
        // In preview mode, return a simple message.
        // eslint-disable-next-line react/no-children-prop
        return React.createElement(
          Text,
          {
            size: 'medium',
            weight: 'regular',
            children: "The app preview isn't ready to display. If Rovo is still working, this is expected and the preview will update automatically when it's ready."
          }
        );
      }

      // In the installed app, show an error message using Forge UI Kit.
      // eslint-disable-next-line react/no-children-prop
      return React.createElement(
        Text,
        {
          color: 'color.text.danger',
          size: 'large',
          weight: 'bold',
          children: '⚠️ Something went wrong due to an error in the app. The error has been logged. Please fix the app and try again.'
        }
      );
    }

    return this.props.children;
  }
}