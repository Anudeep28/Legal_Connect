import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { AdminTwilioUsage, buildTwilioUsageHistoryCsv } from '@/components/admin-twilio-usage';

const mocks = vi.hoisted(() => ({
  save: vi.fn(),
  toast: vi.fn(),
  history: { months: [] as any[] },
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
  getGetAdminTwilioUsageHistoryQueryKey: () => ['admin-twilio-usage-history'],
  useGetAdminTwilioUsageBudget: () => ({
    data: mocks.budget,
    isLoading: false,
    isError: false,
    refetch: vi.fn(),
  }),
  useGetAdminTwilioUsageHistory: () => ({
    data: mocks.history,
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
  mocks.history.months = [];
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

it('downloads spreadsheet-ready history with zero charges distinct from unavailable charges', async () => {
  mocks.history.months = [
    {
      periodStart: '2026-10-01',
      periodEnd: '2026-10-31',
      status: 'success',
      spend: 0,
      currency: 'USD',
      participantMinutes: 0,
      usageAsOf: '2026-10-31T23:00:00.000Z',
      checkedAt: '2026-11-01T00:00:00.000Z',
    },
    {
      periodStart: '2026-09-01',
      periodEnd: '2026-09-30',
      status: 'partial',
      spend: null,
      currency: null,
      participantMinutes: 125.5,
      usageAsOf: '2026-09-30T12:00:00.000Z',
      checkedAt: '2026-10-01T00:00:00.000Z',
    },
    {
      periodStart: '2026-08-01',
      periodEnd: '2026-08-31',
      status: 'no_data',
      spend: null,
      currency: null,
      participantMinutes: null,
      usageAsOf: null,
      checkedAt: '2026-09-01T00:00:00.000Z',
    },
  ];
  const createObjectURL = vi.fn((_blob: Blob | MediaSource) => 'blob:twilio-usage-history');
  const revokeObjectURL = vi.fn((_url: string) => {});
  const anchorClick = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
  const expectedCsv = buildTwilioUsageHistoryCsv(mocks.history.months);
  class URLWithBlobSupport extends URL {
    static createObjectURL = createObjectURL;
    static revokeObjectURL = revokeObjectURL;
  }
  vi.stubGlobal('URL', URLWithBlobSupport);

  const user = userEvent.setup();
  renderSettings();
  await user.click(await screen.findByTestId('button-download-twilio-usage-history'));

  expect(anchorClick).toHaveBeenCalledOnce();
  const blob = createObjectURL.mock.calls[0]?.[0] as Blob;
  const csv = await blob.text();
  expect(expectedCsv.startsWith('\uFEFF')).toBe(true);
  expect(csv).toBe(expectedCsv.slice(1));
  expect(csv).toContain('"Month status","Posted charges","Charge status","Currency"');
  expect(csv).toContain('"2026-10-01","2026-10-31","Complete",0,"Posted","USD",0,"2026-10-31T23:00:00.000Z","2026-11-01T00:00:00.000Z"');
  expect(csv).toContain('"2026-09-01","2026-09-30","Partial",,"Unavailable","Not reported",125.5');
  expect(csv).toContain('"2026-08-01","2026-08-31","Missing data",,"Unavailable","Not reported","Not available","Not reported","2026-09-01T00:00:00.000Z"');
  expect(document.querySelector('a[download^="twilio-video-usage-history-"]')).toBeNull();
});
