import { useEffect, useState } from 'react';
import { CommunicationSettings } from '@/components/communication-settings';
import { Link, useLocation } from 'wouter';
import { useQueryClient } from '@tanstack/react-query';
import { Check, Loader2, Bell, CheckCheck, Info, Scale, FileText, MessagesSquare, CalendarDays, Mic, ArrowRight } from 'lucide-react';
import {
  useGetPlatform, useUpdateMe, getGetMeQueryKey,
  useListNotifications, getListNotificationsQueryKey, useReadNotification,
  type Account, type CheckoutInputPlan,
} from '@workspace/api-client-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Skeleton } from '@/components/ui/skeleton';
import { Guard } from '@/components/guard';
import { AppPage } from '@/components/shell';
import { EmptyState, ErrorState, ListSkeleton, Notice, PageHeader } from '@/components/kit';
import { useToast } from '@/hooks/use-toast';
import { useAccount } from '@/lib/account';
import { cn } from '@/lib/utils';
import { errMsg, fmtDate, inr, relTime } from '@/lib/format';
import { policies } from '@/data/policies';
import { usePaymentCheckout } from '@/hooks/use-payment-checkout';
import { PaymentHistory } from '@/components/payment-history';

const base = import.meta.env.BASE_URL;

const TRIAL_MS = 2 * 24 * 60 * 60 * 1000;
/** Mirrors the backend rule: new documents are free for 2 days from account creation, then use document credits. */
function trialStatus(createdAt: string) {
  const ends = new Date(new Date(createdAt).getTime() + TRIAL_MS);
  const left = ends.getTime() - Date.now();
  if (!Number.isFinite(left)) return { active: false, ends, label: 'Unknown' };
  if (left <= 0) return { active: false, ends, label: `Ended ${fmtDate(ends.toISOString())}` };
  const h = Math.floor(left / 3600000);
  const m = Math.floor((left % 3600000) / 60000);
  return { active: true, ends, label: h >= 1 ? `${h}h ${m}m left` : `${m}m left` };
}

function TrialNotice({ me }: { me: Account }) {
  const t = trialStatus(me.createdAt);
  return (
    <Notice icon={<Info />} className="mb-8" data-testid="text-trial-status">
      {me.subscriptionExpiresAt && new Date(me.subscriptionExpiresAt).getTime() > Date.now() && <p>Your 30-day document plan is active until <strong>{fmtDate(me.subscriptionExpiresAt)}</strong>. It does not renew automatically.</p>}
      {t.active
        ? <>Your free trial for creating new documents ends <strong>{fmtDate(t.ends.toISOString())}</strong> ({t.label}). After that, each new or duplicated document uses a document credit; you have <strong>{me.documentCredits}</strong>. Editing and exporting existing documents stays available.</>
        : <>Your 2-day trial for new documents <strong>has ended</strong> ({fmtDate(t.ends.toISOString())}). New or duplicated documents now use document credits; you have <strong>{me.documentCredits}</strong>. Editing and exporting existing documents stays available.</>}
    </Notice>
  );
}

