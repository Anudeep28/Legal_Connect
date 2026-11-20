import { useEffect, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { AlertTriangle, Info, Loader2, RefreshCw } from 'lucide-react';
import {
  getGetAdminTwilioUsageBudgetQueryKey,
  getGetAdminTwilioUsageHistoryQueryKey,
  useGetAdminTwilioUsageBudget,
  useGetAdminTwilioUsageHistory,
  useRefreshAdminTwilioUsageBudget,
  useUpdateAdminTwilioUsageBudget,
  type AdminTwilioUsageHistoryItem,
} from '@workspace/api-client-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { ErrorState, ListSkeleton, Notice } from '@/components/kit';
import { useToast } from '@/hooks/use-toast';
import { errMsg } from '@/lib/format';
import { trackEvent } from '@/lib/analytics';

function formatMoney(value: number | null, currency: string | null) {
  if (value === null || !currency) return 'Not available';
  try {
    return new Intl.NumberFormat(undefined, {
      style: 'currency',
      currency,
      minimumFractionDigits: 2,
      maximumFractionDigits: 6,
    }).format(value);
  } catch {
    return `${currency} ${value.toFixed(4)}`;
  }
}

function formatDate(value: string | null) {
  if (!value) return 'Not reported';
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return 'Not reported';
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: 'medium',
    timeStyle: 'short',
    timeZone: 'UTC',
  }).format(date) + ' UTC';
}

function formatMonth(value: string) {
  const date = new Date(`${value}T00:00:00Z`);
  if (!Number.isFinite(date.getTime())) return value;
  return new Intl.DateTimeFormat(undefined, { month: 'long', year: 'numeric', timeZone: 'UTC' }).format(date);
}

function historyStatus(status: AdminTwilioUsageHistoryItem['status']) {
  switch (status) {
    case 'success': return 'Posted total';
    case 'partial': return 'Partial data';
    case 'no_data': return 'No data posted';
  }
}

function lookupMessage(status: string) {
  switch (status) {
    case 'checking': return 'A Twilio usage lookup is in progress.';
    case 'success': return 'Posted Programmable Video usage was retrieved from Twilio.';
    case 'partial': return 'Twilio returned Group Room minutes but not the total Video charge. No budget comparison or alert is made.';
    case 'no_data': return 'Twilio has not posted a current-month Video usage record. Spend is unavailable, not assumed to be zero.';
    case 'failed': return 'The latest lookup failed. The last successful snapshot is retained and may be out of date.';
    case 'not_configured': return 'Twilio Account SID and Auth Token are not configured for usage lookups.';
    default: return 'No Twilio usage lookup has completed yet.';
  }
}

