import { useState } from 'react';
import { useGetAdminAiUsage } from '@workspace/api-client-react';
import { Button } from '@/components/ui/button';
import { ErrorState, ListSkeleton, Notice } from '@/components/kit';
import { cn } from '@/lib/utils';

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
  const query = useGetAdminAiUsage({ days }, { query: { staleTime: 30_000 } });

  if (query.isLoading) return <ListSkeleton />;
  if (query.isError || !query.data) return <ErrorState error={query.error} onRetry={() => query.refetch()} />;

  const rows = query.data.rows;
  const totalRequests = rows.reduce((sum, row) => sum + row.requests, 0);
  const totalSuccesses = rows.reduce((sum, row) => sum + (row.successfulRequestsKnown ? row.successfulRequests : 0), 0);
  const hasUnreportedSuccesses = rows.some((row) => !row.successfulRequestsKnown);
  const pricedRows = rows.filter((row) => row.estimatedCostUsd !== null);
  const totalEstimatedUsd = pricedRows.length
    ? pricedRows.reduce((sum, row) => sum + (row.estimatedCostUsd ?? 0), 0)
    : null;
  const hasUnpricedDeepSeekRows = rows.some((row) =>
    row.provider === 'deepseek' && (row.estimatedCostUsd === null || row.pricedRequests < row.requests));

  return (
    <div className="space-y-5" data-testid="admin-ai-usage">
      <Notice>
        This owner-only report stores daily counts and provider-reported token totals only. It never stores prompts, transcripts, or case facts, and these aggregates are deleted after {query.data.retentionDays} days. Requests include attempts that may have failed. Cost is an estimate only when token usage and both configured DeepSeek rates are available; ElevenLabs charges are not estimated without provider-reported billable usage.
      </Notice>

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
