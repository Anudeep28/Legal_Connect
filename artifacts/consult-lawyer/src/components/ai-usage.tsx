import { useState } from 'react';
import { ChevronDown, ChevronUp, History } from 'lucide-react';
import { useGetWritingUsage, useGetWritingUsageHistory } from '@workspace/api-client-react';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { Notice } from './kit';

const planLabels = {
  trial: 'Trial / base',
  single: 'Single-credit',
  monthly: 'Monthly',
} as const;

function historyDate(day: string) {
  return new Date(`${day}T12:00:00.000Z`).toLocaleDateString('en-IN', {
    timeZone: 'UTC',
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  });
}

export function AiUsageNotice() {
  const [historyOpen, setHistoryOpen] = useState(false);
  const [days, setDays] = useState(30);
  const usage = useGetWritingUsage({ query: { refetchInterval: 10_000, staleTime: 0 } });
  const history = useGetWritingUsageHistory({ days }, {
    query: {
      enabled: historyOpen,
      staleTime: 0,
      refetchInterval: historyOpen ? 30_000 : false,
    },
  });
  if (usage.isError) return <Notice>AI allowance could not be loaded. Server-side limits still apply. Try again shortly.</Notice>;
  if (!usage.data) return <p className="text-sm text-muted-foreground">Loading AI allowance…</p>;
  const { plan, drafting, transcription, resetsAt } = usage.data;
  const planLabel = plan === 'monthly' ? 'Monthly' : plan === 'single' ? 'Single-credit' : 'Trial / base';
  return <Notice>
    <div className="w-full">
      <p className="font-medium">Your daily AI allowance · {planLabel} plan</p>
      <p>Drafting, improvement and translation: {drafting.remaining} of {drafting.limit} requests remaining.
        {' '}Dictation: {transcription.remaining} of {transcription.limit} remaining.</p>
      {(!drafting.remaining || !transcription.remaining) && <p className="font-medium">A daily limit has been reached. The corresponding AI action is unavailable until reset.</p>}
      <p>Resets {new Date(resetsAt).toLocaleString()} (your local time; midnight UTC).
        {' '}Provider attempts, including failed requests, count toward the allowance. Editing, saving and exports are unaffected.</p>

      <Collapsible open={historyOpen} onOpenChange={setHistoryOpen} className="mt-3 border-t border-current/15 pt-2">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <CollapsibleTrigger asChild>
            <Button variant="ghost" size="sm" className="px-2" data-testid="button-ai-history">
              <History className="h-4 w-4" />
              {historyOpen ? 'Hide usage history' : 'View usage history'}
              {historyOpen ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
            </Button>
          </CollapsibleTrigger>
          {historyOpen && (
            <Select value={String(days)} onValueChange={(value) => setDays(Number(value))}>
              <SelectTrigger className="h-8 w-[130px]" aria-label="Usage history period" data-testid="select-ai-history-days">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="7">Last 7 days</SelectItem>
                <SelectItem value="30">Last 30 days</SelectItem>
                <SelectItem value="90">Last 90 days</SelectItem>
              </SelectContent>
            </Select>
          )}
        </div>
        <CollapsibleContent>
          <div className="mt-2 space-y-2" data-testid="ai-usage-history">
            <p className="text-xs text-muted-foreground">Daily counts include requests counted against your allowance. History is retained for up to {history.data?.retentionDays ?? 90} days.</p>
            {history.isLoading ? (
              <p role="status" className="text-sm">Loading usage history…</p>
            ) : history.isError ? (
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p role="alert" className="text-sm">Usage history could not be loaded.</p>
                <Button variant="outline" size="sm" onClick={() => history.refetch()} data-testid="button-retry-ai-history">Try again</Button>
              </div>
            ) : history.data?.entries.length ? (
              <>
                <div className="overflow-x-auto rounded-lg border border-current/15">
                  <table className="w-full min-w-[540px] text-left text-xs">
                    <thead className="bg-black/5">
                      <tr>
                        <th scope="col" className="px-3 py-2 font-medium">Day (UTC)</th>
                        <th scope="col" className="px-3 py-2 font-medium">Plan used</th>
                        <th scope="col" className="px-3 py-2 text-right font-medium">Drafting</th>
                        <th scope="col" className="px-3 py-2 text-right font-medium">Transcription</th>
                      </tr>
                    </thead>
                    <tbody>
                      {history.data.entries.map((entry) => (
                        <tr key={entry.day} className="border-t border-current/10" data-testid="row-ai-usage-history">
                          <th scope="row" className="whitespace-nowrap px-3 py-2 font-medium">{historyDate(entry.day)}</th>
                          <td className="px-3 py-2">
                            {entry.plans.length
                              ? entry.plans.map((item) => planLabels[item]).join(' · ')
                              : 'Not recorded'}
                            {!entry.planHistoryComplete && <span className="ml-1 text-muted-foreground">(partial)</span>}
                          </td>
                          <td className="px-3 py-2 text-right tabular-nums">{entry.draftingRequests}</td>
                          <td className="px-3 py-2 text-right tabular-nums">{entry.transcriptionRequests}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                {history.data.entries.some((entry) => !entry.planHistoryComplete) && (
                  <p className="text-xs text-muted-foreground">Older requests were counted before plan snapshots were recorded, so those plan labels may be incomplete.</p>
                )}
              </>
            ) : (
              <p className="rounded-lg border border-dashed border-current/20 px-3 py-4 text-center text-sm">No AI requests were counted in this period.</p>
            )}
            <p className="text-xs text-muted-foreground">This view contains counts and plan labels only—no prompts, transcripts, or case details.</p>
          </div>
        </CollapsibleContent>
      </Collapsible>
    </div>
  </Notice>;
}
