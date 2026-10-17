import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { HomePage } from './HomePage';

function renderPage() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter>
        <HomePage />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

function mockFetch(status: number, body: unknown) {
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => new Response(JSON.stringify(body), { status })),
  );
}

describe('HomePage', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('shows each component status from /api/health', async () => {
    mockFetch(200, {
      status: 'degraded',
      version: '0.1.0',
      uptimeSeconds: 1,
      checks: { database: 'up', redis: 'up', worker: 'down' },
    });
    renderPage();
    expect(await screen.findByText('Degraded')).toBeInTheDocument();
    expect(screen.getByTestId('status-Database')).toHaveTextContent('Up');
    expect(screen.getByTestId('status-Worker')).toHaveTextContent('Down');
    expect(screen.getByTestId('status-API')).toHaveTextContent('Up');
  });

  it('shows an error state when the API is unreachable', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => Promise.reject(new TypeError('Failed to fetch'))),
    );
    renderPage();
    expect(await screen.findByRole('alert')).toHaveTextContent('Can’t reach the API');
    expect(screen.getByTestId('status-API')).toHaveTextContent('Down');
  });
});