/* ---------------- PLANS ---------------- */
export function Plans() {
  const platform = useGetPlatform();
  const checkout = usePaymentCheckout();
  const { signedIn, me } = useAccount();
  const paymentsEnabled = !!platform.data?.paymentsEnabled;

  const buy = (plan: CheckoutInputPlan) => checkout.start({ plan });

  return (
    <AppPage>
      <PageHeader eyebrow="Plans for advocates" title={<>Document plans, <span className="italic text-primary">priced plainly</span></>} sub="Plans cover the document workspace: templates, dictation and AI drafting. Consultation fees are set by each lawyer per 30 minutes." />
      {me && <TrialNotice me={me} />}
      <Notice icon={<Info />} className="mb-8">{paymentsEnabled
        ? <>Payments are processed by Razorpay. Access starts only after server verification. The ₹499 plan lasts 30 days with no automatic renewal. Unused document purchases are refundable within seven days. <Link href="/refund-policy" className="underline">Refund rules</Link>.</>
        : <>Checkout is <strong>disabled pending Razorpay verification</strong>. Plans cannot be purchased yet. Adding credentials alone will not enable payments.</>}</Notice>
      {me?.role === 'admin' && <Notice icon={<Info />} className="mb-8">
        <p><strong>Administrator verification only.</strong> After dedicated Razorpay keys and the signed webhook are configured, run a ₹10 verification purchase here. Test-mode checkout does not move real funds; live-mode checkout charges ₹10. This does not enable general checkout.</p>
        <Button variant="outline" className="mt-3" disabled={checkout.pending} onClick={() => {
          if (window.confirm('Open a ₹10 Razorpay verification purchase? Live-mode credentials will charge real money. This will not enable general checkout.')) checkout.startValidation();
        }}>Verify Razorpay (admin)</Button>
      </Notice>}
      {platform.isLoading ? (
        <div className="grid gap-4 md:grid-cols-3">{[0, 1, 2].map((i) => <Skeleton key={i} className="h-96 rounded-3xl" />)}</div>
      ) : platform.isError ? (
        <ErrorState error={platform.error} onRetry={() => platform.refetch()} />
      ) : (
        <div className="grid items-stretch gap-4 md:grid-cols-3">
          {(platform.data?.plans ?? []).map((p, i) => {
            const featured = p.id === 'monthly';
            const purchasable = p.id === 'single' || p.id === 'monthly';
            return (
              <div key={p.id} className={cn('rise relative flex flex-col rounded-[1.75rem] border p-7', featured ? 'ink-panel md:-translate-y-3 shadow-xl' : 'bg-card')} style={{ animationDelay: `${i * 80}ms` }} data-testid={`card-plan-${p.id}`}>
                {featured && <span className="absolute -top-3 left-7 rounded-full bg-haldi px-3 py-1 font-mono text-[10px] uppercase tracking-widest text-ink">For regular drafting</span>}
                <h3 className={cn('text-2xl font-semibold', featured && 'text-white')}>{p.name}</h3>
                <p className={cn('mt-1 text-sm', featured ? 'text-white/70' : 'text-muted-foreground')}>{p.description}</p>
                <div className={cn('mt-6 font-display text-5xl font-semibold', featured && 'text-white')}>{p.price === 0 ? 'Free' : inr(p.price)}</div>
                <ul className="mt-6 flex-1 space-y-2.5">
                  {p.features.map((f) => (
                    <li key={f} className={cn('flex gap-2 text-[14px]', featured ? 'text-white/85' : '')}><Check className={cn('mt-0.5 h-4 w-4 shrink-0', featured ? 'text-haldi' : 'text-primary')} />{f}</li>
                  ))}
                </ul>
                <Button
                  className={cn('mt-7 rounded-full', featured && 'bg-haldi text-ink hover:bg-haldi')}
                  variant={featured ? 'default' : 'outline'}
                  disabled={!purchasable || !paymentsEnabled || !signedIn || me?.role !== 'lawyer' || checkout.pending || (p.id === 'monthly' && !!me.subscriptionExpiresAt && new Date(me.subscriptionExpiresAt).getTime() > Date.now())}
                  onClick={() => purchasable && buy(p.id as CheckoutInputPlan)}
                  data-testid={`button-plan-${p.id}`}
                >
                  {!purchasable ? (me?.subscriptionPlan === p.id ? 'Your current plan' : 'Included at sign-up for 2 days') : paymentsEnabled ? 'Choose plan' : 'Checkout not connected'}
                </Button>
              </div>
            );
          })}
        </div>
      )}
      {signedIn && me?.role !== 'lawyer' && <p className="mt-4 text-sm text-muted-foreground">Document plans are for lawyer accounts. Consultation payments are available from your consultation request.</p>}
      <PaymentHistory />
    </AppPage>
  );
}

