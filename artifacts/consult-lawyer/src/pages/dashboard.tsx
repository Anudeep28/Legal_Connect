import { Link } from 'wouter';
import { ArrowRight, CalendarClock, Inbox, FileText, Search, Scale, Bell, Hourglass, CheckCircle2, ShieldCheck } from 'lucide-react';
import {
  useListConsultations,
  useListNotifications,
  getListNotificationsQueryKey,
  useGetLawyerProfile,
  getGetLawyerProfileQueryKey,
  type Account,
  type Consultation,
} from '@workspace/api-client-react';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { Guard } from '@/components/guard';
import { AppPage } from '@/components/shell';
import { DemoTag, EmptyState, ErrorState, PersonAvatar, StatusPill } from '@/components/kit';
import { fmtDateTime, inr, relTime } from '@/lib/format';

export default function Dashboard() {
  return (
    <AppPage>
      <Guard>{(me) => <DashboardInner me={me} />}</Guard>
    </AppPage>
  );
}

function DashboardInner({ me }: { me: Account }) {
  const consults = useListConsultations();
  const notifs = useListNotifications({ query: { queryKey: getListNotificationsQueryKey() } });
  const isLawyer = me.role === 'lawyer';
  const profile = useGetLawyerProfile({ query: { enabled: isLawyer, queryKey: getGetLawyerProfileQueryKey(), retry: false } });
  const all = consults.data ?? [];
  const now = Date.now();
  const upcoming = all.filter((c) => (c.status === 'booked' || c.status === 'requested') && new Date(c.endsAt).getTime() > now).sort((a, b) => a.startsAt.localeCompare(b.startsAt));
  const incoming = all.filter((c) => c.userId !== me.id && c.status === 'requested');
  const completed = all.filter((c) => c.status === 'completed').length;
  const next = upcoming[0];
  const hour = Number(new Intl.DateTimeFormat('en-IN', { timeZone: 'Asia/Kolkata', hour: 'numeric', hour12: false }).format(new Date()));
  const greet = hour < 12 ? 'Good morning' : hour < 17 ? 'Good afternoon' : 'Good evening';

  return (
    <div>
      <div className="rise mb-8 flex flex-col justify-between gap-4 md:flex-row md:items-end">
        <div>
          <p className="font-mono text-[11px] uppercase tracking-[0.2em] text-primary/70">{greet}</p>
          <h1 className="mt-1 text-4xl font-semibold md:text-5xl" data-testid="text-greeting">{me.name.split(' ')[0] || 'there'}.</h1>
          <p className="mt-2 text-muted-foreground">
            {upcoming.length ? `You have ${upcoming.length} open ${upcoming.length === 1 ? 'consultation' : 'consultations'}.` : 'Nothing scheduled yet. Take your time.'}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button asChild className="rounded-full"><Link href="/lawyers"><Search /> Find a lawyer</Link></Button>
          {me.role !== 'client' && <Button asChild variant="outline" className="rounded-full"><Link href="/documents"><FileText /> Documents</Link></Button>}
          {me.role === 'admin' && <Button asChild variant="outline" className="rounded-full"><Link href="/admin"><ShieldCheck /> Admin</Link></Button>}
        </div>
      </div>

      {isLawyer && profile.data && profile.data.approvalStatus !== 'approved' && (
        <Link href="/lawyer/profile" className="rise mb-6 flex items-center gap-4 rounded-2xl border border-haldi/60 bg-haldi/15 p-4" data-testid="banner-approval">
          <Hourglass className="h-5 w-5 text-primary" />
          <div className="flex-1 text-sm">
            <strong>{profile.data.approvalStatus === 'pending' ? 'Your lawyer application is under review.' : 'Your application needs changes.'}</strong>{' '}
            {profile.data.approvalStatus === 'pending' ? 'You can already use the document workspace.' : profile.data.rejectionReason}
          </div>
          <ArrowRight className="h-4 w-4" />
        </Link>
      )}

      <div className="grid gap-6 lg:grid-cols-[1.4fr_1fr]">
        <div className="space-y-6">
          {consults.isLoading ? (
            <Skeleton className="h-52 rounded-3xl" />
          ) : consults.isError ? (
            <ErrorState error={consults.error} onRetry={() => consults.refetch()} />
          ) : next ? (
            <NextCard c={next} me={me} />
          ) : (
            <EmptyState
              icon={<CalendarClock />}
              title="No upcoming consultations"
              body="Browse advocates by legal area and language, then request a 30-minute slot. Nothing is charged when you send a request."
              action={<Button asChild><Link href="/lawyers">Browse lawyers</Link></Button>}
            />
          )}

          {incoming.length > 0 && (
            <section className="rounded-3xl border bg-card p-6">
              <div className="flex items-center justify-between">
                <h2 className="flex items-center gap-2 text-xl font-semibold"><Inbox className="h-5 w-5 text-primary" /> Requests waiting for you</h2>
                <span className="rounded-full bg-haldi px-2.5 py-0.5 font-mono text-xs text-ink">{incoming.length}</span>
              </div>
              <ul className="mt-4 divide-y">
                {incoming.slice(0, 5).map((c) => (
                  <li key={c.id}>
                    <Link href={`/consultations/${c.id}`} className="flex items-center gap-3 py-3 hover:text-primary" data-testid={`link-incoming-${c.id}`}>
                      <PersonAvatar name={c.clientName} className="h-10 w-10 rounded-xl" />
                      <div className="min-w-0 flex-1">
                        <div className="truncate font-medium">{c.topic}</div>
                        <div className="text-xs text-muted-foreground">{c.clientName} · {fmtDateTime(c.startsAt)}</div>
                      </div>
                      <ArrowRight className="h-4 w-4" />
                    </Link>
                  </li>
                ))}
              </ul>
            </section>
          )}

          {upcoming.length > 1 && (
            <section className="rounded-3xl border bg-card p-6">
              <h2 className="text-xl font-semibold">Also coming up</h2>
              <ul className="mt-3 divide-y">
                {upcoming.slice(1, 6).map((c) => (
                  <li key={c.id}>
                    <Link href={`/consultations/${c.id}`} className="flex items-center justify-between gap-3 py-3 hover:text-primary">
                      <span className="min-w-0"><span className="block truncate font-medium">{c.topic}</span><span className="text-xs text-muted-foreground">{fmtDateTime(c.startsAt)}</span></span>
                      <StatusPill status={c.status} />
                    </Link>
                  </li>
                ))}
              </ul>
            </section>
          )}
        </div>

        <div className="space-y-6">
          <section className="grid grid-cols-2 gap-3">
            <Stat label="Open" value={upcoming.length} />
            <Stat label="Completed" value={completed} />
            <Stat label="Plan" value={me.subscriptionPlan || 'Free'} small />
            <Stat label="Document credits" value={me.documentCredits} />
          </section>

          <section className="rounded-3xl border bg-card p-6">
            <div className="flex items-center justify-between">
              <h2 className="flex items-center gap-2 text-lg font-semibold"><Bell className="h-4 w-4 text-primary" /> Latest updates</h2>
              <Link href="/notifications" className="text-xs font-medium text-primary">View all</Link>
            </div>
            {notifs.isLoading ? (
              <Skeleton className="mt-4 h-24" />
            ) : (notifs.data ?? []).length === 0 ? (
              <p className="mt-4 text-sm text-muted-foreground">No notifications yet.</p>
            ) : (
              <ul className="mt-3 space-y-3">
                {(notifs.data ?? []).slice(0, 4).map((n) => (
                  <li key={n.id} className="flex gap-3">
                    <span className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${n.read ? 'bg-border' : 'bg-haldi'}`} />
                    <div className="min-w-0"><div className="truncate text-sm font-medium">{n.title}</div><div className="text-xs text-muted-foreground">{relTime(n.createdAt)}</div></div>
                  </li>
                ))}
              </ul>
            )}
          </section>

          {me.role === 'client' && (
            <Link href="/lawyer/profile" className="lift block rounded-3xl ink-panel p-6" data-testid="link-apply">
              <Scale className="h-6 w-6 text-haldi" />
              <h3 className="mt-3 text-xl font-semibold text-white">Are you an advocate?</h3>
              <p className="mt-1 text-sm text-white/70">Apply with your Bar Council details to list your practice.</p>
            </Link>
          )}
        </div>
      </div>
    </div>
  );
}

function Stat({ label, value, small }: { label: string; value: string | number; small?: boolean }) {
  return (
    <div className="rounded-2xl border bg-card p-4">
      <div className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground">{label}</div>
      <div className={`mt-1 font-display font-semibold capitalize ${small ? 'text-xl' : 'text-3xl'}`} data-testid={`stat-${label.toLowerCase().replace(/\s/g, '-')}`}>{value}</div>
    </div>
  );
}

function NextCard({ c, me }: { c: Consultation; me: Account }) {
  const asClient = c.userId === me.id;
  return (
    <Link href={`/consultations/${c.id}`} className="lift group block overflow-hidden rounded-3xl ink-panel p-6 md:p-8 rise" data-testid="card-next-consultation">
      <div className="flex items-center justify-between">
        <p className="font-mono text-[11px] uppercase tracking-[0.2em] text-haldi">Next consultation</p>
        <div className="flex gap-2">{c.demo && <DemoTag className="bg-white/90" />}<StatusPill status={c.status} /></div>
      </div>
      <h2 className="mt-4 text-3xl font-semibold text-white md:text-4xl">{c.topic}</h2>
      <div className="mt-6 flex flex-wrap items-center gap-4">
        <PersonAvatar name={asClient ? c.lawyerName : c.clientName} src={asClient ? c.lawyerAvatar : undefined} className="h-12 w-12" />
        <div>
          <div className="font-medium text-white">{asClient ? c.lawyerName : c.clientName}</div>
          <div className="text-sm text-white/70">{fmtDateTime(c.startsAt)} IST · {inr(c.fee)}</div>
        </div>
        <span className="ml-auto inline-flex items-center gap-1 text-sm text-haldi">Open <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-1" /></span>
      </div>
      {c.status === 'requested' && <p className="mt-5 flex items-center gap-2 text-[13px] text-white/60"><CheckCircle2 className="h-4 w-4" /> Request saved. Not paid and not confirmed until the lawyer accepts.</p>}
    </Link>
  );
}
