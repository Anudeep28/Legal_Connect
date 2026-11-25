import { useUser } from '@clerk/react';
import { CheckCircle2, CircleAlert, Loader2, RefreshCw } from 'lucide-react';
import { useGetAdminSystemStatus } from '@workspace/api-client-react';
import { Button } from '@/components/ui/button';
import { fmtDateTime } from '@/lib/format';
import { cn } from '@/lib/utils';

const databaseLabels = {
  unknown: 'Waiting for first check',
  ready: 'Available',
  unavailable: 'Unavailable',
} as const;

export function AdminSystemStatus() {
  const { isLoaded, isSignedIn } = useUser();
  const query = useGetAdminSystemStatus({
    query: {
      enabled: isLoaded && Boolean(isSignedIn),
      refetchInterval: 15_000,
      refetchOnWindowFocus: true,
      retry: false,
      staleTime: 0,
    },
  });
  const status = query.data;
  if (!status) return null;

  const databaseUnavailable = status.database === 'unavailable';
  return (
    <section
      className="mb-5 rounded-3xl border bg-card p-5 md:p-6"
      aria-labelledby="admin-system-status-title"
      data-testid="admin-system-status"
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-xs font-mono uppercase tracking-widest text-muted-foreground">Owner status</p>
          <h2 id="admin-system-status-title" className="mt-1 font-display text-2xl font-semibold">System availability</h2>
          <p className="mt-1 text-sm text-muted-foreground">Safe service health only; no database connection details are shown.</p>
        </div>
        <Button
          type="button"
          size="icon"
          variant="outline"
          aria-label="Refresh system status"
          onClick={() => { void query.refetch(); }}
          disabled={query.isFetching}
        >
          {query.isFetching ? <Loader2 className="animate-spin" /> : <RefreshCw />}
        </Button>
      </div>

      <div className="mt-5 grid gap-3 sm:grid-cols-2">
        <StatusValue label="API liveness" value="Live" healthy />
        <StatusValue
          label="Database readiness"
          value={databaseLabels[status.database]}
          healthy={status.database === 'ready'}
          warning={databaseUnavailable}
        />
        <StatusValue
          label="Last database check"
          value={status.checkedAt ? fmtDateTime(status.checkedAt) : 'Not checked yet'}
        />
        <StatusValue
          label="Last successful database check"
          value={status.lastSuccessfulCheckAt ? fmtDateTime(status.lastSuccessfulCheckAt) : 'No successful check recorded'}
        />
      </div>
      {databaseUnavailable && (
        <p className="mt-4 rounded-xl border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive">
          Database-backed requests may be temporarily unavailable. The status refreshes automatically.
        </p>
      )}
    </section>
  );
}

function StatusValue({
  label,
  value,
  healthy,
  warning,
}: {
  label: string;
  value: string;
  healthy?: boolean;
  warning?: boolean;
}) {
  return (
    <div className="rounded-2xl border p-4">
      <div className="text-xs uppercase tracking-wide text-muted-foreground">{label}</div>
      <div className={cn(
        'mt-1 flex items-center gap-2 font-medium',
        healthy && 'text-emerald-700',
        warning && 'text-destructive',
      )}>
        {healthy ? <CheckCircle2 className="h-4 w-4" aria-hidden="true" /> :
          warning ? <CircleAlert className="h-4 w-4" aria-hidden="true" /> : null}
        <span>{value}</span>
      </div>
    </div>
  );
}