/* ---------------- SETTINGS ---------------- */
export function Settings() {
  return (
    <AppPage>
      <PageHeader eyebrow="Account" title="Settings" />
      <Guard>{(me) => <SettingsForm me={me} />}</Guard>
    </AppPage>
  );
}
function SettingsForm({ me }: { me: Account }) {
  const platform = useGetPlatform();
  const [name, setName] = useState(me.name);
  const [emails, setEmails] = useState(me.emailNotifications);
  const upd = useUpdateMe();
  const qc = useQueryClient();
  const { toast } = useToast();
  useEffect(() => {
    setName(me.name);
    setEmails(me.emailNotifications);
  }, [me.id, me.name, me.emailNotifications]);
  const dirty = name.trim() !== me.name || emails !== me.emailNotifications;
  const save = () =>
    upd.mutate(
      { data: { name: name.trim(), emailNotifications: emails } },
      {
        onSuccess: (a) => { qc.setQueryData(getGetMeQueryKey(), a); toast({ title: 'Settings saved' }); },
        onError: (e) => toast({ title: 'Could not save', description: errMsg(e), variant: 'destructive' }),
      },
    );
  return (
    <div className="space-y-6">
    <div className="grid gap-6 lg:grid-cols-[1fr_320px]">
      <div className="space-y-6 rounded-3xl border bg-card p-6 md:p-8">
        <div>
          <Label htmlFor="name">Display name</Label>
          <Input id="name" className="mt-1.5 max-w-md" maxLength={100} value={name} onChange={(e) => setName(e.target.value)} data-testid="input-name" />
          <p className="mt-1 text-xs text-muted-foreground">Shown to advocates on your consultation requests.</p>
        </div>
        <div>
          <Label>Email</Label>
          <p className="mt-1.5 text-sm" data-testid="text-email">{me.email}</p>
        </div>
        <label className="flex items-start justify-between gap-6 rounded-2xl border p-4">
          <span><span className="block font-medium">Email notifications preference</span><span className="text-sm text-muted-foreground">{platform.data?.emailEnabled ? 'Resend is configured. Opt in to outbound updates and appointment reminders. Delivery status is shown below.' : 'Resend is not configured. You can save your preference, but no email can be sent. Updates remain available in in-app Notifications.'}</span></span>
          <Switch checked={emails} onCheckedChange={setEmails} data-testid="switch-email" />
        </label>
        <Button onClick={save} disabled={!dirty || name.trim().length < 1 || upd.isPending} className="rounded-full" data-testid="button-save-settings">{upd.isPending && <Loader2 className="animate-spin" />} Save changes</Button>
      </div>
      <aside className="space-y-3 rounded-3xl border bg-secondary/50 p-6 text-sm">
        <Row k="Role" v={me.role} />
        <Row k="Status" v={me.status} />
        <Row k="Plan" v={me.subscriptionPlan || 'free'} />
        <Row k="New-document trial" v={trialStatus(me.createdAt).label} />
        <Row k="Document credits" v={String(me.documentCredits)} />
        {me.subscriptionExpiresAt && <Row k="Document plan expires" v={fmtDate(me.subscriptionExpiresAt)} />}
        <Row k="Member since" v={fmtDate(me.createdAt)} />
        {me.role === 'client' && <Link href="/lawyer/profile" className="mt-2 inline-flex items-center gap-1 font-medium text-primary">Apply as a lawyer <ArrowRight className="h-4 w-4" /></Link>}
      </aside>
    </div>
    <CommunicationSettings key={me.id} me={me} />
    </div>
  );
}
function Row({ k, v }: { k: string; v: string }) {
  return <div className="flex justify-between border-b border-dashed pb-2"><span className="text-muted-foreground">{k}</span><span className="font-medium capitalize">{v}</span></div>;
}

