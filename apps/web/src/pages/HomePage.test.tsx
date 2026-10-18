import { screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { adminSession, mockApi, renderApp } from '../test-utils';
import { HomePage } from './HomePage';

describe('HomePage', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('greets the user and shows each component status from /api/health', async () => {
    mockApi({
      'GET /auth/me': { body: adminSession },
      'GET /health': {
        body: {
          status: 'degraded',
          version: '0.1.0',
          uptimeSeconds: 1,
          checks: { database: 'up', redis: 'up', worker: 'down' },
        },
      },
    });
    renderApp(<HomePage />);
    expect(await screen.findByText('Degraded')).toBeInTheDocument();
    expect(await screen.findByRole('heading', { name: 'Welcome, Ada' })).toBeInTheDocument();
    expect(screen.getByTestId('status-Database')).toHaveTextContent('Up');
    expect(screen.getByTestId('status-Worker')).toHaveTextContent('Down');
    expect(screen.getByTestId('status-API')).toHaveTextContent('Up');
  });

  it('shows an error state when the API is unreachable', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => Promise.reject(new TypeError('Failed to fetch'))),
    );
    renderApp(<HomePage />);
    expect(await screen.findByRole('alert')).toHaveTextContent('Can’t reach the API');
    expect(screen.getByTestId('status-API')).toHaveTextContent('Down');
  });
});
