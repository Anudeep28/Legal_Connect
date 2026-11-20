import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { AdminTwilioUsage } from '@/components/admin-twilio-usage';

const mocks = vi.hoisted(() => ({
  save: vi.fn(),
  toast: vi.fn(),
  budget: {
    enabled: true,
    budgetAmount: 123.45,
    budgetCurrency: 'USD',
    warningPercent: 80,
    lookupStatus: 'success',
    currentSpend: 21.5,
    usageCurrency: 'USD',
    participantMinutes: 10,
    periodStart: '2026-11-01',
    periodEnd: '2026-11-30',
    usageAsOf: '2026-11-20T00:00:00Z',
    lastAttemptAt: '2026-11-20T00:00:00Z',
    lastSuccessAt: '2026-11-20T00:00:00Z',
    providerConfigured: true,
    dataDelayed: false,
    currencyMatches: true,
    periodCurrent: true,
    alertLevel: 'none',
  },
}));

vi.mock('@workspace/api-client-react', () => ({
  getGetAdminTwilioUsageBudgetQueryKey: () => ['admin-twilio-usage-budget'],
  useGetAdminTwilioUsageBudget: () => ({
    data: mocks.budget,
    isLoading: false,
    isError: false,
    refetch: vi.fn(),
  }),
  useUpdateAdminTwilioUsageBudget: () => ({ isPending: false, mutate: mocks.save }),
  useRefreshAdminTwilioUsageBudget: () => ({ isPending: false, mutate: vi.fn() }),
}));

vi.mock('@/hooks/use-toast', () => ({
  useToast: () => ({ toast: mocks.toast }),
}));

afterEach(() => {
  cleanup();
  delete window.umami;
  vi.unstubAllGlobals();
  mocks.save.mockReset();
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
  const client = new QueryClient();
  return render(
    <QueryClientProvider client={client}>
      <AdminTwilioUsage />
    </QueryClientProvider>,
  );
}

async function saveDisabledSettings() {
  mocks.save.mockImplementation((input, callbacks) => {
    callbacks.onSuccess({ ...mocks.budget, ...input.data });
  });
  const user = userEvent.setup();
  renderSettings();
  await user.click(await screen.findByTestId('switch-twilio-budget-enabled'));
  await user.click(screen.getByTestId('button-save-twilio-budget'));
  await waitFor(() => expect(mocks.save).toHaveBeenCalledOnce());
}

it('records only that alert settings were saved and whether alerts are enabled', async () => {
  const track = vi.fn();
  window.umami = { track };
  await saveDisabledSettings();

  expect(track).toHaveBeenCalledOnce();
  expect(track).toHaveBeenCalledWith('twilio_alert_settings_saved', { enabled: false });
});

it('keeps a successful settings save successful if analytics throws', async () => {
  window.umami = {
    track: () => {
      throw new Error('synthetic analytics failure');
    },
  };
  await saveDisabledSettings();

  expect(mocks.toast).toHaveBeenCalledWith({ title: 'Twilio usage alert settings saved' });
});