/* ---------------- NOTIFICATIONS ---------------- */
export function Notifications() {
  return (
    <AppPage>
      <Guard>{() => <NotificationsInner />}</Guard>
    </AppPage>
  );
}
function NotificationsInner() {
  const q = useListNotifications({ query: { queryKey: getListNotificationsQueryKey() } });
  const read = useReadNotification();
  const qc = useQueryClient();
  const [, setLocation] = useLocation();
  const items = q.data ?? [];
  const unread = items.filter((n) => !n.read);
  const markRead = (id: string, then?: () => void) =>
    read.mutate({ id }, { onSuccess: () => { qc.invalidateQueries({ queryKey: getListNotificationsQueryKey() }); then?.(); } });
  const markAll = async () => {
    await Promise.all(unread.map((n) => read.mutateAsync({ id: n.id }).catch(() => null)));
    qc.invalidateQueries({ queryKey: getListNotificationsQueryKey() });
  };
  const toInternal = (link: string) => link.replace(/^https?:\/\/[^/]+/, '').replace(base.replace(/\/$/, ''), '') || '/';
  return (
    <>
      <PageHeader eyebrow="Inbox" title="Notifications" sub={`${unread.length} unread`} actions={unread.length > 0 ? <Button variant="outline" className="rounded-full" onClick={markAll} disabled={read.isPending} data-testid="button-mark-all"><CheckCheck /> Mark all read</Button> : undefined} />
      {q.isLoading ? <ListSkeleton /> : q.isError ? <ErrorState error={q.error} onRetry={() => q.refetch()} /> : items.length === 0 ? (
        <EmptyState icon={<Bell />} title="All quiet" body="Updates about requests, accepted consultations and new documents land here." />
      ) : (
        <ul className="overflow-hidden rounded-3xl border bg-card">
          {items.map((n) => (
            <li key={n.id} className={cn('flex items-start gap-4 border-b p-5 last:border-0', !n.read && 'bg-haldi/10')} data-testid={`row-notification-${n.id}`}>
              <span className={cn('mt-2 h-2.5 w-2.5 shrink-0 rounded-full', n.read ? 'bg-border' : 'bg-haldi')} />
              <button className="min-w-0 flex-1 text-left" onClick={() => (n.link ? (n.read ? setLocation(toInternal(n.link)) : markRead(n.id, () => setLocation(toInternal(n.link)))) : undefined)}>
                <div className="font-medium">{n.title}</div>
                <p className="mt-0.5 text-sm text-muted-foreground">{n.body}</p>
                <span className="mt-1 block font-mono text-[11px] text-muted-foreground">{relTime(n.createdAt)}</span>
              </button>
              {!n.read && <Button size="sm" variant="ghost" onClick={() => markRead(n.id)} data-testid={`button-read-${n.id}`}><Check /> Read</Button>}
            </li>
          ))}
        </ul>
      )}
    </>
  );
}

/* ---------------- FOR LAWYERS ---------------- */
export function ForLawyers() {
  const { me } = useAccount();
  return (
    <div>
      <section className="mx-auto grid max-w-7xl items-center gap-10 px-4 pt-12 md:px-6 lg:grid-cols-2">
        <div>
          <p className="rise font-mono text-[11px] uppercase tracking-[0.2em] text-primary/70">For advocates</p>
          <h1 className="rise rise-1 mt-3 text-5xl font-semibold leading-[1] md:text-6xl">Your practice, <span className="italic text-primary">reachable</span> by people who need it.</h1>
          <p className="rise rise-2 mt-5 max-w-lg text-lg text-muted-foreground">Clients find you by legal area and language, see your 30-minute fee, and send a request. You decide what to accept.</p>
          <div className="rise rise-3 mt-8 flex flex-wrap gap-3">
            <Button asChild size="lg" className="rounded-full"><Link href="/lawyer/profile">{me?.role === 'lawyer' ? 'Manage your profile' : 'Apply now'}</Link></Button>
            <Button asChild size="lg" variant="outline" className="rounded-full"><Link href="/templates">See templates</Link></Button>
          </div>
        </div>
        <img src={`${base}images/for-lawyers.png`} alt="An advocate drafting at a desk" className="rise rise-2 aspect-[4/3.4] w-full rounded-[2rem] object-cover shadow-xl" />
      </section>
      <section className="mx-auto mt-24 max-w-7xl px-4 md:px-6">
        <div className="grid gap-px overflow-hidden rounded-[2rem] border bg-border md:grid-cols-3">
          {[
            [CalendarDays, 'Your hours, your fee', 'Set weekly days and a single INR fee for 30 minutes. Mark yourself available when you are.'],
            [MessagesSquare, 'Accept what fits', 'Requests arrive with the client’s topic and notes. Accept, decline, chat and mark complete.'],
            [FileText, 'A real drafting desk', 'Fill Indian legal templates, edit Markdown with live preview, export PDF, DOCX or Markdown.'],
            [Mic, 'Dictate, then refine', 'Record audio in the browser and get it transcribed into your document for review.'],
            [Scale, 'AI that assists, not decides', 'Draft, improve or translate with AI. You review every line before anything reaches a client.'],
            [Check, 'Publish deliverables', 'Keep drafts private, then publish the final document into the consultation for the client.'],
          ].map(([Icon, t, b]) => {
            const I = Icon as typeof Check;
            return (
              <div key={t as string} className="bg-card p-7">
                <I className="h-6 w-6 text-primary" />
                <h3 className="mt-4 text-xl font-semibold">{t as string}</h3>
                <p className="mt-1.5 text-[14.5px] text-muted-foreground">{b as string}</p>
              </div>
            );
          })}
        </div>
      </section>
      <section className="mx-auto mt-24 max-w-7xl px-4 md:px-6">
        <div className="ink-panel grid gap-8 rounded-[2rem] p-8 md:grid-cols-[1fr_auto] md:items-center md:p-12">
          <div>
            <h2 className="text-3xl font-semibold text-white md:text-4xl">How approval works</h2>
            <ol className="mt-5 space-y-3 text-white/80">
              <li><span className="mr-2 font-mono text-haldi">01</span>Create a free account and apply with your Bar Council and enrolment number.</li>
              <li><span className="mr-2 font-mono text-haldi">02</span>Your profile is pending while an administrator reviews it. The document workspace is open right away.</li>
              <li><span className="mr-2 font-mono text-haldi">03</span>Once approved, you appear in the directory and can receive requests.</li>
            </ol>
            <p className="mt-5 text-sm text-white/55">Checkout stays disabled until Razorpay verification. Real consultation requests require verified payment before lawyer acceptance.</p>
          </div>
          <Button asChild size="lg" className="rounded-full bg-haldi text-ink hover:bg-haldi"><Link href="/lawyer/profile">Start application</Link></Button>
        </div>
      </section>
    </div>
  );
}