export function AdminTwilioUsage() {
  const queryKey = getGetAdminTwilioUsageBudgetQueryKey();
  const query = useGetAdminTwilioUsageBudget({ query: { queryKey } });
  const historyQuery = useGetAdminTwilioUsageHistory({
    query: { queryKey: getGetAdminTwilioUsageHistoryQueryKey() },
  });
  const save = useUpdateAdminTwilioUsageBudget();
  const refresh = useRefreshAdminTwilioUsageBudget();
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [enabled, setEnabled] = useState(false);
  const [budgetAmount, setBudgetAmount] = useState('');
  const [budgetCurrency, setBudgetCurrency] = useState('USD');
  const [warningPercent, setWarningPercent] = useState('80');
  const [formReady, setFormReady] = useState(false);
  const [currencyEdited, setCurrencyEdited] = useState(false);

  useEffect(() => {
    if (!query.data || formReady) return;
    setEnabled(query.data.enabled);
    setBudgetAmount(query.data.budgetAmount === null ? '' : String(query.data.budgetAmount));
    setBudgetCurrency(query.data.usageCurrency ?? query.data.budgetCurrency ?? 'USD');
    setWarningPercent(String(query.data.warningPercent));
    setFormReady(true);
  }, [query.data, formReady]);
  useEffect(() => {
    if (query.data?.usageCurrency && !currencyEdited) setBudgetCurrency(query.data.usageCurrency);
  }, [query.data?.usageCurrency, currencyEdited]);

  if (query.isLoading) return <ListSkeleton />;
  if (query.isError || !query.data) return <ErrorState error={query.error} onRetry={() => query.refetch()} />;

  const data = query.data;
  const numericBudget = budgetAmount.trim() === '' ? null : Number(budgetAmount);
  const numericWarning = Number(warningPercent);
  const validCurrency = /^[A-Za-z]{3}$/.test(budgetCurrency.trim());
  const validBudget = numericBudget === null
    ? !enabled
    : Number.isFinite(numericBudget) && numericBudget >= 0.01 && numericBudget <= 1_000_000_000;
  const validWarning = Number.isInteger(numericWarning) && numericWarning >= 50 && numericWarning <= 95;
  const canSave = formReady && validBudget && validCurrency && validWarning && !save.isPending;

  const submit = (event: React.FormEvent) => {
    event.preventDefault();
    if (!canSave) return;
    save.mutate({
      data: {
        enabled,
        budgetAmount: numericBudget,
        budgetCurrency: budgetCurrency.trim().toUpperCase(),
        warningPercent: numericWarning,
      },
    }, {
      onSuccess: (result) => {
        queryClient.setQueryData(queryKey, result);
        setBudgetAmount(result.budgetAmount === null ? '' : String(result.budgetAmount));
        setBudgetCurrency(result.budgetCurrency);
        setWarningPercent(String(result.warningPercent));
        setEnabled(result.enabled);
        trackEvent('twilio_alert_settings_saved', { enabled: result.enabled });
        toast({ title: 'Twilio usage alert settings saved' });
      },
      onError: (error) => toast({ title: 'Could not save usage settings', description: errMsg(error), variant: 'destructive' }),
    });
  };

  const runRefresh = () => refresh.mutate(undefined, {
    onSuccess: (result) => {
      queryClient.setQueryData(queryKey, result);
      queryClient.invalidateQueries({ queryKey: getGetAdminTwilioUsageHistoryQueryKey() });
      toast({
        title: result.lookupStatus === 'success' ? 'Twilio usage refreshed' : 'Usage lookup status updated',
        description: lookupMessage(result.lookupStatus),
      });
    },
    onError: (error) => toast({ title: 'Could not refresh Twilio usage', description: errMsg(error), variant: 'destructive' }),
  });

  return (
    <div className="max-w-4xl space-y-5" data-testid="admin-twilio-usage">
      <Notice icon={<Info />}>
        Razorpay Test Mode does not make Twilio calls free. The amount below is Twilio's posted Programmable Video account usage; Group Room participant minutes are shown separately. Other Video activity on this Twilio account may be included.
        <p className="mt-2">Twilio usage can lag by up to 24 hours. These alerts are not a spending cap: calls are not blocked or disconnected, and active consultations continue.</p>
      </Notice>

      <section className="space-y-4 rounded-3xl border bg-card p-5 md:p-7">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 className="font-display text-2xl font-semibold">Monthly call-usage alerts</h2>
            <p className="mt-1 text-sm text-muted-foreground">Get an in-app warning at your chosen percentage and another when posted Video usage reaches the budget.</p>
          </div>
          <Button variant="outline" className="rounded-full" onClick={runRefresh} disabled={refresh.isPending}>
            {refresh.isPending ? <Loader2 className="animate-spin" /> : <RefreshCw />}
            Refresh from Twilio
          </Button>
        </div>

        <div className="grid gap-3 sm:grid-cols-2">
          <div className="rounded-2xl border bg-background p-4">
            <p className="text-sm text-muted-foreground">Posted Programmable Video charges</p>
            <p className="mt-1 font-display text-3xl font-semibold" data-testid="text-twilio-video-spend">
              {formatMoney(data.currentSpend, data.usageCurrency)}
            </p>
            <p className="mt-2 text-xs text-muted-foreground">
              Period: {data.periodStart ?? 'not reported'}{data.periodEnd ? ` – ${data.periodEnd}` : ''}
            </p>
          </div>
          <div className="rounded-2xl border bg-background p-4">
            <p className="text-sm text-muted-foreground">Group Room participant minutes</p>
            <p className="mt-1 font-display text-3xl font-semibold" data-testid="text-twilio-participant-minutes">
              {data.participantMinutes === null ? 'Not available' : data.participantMinutes.toLocaleString()}
            </p>
            <p className="mt-2 text-xs text-muted-foreground">Actual usage reported by Twilio; no rate-based estimate is used.</p>
          </div>
        </div>

        <div className="rounded-2xl border bg-secondary/40 p-4 text-sm" role="status" data-testid="text-twilio-usage-status">
          <p className="font-medium">{lookupMessage(data.lookupStatus)}</p>
          <p className="mt-1 text-muted-foreground">Last lookup attempt: {formatDate(data.lastAttemptAt)} · Latest successful lookup: {formatDate(data.lastSuccessAt)}</p>
          <p className="mt-1 text-muted-foreground">Provider data as of: {formatDate(data.usageAsOf)}</p>
        </div>

        {!data.providerConfigured && (
          <Notice icon={<AlertTriangle />}>Usage lookup is unavailable until Twilio Account SID and Auth Token are configured. You can still save the budget settings; refresh manually after configuration.</Notice>
        )}
        {data.dataDelayed && data.usageAsOf && (
          <Notice icon={<AlertTriangle />}>The latest provider snapshot is older than 24 hours. Treat the displayed amount as stale until a newer lookup succeeds.</Notice>
        )}
        {data.dataDelayed && !data.usageAsOf && data.currentSpend !== null && (
          <Notice icon={<AlertTriangle />}>Twilio did not return an as-of timestamp for this amount, so its freshness is unknown.</Notice>
        )}
        {data.currentSpend !== null && data.usageCurrency && data.budgetAmount !== null && !data.currencyMatches && (
          <Notice icon={<AlertTriangle />}>
            Twilio reports {data.usageCurrency}, but the budget is set to {data.budgetCurrency}. No alert comparison is made until both currencies match.
          </Notice>
        )}
        {data.currentSpend !== null && !data.periodCurrent && (
          <Notice icon={<AlertTriangle />}>This snapshot is not for the current UTC month, so it is displayed for reference only and cannot trigger a current-month alert.</Notice>
        )}
        {data.lookupStatus === 'partial' && (
          <Notice icon={<AlertTriangle />}>Only participant-minute data was available. The total charge is not estimated and the budget warning remains paused.</Notice>
        )}
        {data.lookupStatus === 'failed' && (
          <Notice icon={<AlertTriangle />}>A failed lookup does not mean there were no charges. The previous successful amount is kept, and another lookup is scheduled automatically.</Notice>
        )}
        {data.alertLevel === 'approaching' && (
          <Notice icon={<AlertTriangle />}>Last reported usage has reached the configured warning threshold. The amount may be delayed; active calls remain available.</Notice>
        )}
        {data.alertLevel === 'reached' && (
          <Notice icon={<AlertTriangle />}>Last reported usage has reached or exceeded this budget. This is an alert only; calls continue and may incur additional charges.</Notice>
        )}

        <form className="space-y-4 border-t pt-5" onSubmit={submit}>
          <label className="flex items-start justify-between gap-5 rounded-2xl border p-4">
            <span>
              <span className="block font-medium">Enable monthly alerts</span>
              <span className="text-sm text-muted-foreground">Alerts are saved in the owner's in-app notifications; email and push follow the existing notification preferences.</span>
            </span>
            <Switch checked={enabled} onCheckedChange={setEnabled} data-testid="switch-twilio-budget-enabled" />
          </label>
          <div className="grid gap-4 sm:grid-cols-3">
            <div>
              <Label htmlFor="twilio-budget-amount">Monthly budget</Label>
              <Input
                id="twilio-budget-amount"
                className="mt-1.5"
                type="number"
                min="0.01"
                max="1000000000"
                step="0.01"
                value={budgetAmount}
                onChange={(event) => setBudgetAmount(event.target.value)}
                placeholder="100"
                data-testid="input-twilio-budget-amount"
              />
            </div>
            <div>
              <Label htmlFor="twilio-budget-currency">Currency code</Label>
              <Input
                id="twilio-budget-currency"
                className="mt-1.5 uppercase"
                maxLength={3}
                value={budgetCurrency}
                onChange={(event) => { setCurrencyEdited(true); setBudgetCurrency(event.target.value.toUpperCase()); }}
                placeholder={data.usageCurrency ?? 'USD'}
                data-testid="input-twilio-budget-currency"
              />
              <p className="mt-1 text-xs text-muted-foreground">Use the currency code Twilio reports above.</p>
            </div>
            <div>
              <Label htmlFor="twilio-budget-warning">Warn at</Label>
              <div className="mt-1.5 flex items-center gap-2">
                <Input
                  id="twilio-budget-warning"
                  type="number"
                  min="50"
                  max="95"
                  step="1"
                  value={warningPercent}
                  onChange={(event) => setWarningPercent(event.target.value)}
                  data-testid="input-twilio-budget-warning"
                />
                <span className="text-sm text-muted-foreground">%</span>
              </div>
            </div>
          </div>
          {enabled && numericBudget === null && <p className="text-sm text-destructive">Enter a positive budget before enabling alerts.</p>}
          <Button type="submit" className="rounded-full" disabled={!canSave} data-testid="button-save-twilio-budget">
            {save.isPending && <Loader2 className="animate-spin" />}
            Save alert settings
          </Button>
        </form>
      </section>

      <section aria-labelledby="twilio-usage-history-title" className="space-y-4 rounded-3xl border bg-card p-5 md:p-7">
        <div>
          <h2 id="twilio-usage-history-title" className="font-display text-2xl font-semibold">Monthly usage history</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Account-level posted Programmable Video charges and Group Room minutes from Twilio. Charges come from Twilio records; no rate-based estimates are added. After the first refresh, snapshots update hourly even when budget alerts are off.
          </p>
        </div>
        {historyQuery.isLoading ? (
          <p role="status" className="text-sm text-muted-foreground">Loading monthly usage history…</p>
        ) : historyQuery.isError ? (
          <div role="alert" className="rounded-2xl border border-destructive/30 bg-destructive/5 p-4">
            <p className="text-sm">Monthly usage history could not be loaded.</p>
            <Button variant="outline" size="sm" className="mt-3" onClick={() => historyQuery.refetch()}>Try again</Button>
          </div>
        ) : historyQuery.data?.months.length ? (
          <ul className="space-y-3" data-testid="list-twilio-usage-history">
            {historyQuery.data.months.map((month) => (
              <li key={month.periodStart} className="rounded-2xl border bg-background p-4" data-testid={`row-twilio-usage-${month.periodStart}`}>
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <h3 className="font-semibold">{formatMonth(month.periodStart)}</h3>
                  <span className="rounded-full bg-secondary px-3 py-1 text-xs font-medium">{historyStatus(month.status)}</span>
                </div>
                <p className="mt-1 text-xs text-muted-foreground">
                  {month.status === 'no_data' ? 'Month checked (UTC)' : 'Twilio period'}: {month.periodStart}{month.periodEnd ? ` – ${month.periodEnd}` : ''}
                </p>
                <dl className="mt-4 grid gap-3 sm:grid-cols-2">
                  <div>
                    <dt className="text-xs text-muted-foreground">Programmable Video charges</dt>
                    <dd className="mt-1 font-medium">
                      {month.status === 'success' && month.spend !== null
                        ? formatMoney(month.spend, month.currency)
                        : month.status === 'no_data' ? 'No data reported' : 'Not reported'}
                    </dd>
                  </div>
                  <div>
                    <dt className="text-xs text-muted-foreground">Group Room participant minutes</dt>
                    <dd className="mt-1 font-medium">
                      {month.participantMinutes === null ? 'Not available' : month.participantMinutes.toLocaleString()}
                    </dd>
                  </div>
                  <div>
                    <dt className="text-xs text-muted-foreground">Twilio data as of</dt>
                    <dd className="mt-1 text-sm">{formatDate(month.usageAsOf)}</dd>
                  </div>
                  <div>
                    <dt className="text-xs text-muted-foreground">Last checked</dt>
                    <dd className="mt-1 text-sm">{formatDate(month.checkedAt)}</dd>
                  </div>
                </dl>
              </li>
            ))}
          </ul>
        ) : (
          <p className="rounded-2xl border border-dashed p-4 text-sm text-muted-foreground" data-testid="empty-twilio-usage-history">
            No monthly snapshots are saved yet. History starts when Twilio returns the first completed lookup; earlier periods are not reconstructed from the latest snapshot.
          </p>
        )}
      </section>
    </div>
  );
}
