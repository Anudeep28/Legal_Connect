import { afterEach, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { AdminSystemStatus } from '@/components/admin-system-status';

const mocks = vi.hoisted(() => ({
  signedIn: true,
  data: null as null | {
    api: 'live';
    database: 'unknown' | 'ready' | 'unavailable';
    checkedAt: string | null;
    lastSuccessfulCheckAt: string | null;
  },
  options: undefined as { query?: Record<string, unknown> } | undefined,
  refetch: vi.fn(),
  fetching: false,
}));

vi.mock('@clerk/react', () => ({
  useUser: () => ({ isLoaded: true, isSignedIn: mocks.signedIn }),
}));

vi.mock('@workspace/api-client-react', () => ({
  useGetAdminSystemStatus: (options: { query?: Record<string, unknown> }) => {
    mocks.options = options;
    return { data: mocks.data, refetch: mocks.refetch, isFetching: mocks.fetching };
  },
}));

afterEach(() => {
  cleanup();
  mocks.signedIn = true;
  mocks.data = null;
  mocks.options = undefined;
  mocks.refetch.mockReset();
  mocks.fetching = false;
});

it('shows separate API and database states with safe check timestamps', () => {
  mocks.data = {
    api: 'live',
    database: 'unavailable',
    checkedAt: '2026-11-25T03:00:00.000Z',
    lastSuccessfulCheckAt: '2026-11-25T02:59:30.000Z',
  };

  render(<AdminSystemStatus />);

  expect(screen.getByTestId('admin-system-status')).toBeTruthy();
  expect(screen.getByText('API liveness').parentElement?.textContent).toContain('Live');
  expect(screen.getByText('Database readiness').parentElement?.textContent).toContain('Unavailable');
  expect(screen.getByText('Last database check').parentElement?.textContent).toContain('25 Nov');
  expect(screen.getByText('Last successful database check').parentElement?.textContent).toContain('25 Nov');
  expect(screen.getByText(/Database-backed requests may be temporarily unavailable/)).toBeTruthy();
  expect(mocks.options?.query?.refetchInterval).toBe(15_000);
});

it('does not render system status unless the owner-only endpoint returns data', () => {
  mocks.signedIn = false;

  render(<AdminSystemStatus />);

  expect(screen.queryByTestId('admin-system-status')).toBeNull();
  expect(mocks.options?.query?.enabled).toBe(false);
});

it('lets the owner manually refresh the status', () => {
  mocks.data = {
    api: 'live',
    database: 'ready',
    checkedAt: null,
    lastSuccessfulCheckAt: null,
  };

  render(<AdminSystemStatus />);
  fireEvent.click(screen.getByRole('button', { name: 'Refresh system status' }));

  expect(mocks.refetch).toHaveBeenCalledOnce();
});