/* ---------------- POLICY ---------------- */
const policyMap: Record<string, { key: string; title: string; context: string }> = {
  '/privacy': { key: 'privacy', title: 'Privacy Policy', context: 'Consultation messages are visible to the client, the chosen advocate and administrators where needed. Dictation audio is sent to the transcription service for your request; this Platform does not intentionally keep it as an account recording. AI services receive only the text or audio you submit for that request.' },
  '/disclaimer': { key: 'disclaimer', title: 'Disclaimer', context: 'AI assistance and transcription are available only when the relevant provider is configured. Review AI-generated text and transcripts before relying on them.' },
  '/terms': { key: 'terms', title: 'Terms of Service', context: 'This is a separate pilot. Checkout stays disabled until Razorpay is verified. Illustrative demo profiles cannot take payments. Clients retain rights to their legal content.' },
  '/refund-policy': { key: 'refunds', title: 'Refund & Cancellation Policy', context: 'Owner-selected rules: consultation refunds for lawyer cancellation only; unused document purchases refundable within seven days, subject to mandatory applicable law. Checkout remains disabled pending provider verification.' },
};
export function Policy({ path }: { path: string }) {
  const p = policyMap[path];
  const text = policies[p.key] ?? '';
  const blocks = text.split(/\n\s*\n/);
  return (
    <AppPage>
      <div className="mx-auto max-w-3xl">
        <PageHeader eyebrow="Policies" title={p.title} />
        <Notice icon={<Info />} className="mb-8">{p.context}</Notice>
        <Notice icon={<Info />} className="mb-8">Pre-launch requirement: qualified legal counsel must review these policies before paid legal engagements are accepted. Confirm that review is complete and replace the registered-address and grievance-officer placeholders with owner-approved details before launch.</Notice>
        <article className="space-y-4 rounded-3xl border bg-card p-6 md:p-10">
          {blocks.slice(1).map((b, i) => {
            const t = b.trim();
            if (/^\d+\.\s+[A-Z][A-Z\s&,'()-]+$/.test(t)) return <h2 key={i} className="pt-4 text-xl font-semibold">{t}</h2>;
            return <p key={i} className="whitespace-pre-line text-[14.5px] leading-relaxed text-foreground/85">{t}</p>;
          })}
        </article>
      </div>
    </AppPage>
  );
}
