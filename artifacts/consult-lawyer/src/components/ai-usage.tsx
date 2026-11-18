import { useGetWritingUsage } from '@workspace/api-client-react';
import { Notice } from './kit';

export function AiUsageNotice() {
  const usage = useGetWritingUsage({ query: { refetchInterval: 10_000, staleTime: 0 } });
  if (usage.isError) return <Notice>AI allowance could not be loaded. Server-side limits still apply. Try again shortly.</Notice>;
  if (!usage.data) return <p className="text-sm text-muted-foreground">Loading AI allowance…</p>;
  const { plan, drafting, transcription, resetsAt } = usage.data;
  const planLabel = plan === 'monthly' ? 'Monthly' : plan === 'single' ? 'Single-credit' : 'Trial / base';
  return <Notice>
    <p className="font-medium">Your daily AI allowance · {planLabel} plan</p>
    <p>Drafting, improvement and translation: {drafting.remaining} of {drafting.limit} requests remaining.
      {' '}Dictation: {transcription.remaining} of {transcription.limit} remaining.</p>
    {(!drafting.remaining || !transcription.remaining) && <p className="font-medium">A daily limit has been reached. The corresponding AI action is unavailable until reset.</p>}
    <p>Resets {new Date(resetsAt).toLocaleString()} (your local time; midnight UTC).
      {' '}Provider attempts, including failed requests, count toward the allowance. Editing, saving and exports are unaffected.</p>
  </Notice>;
}
