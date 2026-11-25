import { useEffect, useMemo, useState } from 'react';
import { CommunicationSettings } from '@/components/communication-settings';
import { Link, useLocation } from 'wouter';
import { useQueryClient } from '@tanstack/react-query';
import { Check, Loader2, Bell, CheckCheck, Info, Scale, FileText, MessagesSquare, CalendarDays, Mic, ArrowRight, Printer } from 'lucide-react';
import {
  useGetPlatform, useUpdateMe, getGetMeQueryKey,
  useListNotifications, getListNotificationsQueryKey, useReadNotification,
  useListMyGrievances, getListMyGrievancesQueryKey, useSubmitGrievance,
  type GrievanceInputCategory,
  type Account, type CheckoutInputPlan,
} from '@workspace/api-client-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Switch } from '@/components/ui/switch';
import { Skeleton } from '@/components/ui/skeleton';
import { Guard } from '@/components/guard';
import { AppPage } from '@/components/shell';
import { EmptyState, ErrorState, ListSkeleton, Notice, PageHeader } from '@/components/kit';
import { useToast } from '@/hooks/use-toast';
import { useAccount } from '@/lib/account';
import { cn } from '@/lib/utils';
import { errMsg, fmtDate, inr, relTime } from '@/lib/format';
import { getCurrentPolicyRevision, getPolicyReviewStatus, policyRevisionHistory, policies } from '@/data/policies';
import { usePaymentCheckout } from '@/hooks/use-payment-checkout';
import { PaymentHistory } from '@/components/payment-history';
import { PolicySectionIndex } from '@/components/policy-section-index';
import { getPolicySections } from '@/lib/policy-sections';

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

const grievanceCategories: { value: GrievanceInputCategory; label: string }[] = [
  { value: 'account', label: 'Account or access' },
  { value: 'consultation', label: 'Consultation service' },
  { value: 'payment', label: 'Payment' },
  { value: 'privacy', label: 'Privacy or data' },
  { value: 'other', label: 'Other' },
];
const grievanceStatusLabel = {
  submitted: 'Submitted',
  under_review: 'Under review',
  resolved: 'Resolved',
} as const;

export function Grievances() {
  return (
    <AppPage>
      <Guard roles={['client']}>{() => <GrievancesInner />}</Guard>
    </AppPage>
  );
}

