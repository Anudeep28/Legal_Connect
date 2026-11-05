import { useState } from 'react';
import { Link } from 'wouter';
import { ArrowRight, MessagesSquare } from 'lucide-react';
import { useListConsultations, type Account, type Consultation } from '@workspace/api-client-react';
import { Button } from '@/components/ui/button';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Guard } from '@/components/guard';
import { AppPage } from '@/components/shell';
import { DemoTag, EmptyState, ErrorState, ListSkeleton, PageHeader, PersonAvatar, StatusPill } from '@/components/kit';
import { fmtDateTime, inr } from '@/lib/format';

type TabKey = 'open' | 'incoming' | 'completed' | 'cancelled';

export default function Consultations() {
  return (
    <AppPage>
      <Guard>{(me) => <Inner me={me} />}</Guard>
    </AppPage>
  );
}

function Inner({ me }: { me: Account }) {
  const q = useListConsultations();
  const [tab, setTab] = useState<TabKey>('open');
  const all = [...(q.data ?? [])].sort((a, b) => b.startsAt.localeCompare(a.startsAt));
  const groups: Record<TabKey, Consultation[]> = {
    open: all.filter((c) => c.status === 'requested' || c.status === 'booked'),
    incoming: all.filter((c) => c.userId !== me.id && c.status === 'requested'),
    completed: all.filter((c) => c.status === 'completed'),
    cancelled: all.filter((c) => c.status === 'cancelled'),
  };
  const showIncoming = me.role !== 'client';
  const list = groups[tab];

  return (
    <>
      <PageHeader
        eyebrow="Consultations"
        title="Your conversations with advocates"
        sub={showIncoming ? 'Requests you made and requests clients sent to you, in one place.' : 'Payment and lawyer acceptance are separate steps. Saving a request does not charge you.'}
        actions={<Button asChild className="rounded-full"><Link href="/lawyers">New request</Link></Button>}
      />
      <Tabs value={tab} onValueChange={(v) => setTab(v as TabKey)} className="mb-6">
        <TabsList className="h-auto flex-wrap rounded-full bg-secondary p-1">
          {(['open', ...(showIncoming ? ['incoming'] : []), 'completed', 'cancelled'] as TabKey[]).map((k) => (
            <TabsTrigger key={k} value={k} className="rounded-full px-4 capitalize data-[state=active]:bg-card" data-testid={`tab-${k}`}>
              {k === 'incoming' ? 'Needs your answer' : k} <span className="ml-1.5 font-mono text-[11px] opacity-60">{groups[k].length}</span>
            </TabsTrigger>
          ))}
        </TabsList>
      </Tabs>
      {q.isLoading ? (
        <ListSkeleton />
      ) : q.isError ? (
        <ErrorState error={q.error} onRetry={() => q.refetch()} />
      ) : list.length === 0 ? (
        <EmptyState
          icon={<MessagesSquare />}
          title={tab === 'open' ? 'No open consultations' : `Nothing ${tab === 'incoming' ? 'waiting' : tab} yet`}
          body={tab === 'open' ? 'When you request time with an advocate it will appear here with its status.' : 'This list fills in as consultations move along.'}
          action={tab === 'open' ? <Button asChild><Link href="/lawyers">Find a lawyer</Link></Button> : undefined}
        />
      ) : (
        <ul className="space-y-3">
          {list.map((c, i) => {
            const asClient = c.userId === me.id;
            return (
              <li key={c.id} className="rise" style={{ animationDelay: `${i * 40}ms` }}>
                <Link href={`/consultations/${c.id}`} className="lift group flex flex-col gap-4 rounded-2xl border bg-card p-4 sm:flex-row sm:items-center md:p-5" data-testid={`row-consultation-${c.id}`}>
                  <PersonAvatar name={asClient ? c.lawyerName : c.clientName} src={asClient ? c.lawyerAvatar : undefined} />
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="truncate text-[16px] font-semibold group-hover:text-primary">{c.topic}</span>
                      {c.demo && <DemoTag />}
                    </div>
                    <div className="mt-0.5 text-[13px] text-muted-foreground">
                      {asClient ? `with ${c.lawyerName}` : `from ${c.clientName}`} · {fmtDateTime(c.startsAt)} IST · {inr(c.fee)}
                    </div>
                  </div>
                  <div className="flex items-center gap-3">
                    <span className="rounded-full border px-2 py-0.5 font-mono text-[10px] uppercase text-muted-foreground">{asClient ? 'You booked' : 'Client request'}</span>
                    <StatusPill status={c.status} />
                    <ArrowRight className="hidden h-4 w-4 text-muted-foreground sm:block" />
                  </div>
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </>
  );
}
