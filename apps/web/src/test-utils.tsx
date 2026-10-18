import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render } from '@testing-library/react';
import { ReactElement } from 'react';
import { MemoryRouter } from 'react-router-dom';
import { vi } from 'vitest';
import { ThemeProvider } from './lib/theme';
import { ToastProvider } from './lib/toast';

type Handler = (init: RequestInit | undefined) => { status?: number; body?: unknown };

/**
 * Replaces fetch with canned responses keyed by "METHOD /path" (path without the /api prefix).
 * Unknown requests fail the test loudly.
 */
export function mockApi(routes: Record<string, Handler | { status?: number; body?: unknown }>) {
  const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(String(input), 'http://localhost');
    const key = `${init?.method ?? 'GET'} ${url.pathname.replace(/^\/api/, '')}`;
    const route = routes[key];
    if (!route) throw new Error(`Unexpected request: ${key}`);
    const { status = 200, body } = typeof route === 'function' ? route(init) : route;
    return new Response(body === undefined ? null : JSON.stringify(body), { status });
  });
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

export function renderApp(ui: ReactElement, { route = '/' } = {}) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <ThemeProvider>
        <ToastProvider>
          <MemoryRouter initialEntries={[route]}>{ui}</MemoryRouter>
        </ToastProvider>
      </ThemeProvider>
    </QueryClientProvider>,
  );
}

export const adminSession = {
  user: { id: 'u1', email: 'ada@example.com', name: 'Ada Admin', role: 'admin' },
  workspace: { id: 'w1', name: 'Acme' },
};

export const memberSession = {
  user: { id: 'u2', email: 'mo@example.com', name: 'Mo Member', role: 'member' },
  workspace: { id: 'w1', name: 'Acme' },
};