function GrievancesInner() {
  const q = useListMyGrievances({ query: { queryKey: getListMyGrievancesQueryKey(), refetchInterval: 30_000 } });
  const platform = useGetPlatform();
  const submit = useSubmitGrievance();
  const qc = useQueryClient();
  const { toast } = useToast();
  const [category, setCategory] = useState<GrievanceInputCategory>('other');
  const [description, setDescription] = useState('');
  const contacts = platform.data?.policyContacts;
  return (
    <>
      <PageHeader eyebrow="Help and accountability" title="Grievances" sub="Submit a service concern and follow its status here." />
      <div className="grid gap-6 lg:grid-cols-[1.1fr_.9fr]">
        <form className="space-y-4 rounded-3xl border bg-card p-5 md:p-7" onSubmit={(event) => {
          event.preventDefault();
          submit.mutate({ data: { category, description: description.trim() } }, {
            onSuccess: () => {
              setDescription('');
              setCategory('other');
              qc.invalidateQueries({ queryKey: getListMyGrievancesQueryKey() });
              toast({ title: 'Grievance submitted', description: 'Your reference and status are now available below.' });
            },
            onError: (error) => toast({ title: 'Could not submit grievance', description: errMsg(error), variant: 'destructive' }),
          });
        }}>
          <div>
            <h2 className="font-display text-2xl font-semibold">Submit a grievance</h2>
            <p className="mt-1 text-sm text-muted-foreground">Your account is linked automatically. Share only the service issue needed to understand your concern.</p>
          </div>
          <div>
            <Label htmlFor="grievance-category">Issue type</Label>
            <select
              id="grievance-category"
              className="mt-1.5 h-11 w-full rounded-xl border bg-background px-3 text-sm"
              value={category}
              onChange={(event) => setCategory(event.target.value as GrievanceInputCategory)}
              data-testid="select-grievance-category"
            >
              {grievanceCategories.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}
            </select>
          </div>
          <div>
            <Label htmlFor="grievance-description">What happened?</Label>
            <Textarea
              id="grievance-description"
              className="mt-1.5 min-h-32"
              value={description}
              onChange={(event) => setDescription(event.target.value)}
              minLength={10}
              maxLength={1200}
              required
              placeholder="Describe the platform or service issue, not the details of your legal matter."
              data-testid="input-grievance-description"
            />
            <p className="mt-1 text-xs text-muted-foreground">Do not include case facts, identity documents, passwords, card details, or other sensitive matter information.</p>
          </div>
          <Button type="submit" disabled={description.trim().length < 10 || submit.isPending} className="rounded-full" data-testid="button-submit-grievance">
            {submit.isPending && <Loader2 className="animate-spin" />} Submit grievance
          </Button>
        </form>
        <aside className="space-y-4">
          <Notice icon={<Info />}>
            The Privacy Policy states that grievances will be acknowledged within 48 hours and resolved within 30 days. <Link href="/privacy" className="underline">Read the Privacy Policy</Link>.
          </Notice>
          <div className="rounded-3xl border bg-secondary/50 p-5">
            <h2 className="font-display text-xl font-semibold">Grievance contact</h2>
            {contacts ? (
              <div className="mt-3 space-y-1 text-sm">
                <p>{contacts.grievanceOfficerName}</p>
                <a className="text-primary underline" href={`mailto:${contacts.grievanceOfficerEmail}`}>{contacts.grievanceOfficerEmail}</a>
                <p className="pt-2 text-muted-foreground">Support: <a className="underline" href={`mailto:${contacts.supportContactEmail}`}>{contacts.supportContactEmail}</a></p>
              </div>
            ) : (
              <p className="mt-2 text-sm text-muted-foreground">Counsel-approved contact details are not yet on file. You can still submit and track a grievance here.</p>
            )}
          </div>
        </aside>
      </div>
      <section className="mt-10">
        <PageHeader eyebrow="Private to your account" title="Your submissions" sub="Only you and the authorized grievance reviewer can see these records." />
        {q.isLoading ? <ListSkeleton /> : q.isError ? <ErrorState error={q.error} onRetry={() => q.refetch()} /> : !q.data?.length ? (
          <EmptyState icon={<Info />} title="No grievances submitted" body="If you need help with a platform or service issue, use the form above." />
        ) : (
          <div className="space-y-3">
            {q.data.map((item) => (
              <article key={item.id} className="rounded-2xl border bg-card p-5" data-testid={`row-grievance-${item.id}`}>
                <div className="flex flex-wrap items-center gap-2">
                  <h3 className="font-semibold">{grievanceCategories.find((option) => option.value === item.category)?.label ?? 'Other'}</h3>
                  <span className="rounded-full bg-secondary px-2.5 py-1 text-xs">{grievanceStatusLabel[item.status]}</span>
                  <span className="ml-auto font-mono text-[10px] text-muted-foreground">Ref {item.id.slice(0, 8).toUpperCase()}</span>
                </div>
                <p className="mt-2 whitespace-pre-wrap text-sm">{item.description}</p>
                <p className="mt-2 text-xs text-muted-foreground">Submitted {fmtDate(item.submittedAt)} · Updated {fmtDate(item.updatedAt)}</p>
                {item.officerResponse && <div className="mt-4 rounded-xl bg-secondary/60 p-4"><h4 className="text-sm font-semibold">Officer response</h4><p className="mt-1 whitespace-pre-wrap text-sm">{item.officerResponse}</p>{item.respondedAt && <p className="mt-2 text-xs text-muted-foreground">Response recorded {fmtDate(item.respondedAt)}</p>}</div>}
              </article>
            ))}
          </div>
        )}
      </section>
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
  '/privacy': { key: 'privacy', title: 'Privacy Policy', context: 'Consultation messages are visible to the client, the chosen advocate and administrators where needed. Dictation audio is separate from call audio and is processed for your transcription request. Call recording is disabled by default; if enabled, it requires separate consent from both the client and lawyer for each call. If either declines, the call may proceed unrecorded. Call audio is sent to ElevenLabs for transcription only when both participants have opted in, and the transcript remains private to the assigned lawyer unless included in a document the lawyer explicitly publishes.' },
  '/disclaimer': { key: 'disclaimer', title: 'Disclaimer', context: 'AI assistance and transcription are available only when the relevant provider is configured. Review AI-generated text and transcripts before relying on them.' },
  '/terms': { key: 'terms', title: 'Terms of Service', context: 'This is a separate pilot. Paid consultation checkout stays disabled until both Razorpay verification and qualified-counsel approval are recorded. Illustrative demo profiles cannot take payments. Clients retain rights to their legal content.' },
  '/refund-policy': { key: 'refunds', title: 'Refund & Cancellation Policy', context: 'Owner-selected rules: consultation refunds for lawyer cancellation only; unused document purchases refundable within seven days, subject to mandatory applicable law. Paid consultation checkout remains closed until Razorpay verification and counsel approval are complete.' },
};
export function Policy({ path }: { path: string }) {
  const p = policyMap[path];
  const platform = useGetPlatform();
  const revisions = policyRevisionHistory[p.key] ?? [];
  const currentRevision = getCurrentPolicyRevision(p.key);
  const reviewStatus = getPolicyReviewStatus(currentRevision, Boolean(platform.data?.legalReviewComplete));
  const text = useMemo(() => {
    let content = policies[p.key] ?? '';
    const contacts = platform.data?.policyContacts;
    if (contacts) {
      content = content
        .replace(
          'Name: Bhagyashree Patil\nEmail: privacy@consultwithlawyer.in',
          `Name: ${contacts.grievanceOfficerName}\nEmail: ${contacts.grievanceOfficerEmail}`,
        )
        .replaceAll('support@consultwithlawyer.in', contacts.supportContactEmail)
        .replaceAll('privacy@consultwithlawyer.in', contacts.privacyContactEmail)
        .replaceAll('Amanora Park Town, Amanora Gold Tower, Tower 42, Flat 1012, Hadapsar, Pune 411028', contacts.privacyContactAddress)
        .replaceAll('Bhagyashree Patil', contacts.grievanceOfficerName);
    }
    return content;
  }, [p.key, platform.data?.policyContacts]);
  const blocks = useMemo(() => text.split(/\n\s*\n/), [text]);
  const sections = useMemo(() => getPolicySections(blocks.slice(1)), [blocks]);
  const sectionByBlock = useMemo(() => new Map(sections.map((section) => [section.blockIndex, section])), [sections]);
  const [activeSection, setActiveSection] = useState<{ policyKey: string; id: string } | null>(null);
  const activeSectionId = activeSection?.policyKey === p.key ? activeSection.id : null;

  useEffect(() => {
    if (typeof IntersectionObserver === 'undefined') return;
    const headings = sections
      .map((section) => document.getElementById(section.id))
      .filter((heading): heading is HTMLElement => heading instanceof HTMLElement);
    if (!headings.length) return;

    const observer = new IntersectionObserver((entries) => {
      const current = entries
        .filter((entry) => entry.isIntersecting)
        .sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top)[0];
      if (current) setActiveSection({ policyKey: p.key, id: current.target.id });
    }, { rootMargin: '-18% 0px -72% 0px', threshold: 0 });

    headings.forEach((heading) => observer.observe(heading));
    return () => observer.disconnect();
  }, [p.key, sections]);

  return (
    <AppPage>
      <div className="policy-print-page mx-auto max-w-3xl">
        <PageHeader
          eyebrow="Policies"
          title={p.title}
          actions={
            <Button
              type="button"
              variant="outline"
              className="policy-print-hide print:hidden"
              onClick={() => window.print()}
              data-testid="button-print-policy"
            >
              <Printer aria-hidden="true" />
              Print / Save as PDF
            </Button>
          }
        />
        <Notice icon={<Info />} className="policy-print-hide mb-8 print:hidden">{p.context}</Notice>
        <section className="policy-print-hide mb-8 rounded-2xl border bg-card p-5 print:hidden" aria-label="Policy version and review status" data-testid="policy-revision-status">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h2 className="font-semibold">Revision {currentRevision?.revisionId ?? 'not recorded'}</h2>
              {currentRevision && <p className="mt-1 text-sm text-muted-foreground">Effective <time dateTime={currentRevision.effectiveDate}>{fmtDate(currentRevision.effectiveDate)}</time></p>}
            </div>
            <span
              role="status"
              className={cn(
                'rounded-full px-3 py-1 text-sm font-medium',
                reviewStatus === 'approved'
                  ? 'bg-emerald-100 text-emerald-900 dark:bg-emerald-950 dark:text-emerald-200'
                  : 'bg-amber-100 text-amber-950 dark:bg-amber-950 dark:text-amber-200',
              )}
              data-testid="policy-review-status"
            >
              {reviewStatus === 'approved' ? 'Counsel review recorded' : 'Pending counsel review'}
            </span>
          </div>
          <p className="mt-3 text-sm text-muted-foreground">
            {reviewStatus === 'approved'
              ? 'This revision is covered by the recorded counsel review.'
              : 'This revision is not marked as counsel-approved. A previous approval does not carry forward to changed wording.'}
          </p>
          {revisions.length > 1 && (
            <div className="mt-5 border-t pt-4">
              <h3 className="font-medium">Previous revisions</h3>
              <div className="mt-3 space-y-3">
                {revisions.slice(0, -1).reverse().map((revision) => (
                  <details key={revision.revisionId} className="rounded-xl border p-4">
                    <summary className="cursor-pointer font-medium">
                      {revision.revisionId} · effective {fmtDate(revision.effectiveDate)} · {revision.reviewStatus === 'approved' ? 'Counsel review recorded' : 'Pending counsel review'}
                    </summary>
                    <pre className="mt-4 max-h-[32rem] overflow-auto whitespace-pre-wrap break-words text-sm leading-relaxed text-foreground/85">{revision.content}</pre>
                  </details>
                ))}
              </div>
            </div>
          )}
        </section>
        <PolicySectionIndex sections={sections} activeSectionId={activeSectionId} />
        <article aria-label={p.title} className="policy-print-article space-y-4 rounded-3xl border bg-card p-6 md:p-10">
          {blocks.slice(1).map((b, i) => {
            const t = b.trim();
            const section = sectionByBlock.get(i);
            if (section) return <h2 key={i} id={section.id} tabIndex={-1} className="scroll-mt-24 break-words pt-4 text-xl font-semibold">{t}</h2>;
            return <p key={i} className="break-words whitespace-pre-line text-[14.5px] leading-relaxed text-foreground/85">{t}</p>;
          })}
        </article>
      </div>
    </AppPage>
  );
}
