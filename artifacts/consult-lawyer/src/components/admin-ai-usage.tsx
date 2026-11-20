import { useEffect, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { AlertTriangle, Loader2 } from 'lucide-react';
import {
  getGetAdminAiUsageQueryKey,
  useGetAdminAiUsage,
  useUpdateAdminAiUsageBudget,
} from '@workspace/api-client-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { ErrorState, ListSkeleton, Notice } from '@/components/kit';
import { cn } from '@/lib/utils';
import { useToast } from '@/hooks/use-toast';
import { errMsg } from '@/lib/format';

const ranges = [7, 30, 90] as const;

function formatUsd(value: number | null) {
  if (value === null || !Number.isFinite(value)) return 'Not available';
  return new Intl.NumberFormat(undefined, {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 4,
    maximumFractionDigits: 6,
  }).format(value);
}

function formatDay(value: string) {
  const date = new Date(value);
  return Number.isFinite(date.getTime())
    ? new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeZone: 'UTC' }).format(date)
    : value;
}

export function AdminAiUsage() {
  const [days, setDays] = useState<number>(30);
  const queryKey = getGetAdminAiUsageQueryKey({ days });
  const query = useGetAdminAiUsage({ days }, { query: { queryKey, staleTime: 30_000 } });
  const save = useUpdateAdminAiUsageBudget();
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [enabled, setEnabled] = useState(false);
  const [budgetAmount, setBudgetAmount] = useState('');
  const [warningPercent, setWarningPercent] = useState('80');
  const [formReady, setFormReady] = useState(false);

  useEffect(() => {
    if (!query.data || formReady) return;
    const budget = query.data.monthlyBudget;
    setEnabled(budget.enabled);
    setBudgetAmount(budget.monthlyBudgetUsd === null ? '' : String(budget.monthlyBudgetUsd));
    setWarningPercent(String(budget.warningPercent));
    setFormReady(true);
  }, [query.data, formReady]);

  if (query.isLoading) return <ListSkeleton />;
  if (query.isError || !query.data) return <ErrorState error={query.error} onRetry={() => query.refetch()} />;

  const rows = query.data.rows;
  const monthlyBudget = query.data.monthlyBudget;
  const totalRequests = rows.reduce((sum, row) => sum + row.requests, 0);
  const totalSuccesses = rows.reduce((sum, row) => sum + (row.successfulRequestsKnown ? row.successfulRequests : 0), 0);
  const hasUnreportedSuccesses = rows.some((row) => !row.successfulRequestsKnown);
  const pricedRows = rows.filter((row) => row.estimatedCostUsd !== null);
  const totalEstimatedUsd = pricedRows.length
    ? pricedRows.reduce((sum, row) => sum + (row.estimatedCostUsd ?? 0), 0)
    : null;
  const hasUnpricedDeepSeekRows = rows.some((row) =>
    row.provider === 'deepseek' && (row.estimatedCostUsd === null || row.pricedRequests < row.requests));
  const numericBudget = budgetAmount.trim() === '' ? null : Number(budgetAmount);
  const numericWarning = Number(warningPercent);
  const validBudget = numericBudget === null
    ? !enabled
    : Number.isFinite(numericBudget) && numericBudget >= 0.01 && numericBudget <= 1_000_000_000;
  const validWarning = Number.isInteger(numericWarning) && numericWarning >= 50 && numericWarning <= 95;
  const canSave = formReady && validBudget && validWarning && !save.isPending;

  const submitBudget = (event: React.FormEvent) => {
    event.preventDefault();
    if (!canSave) return;
    save.mutate({
      data: {
        enabled,
        monthlyBudgetUsd: numericBudget,
        warningPercent: numericWarning,
      },
    }, {
      onSuccess: (result) => {
        setEnabled(result.enabled);
        setBudgetAmount(result.monthlyBudgetUsd === null ? '' : String(result.monthlyBudgetUsd));
        setWarningPercent(String(result.warningPercent));
        queryClient.setQueryData(queryKey, (current) => current
          ? { ...current, monthlyBudget: result }
          : current);
        void queryClient.invalidateQueries({ queryKey: getGetAdminAiUsageQueryKey() });
        toast({ title: 'AI spend alert settings saved' });
      },
      onError: (error) => toast({
        title: 'Could not save AI spend settings',
        description: errMsg(error),
        variant: 'destructive',
      }),
    });
  };

  return (
    <div className="space-y-5" data-testid="admin-ai-usage">
      <Notice>
        This owner-only report stores daily counts and provider-reported token totals only. It never stores prompts, transcripts, or case facts, and these aggregates are deleted after {query.data.retentionDays} days. Requests include attempts that may have failed. Cost is an estimate only when token usage and both configured DeepSeek rates are available; ElevenLabs charges are not estimated without provider-reported billable usage.
      </Notice>

      <section className="space-y-4 rounded-3xl border bg-card p-5 md:p-7" data-testid="admin-ai-spend-alerts">
        <div>
          <h2 className="font-display text-2xl font-semibold">Monthly AI spend alerts</h2>
          <p className="mt-1 text-sm text-muted-foreground">Get an in-app warning when rate-backed estimates approach or reach your threshold. AI requests are never blocked by this alert.</p>
        </div>

        <div className="grid gap-3 sm:grid-cols-2">
          <div className="rounded-2xl border bg-background p-4">
            <p className="text-sm text-muted-foreground">Known AI cost estimate this month</p>
            <p className="mt-1 font-display text-3xl font-semibold" data-testid="text-ai-monthly-estimate">
              {formatUsd(monthlyBudget.currentMonthEstimatedUsd)}
            </p>
            <p className="mt-2 text-xs text-muted-foreground">
              UTC month starting {formatDay(monthlyBudget.monthStart)} · {monthlyBudget.pricedRequests.toLocaleString()} of {monthlyBudget.requests.toLocaleString()} requests priced
            </p>
          </div>
          <div className="rounded-2xl border bg-background p-4">
            <p className="text-sm text-muted-foreground">Monthly alert threshold</p>
            <p className="mt-1 font-display text-3xl font-semibold" data-testid="text-ai-monthly-threshold">
              {monthlyBudget.monthlyBudgetUsd === null ? 'Not set' : formatUsd(monthlyBudget.monthlyBudgetUsd)}
            </p>
            <p className="mt-2 text-xs text-muted-foreground">
              {monthlyBudget.enabled ? `Warning at ${monthlyBudget.warningPercent}%` : 'Alerts are off'}
            </p>
          </div>
        </div>

        <div className="rounded-2xl border bg-secondary/40 p-4 text-sm" role="status" data-testid="text-ai-cost-coverage">
          {monthlyBudget.costCoverage === 'no_usage' && <p>No AI usage has been recorded this UTC month; the estimate is unavailable, not zero.</p>}
          {monthlyBudget.costCoverage === 'unavailable' && <p>Requests were recorded, but no rate-backed cost is available yet. Missing costs are not treated as zero.</p>}
          {monthlyBudget.costCoverage === 'partial' && <p>Partial estimate: {monthlyBudget.pricedRequests.toLocaleString()} of {monthlyBudget.requests.toLocaleString()} requests have a rate-backed cost. Unpriced requests are not treated as zero, so actual spend may be higher.</p>}
          {monthlyBudget.costCoverage === 'complete' && <p>All recorded AI requests this month have a rate-backed estimate. This is still an estimate, not a provider invoice.</p>}
        </div>

        {monthlyBudget.alertLevel === 'approaching' && (
          <Notice icon={<AlertTriangle />}>Recorded AI cost estimates have reached the configured warning threshold. If coverage is partial, actual spend may be higher.</Notice>
        )}
        {monthlyBudget.alertLevel === 'reached' && (
          <Notice icon={<AlertTriangle />}>Recorded AI cost estimates have reached or exceeded the monthly threshold. This is an alert only; lawyer requests continue and may incur additional charges.</Notice>
        )}

        <form className="space-y-4 border-t pt-5" onSubmit={submitBudget}>
          <label className="flex items-start justify-between gap-5 rounded-2xl border p-4">
            <span>
              <span className="block font-medium">Enable monthly alerts</span>
              <span className="text-sm text-muted-foreground">Warnings appear here and in the owner’s in-app notifications. They do not block AI requests.</span>
            </span>
            <Switch checked={enabled} onCheckedChange={setEnabled} data-testid="switch-ai-budget-enabled" />
          </label>
          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <Label htmlFor="ai-budget-amount">Monthly threshold in USD</Label>
              <Input
                id="ai-budget-amount"
                className="mt-1.5"
                type="number"
                min="0.01"
                max="1000000000"
                step="0.01"
                value={budgetAmount}
                onChange={(event) => setBudgetAmount(event.target.value)}
                placeholder="100"
                data-testid="input-ai-budget-amount"
              />
            </div>
            <div>
              <Label htmlFor="ai-budget-warning">Warn at</Label>
              <div className="mt-1.5 flex items-center gap-2">
                <Input
                  id="ai-budget-warning"
                  type="number"
                  min="50"
                  max="95"
                  step="1"
                  value={warningPercent}
                  onChange={(event) => setWarningPercent(event.target.value)}
                  data-testid="input-ai-budget-warning"
                />
                <span className="text-sm text-muted-foreground">%</span>
              </div>
            </div>
          </div>
          {enabled && numericBudget === null && <p className="text-sm text-destructive">Enter a positive threshold before enabling alerts.</p>}
          <Button type="submit" className="rounded-full" disabled={!canSave} data-testid="button-save-ai-budget">
            {save.isPending && <Loader2 className="animate-spin" />}
            Save alert settings
          </Button>
        </form>
      </section>

      <section className="space-y-4 rounded-3xl border bg-card p-5 md:p-7">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <h2 className="font-display text-2xl font-semibold">Daily AI usage</h2>
            <p className="mt-1 text-sm text-muted-foreground">Usage by lawyer and provider, in UTC.</p>
          </div>
          <div className="flex gap-1.5" aria-label="AI usage date range">
            {ranges.map((range) => (
              <Button
                key={range}
                type="button"
                size="sm"
                variant="outline"
                aria-pressed={days === range}
                className={cn('rounded-full', days === range && 'border-primary bg-primary text-primary-foreground')}
                onClick={() => setDays(range)}
                data-testid={`button-ai-usage-range-${range}`}
              >
                {range} days
              </Button>
            ))}
          </div>
        </div>

        <div className="grid gap-3 sm:grid-cols-3">
          <div className="rounded-2xl border bg-background p-4">
            <p className="text-sm text-muted-foreground">Request attempts</p>
            <p className="mt-1 font-display text-3xl font-semibold" data-testid="text-ai-usage-requests">{totalRequests.toLocaleString()}</p>
          </div>
          <div className="rounded-2xl border bg-background p-4">
            <p className="text-sm text-muted-foreground">Successful responses recorded</p>
            <p className="mt-1 font-display text-3xl font-semibold" data-testid="text-ai-usage-successes">{totalSuccesses.toLocaleString()}</p>
            {hasUnreportedSuccesses && <p className="mt-1 text-xs text-muted-foreground">Earlier request totals do not include success tracking.</p>}
          </div>
          <div className="rounded-2xl border bg-background p-4">
            <p className="text-sm text-muted-foreground">Estimated DeepSeek cost</p>
            <p className="mt-1 font-display text-3xl font-semibold" data-testid="text-ai-usage-estimated-cost">{formatUsd(totalEstimatedUsd)}</p>
            <p className="mt-1 text-xs text-muted-foreground">
              {hasUnpricedDeepSeekRows ? 'Partial estimate; some usage is unpriced.' : 'USD; not a provider invoice.'}
            </p>
          </div>
        </div>
        <p className="text-xs text-muted-foreground">
          To enable DeepSeek estimates, configure the server rates `DEEPSEEK_INPUT_USD_PER_MILLION_TOKENS` and `DEEPSEEK_OUTPUT_USD_PER_MILLION_TOKENS` using your current provider pricing. Missing rates or token metadata are shown as unavailable, not zero.
        </p>

        {rows.length === 0 ? (
          <div className="rounded-2xl border border-dashed p-8 text-center">
            <p className="font-medium">No recorded AI usage in this period</p>
            <p className="mt-1 text-sm text-muted-foreground">New requests will appear here without their prompt or case content.</p>
          </div>
        ) : (
          <div className="overflow-x-auto rounded-2xl border">
            <table className="w-full min-w-[900px] text-sm">
              <thead className="border-b bg-secondary/50 text-left font-mono text-[11px] uppercase tracking-widest text-muted-foreground">
                <tr>
                  <th className="p-3">UTC day</th>
                  <th className="p-3">Lawyer</th>
                  <th className="p-3">Provider</th>
                  <th className="p-3 text-right">Requests</th>
                  <th className="p-3 text-right">Succeeded</th>
                  <th className="p-3 text-right">Tokens</th>
                  <th className="p-3 text-right">Estimated cost</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <tr key={`${row.day}-${row.lawyerId}-${row.provider}`} className="border-b last:border-0" data-testid="row-admin-ai-usage">
                    <td className="p-3 whitespace-nowrap">{formatDay(row.day)}</td>
                    <td className="p-3">{row.lawyerName}</td>
                    <td className="p-3 capitalize">{row.provider === 'deepseek' ? 'DeepSeek' : 'ElevenLabs'}</td>
                    <td className="p-3 text-right tabular-nums">{row.requests.toLocaleString()}</td>
                    <td className="p-3 text-right tabular-nums">{row.successfulRequestsKnown ? row.successfulRequests.toLocaleString() : 'Not tracked'}</td>
                    <td className="p-3 text-right tabular-nums">
                      {row.tokenUsageRequests > 0
                        ? `${row.inputTokens.toLocaleString()} in / ${row.outputTokens.toLocaleString()} out`
                        : 'Not reported'}
                    </td>
                    <td className="p-3 text-right tabular-nums">
                      {row.provider === 'deepseek' ? formatUsd(row.estimatedCostUsd) : 'Not estimated'}
                      {row.pricedRequests > 0 && row.pricedRequests < row.requests && <span className="block text-xs text-muted-foreground">Partial: some attempts may be unpriced</span>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}
