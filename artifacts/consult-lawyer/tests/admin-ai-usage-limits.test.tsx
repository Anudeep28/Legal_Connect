import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { AdminAiUsage } from '@/components/admin-ai-usage';

const mocks = vi.hoisted(() => ({
  saveLimits: vi.fn(),
  saveBudget: vi.fn(),
  toast: vi.fn(),
  data: {
    days: 30,
    retentionDays: 90,
    monthlyBudget: {
      enabled: false,
      monthlyBudgetUsd: null,
      warningPercent: 80,
      monthStart: '2026-11-01',
      currentMonthEstimatedUsd: null,
      costCoverage: 'no_usage',
      requests: 0,
      pricedRequests: 0,
      alertLevel: 'none',
    },
    dailyLimits: {
      drafting: { trial: 5, single: 15, monthly: 30 },
      transcription: { trial: 5, single: 15, monthly: 30 },
      source: 'owner',
      updatedAt: '2026-11-24T12:00:00.000Z',
    },
    rows: [],
  },
}));

vi.mock('@workspace/api-client-react', () => ({
  getGetAdminAiUsageQueryKey: () => ['admin-ai-usage'],
  useGetAdminAiUsage: () => ({
    data: mocks.data,
    isLoading: false,
    isError: false,
    refetch: vi.fn(),
  }),
  useUpdateAdminAiUsageBudget: () => ({ isPending: false, mutate: mocks.saveBudget }),
  useUpdateAdminAiUsageLimits: () => ({ isPending: false, mutate: mocks.saveLimits }),
}));

vi.mock('@/hooks/use-toast', () => ({
  useToast: () => ({ toast: mocks.toast }),
}));

afterEach(() => {
  cleanup();
  delete window.umami;
  mocks.saveLimits.mockReset();
  mocks.saveBudget.mockReset();
  mocks.toast.mockReset();
});

beforeEach(() => {
  vi.stubGlobal('ResizeObserver', class {
    observe() {}
    unobserve() {}
    disconnect() {}
  });
});

function renderSettings() {
  return render(
    <QueryClientProvider client={new QueryClient()}>
      <AdminAiUsage />
    </QueryClientProvider>,
  );
}

it('loads the six current caps, validates the range, and saves all values together', async () => {
  const user = userEvent.setup();
  renderSettings();

  expect((await screen.findByTestId('text-ai-limits-source')).textContent?.includes('Owner-configured')).toBe(true);
  const trialDrafting = screen.getByTestId('ai-limit-drafting-trial') as HTMLInputElement;
  expect(trialDrafting.value).toBe('5');

  await user.clear(trialDrafting);
  await user.type(trialDrafting, '7');
  const save = screen.getByTestId('button-save-ai-limits') as HTMLButtonElement;
  expect(save.disabled).toBe(false);
  mocks.saveLimits.mockImplementation((variables, callbacks) => {
    callbacks.onSuccess({
      ...mocks.data.dailyLimits,
      ...variables.data,
      source: 'owner',
      updatedAt: '2026-11-24T12:05:00.000Z',
    });
  });
  await user.click(save);

  await waitFor(() => expect(mocks.saveLimits).toHaveBeenCalledOnce());
  expect(mocks.saveLimits.mock.calls[0]?.[0]).toEqual({
    data: {
      drafting: { trial: 7, single: 15, monthly: 30 },
      transcription: { trial: 5, single: 15, monthly: 30 },
    },
  });
  expect(mocks.toast).toHaveBeenCalledWith({
    title: 'Daily AI limits saved',
    description: 'The new limits are enforced on the next request.',
  });

  await user.clear(trialDrafting);
  await user.type(trialDrafting, '10001');
  expect(save.disabled).toBe(true);
  expect(mocks.saveLimits).toHaveBeenCalledOnce();
});
