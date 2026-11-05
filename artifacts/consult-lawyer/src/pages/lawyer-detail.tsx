import { useState } from 'react';
import { Link, useParams } from 'wouter';
import { ArrowLeft, MapPin, Languages, Clock, BadgeCheck, Landmark, CalendarDays, MessageSquareQuote, Info } from 'lucide-react';
import {
  useGetLawyer,
  getGetLawyerQueryKey,
  useListLawyerReviews,
  getListLawyerReviewsQueryKey,
  useGetPlatform,
} from '@workspace/api-client-react';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { BookingDialog } from '@/components/booking-dialog';
import { DemoTag, EmptyState, ErrorState, Notice, PersonAvatar, Stars } from '@/components/kit';
import { AppPage } from '@/components/shell';
import { WEEKDAYS, fmtDate, inr } from '@/lib/format';

export default function LawyerDetail() {
  const { id = '' } = useParams<{ id: string }>();
  const lawyer = useGetLawyer(id, { query: { enabled: !!id, queryKey: getGetLawyerQueryKey(id) } });
  const reviews = useListLawyerReviews(id, { query: { enabled: !!id, queryKey: getListLawyerReviewsQueryKey(id) } });
  const platform = useGetPlatform();
  const [open, setOpen] = useState(false);

  if (lawyer.isLoading)
    return (
      <AppPage>
        <Skeleton className="h-56 w-full rounded-3xl" />
        <div className="mt-6 grid gap-6 lg:grid-cols-[1fr_340px]"><Skeleton className="h-96 rounded-2xl" /><Skeleton className="h-72 rounded-2xl" /></div>
      </AppPage>
    );
  if (lawyer.isError || !lawyer.data)
    return <AppPage><ErrorState error={lawyer.error} onRetry={() => lawyer.refetch()} title="This profile is not available" /></AppPage>;

  const l = lawyer.data;
  const docFee = Math.round((l.fee * l.documentFeePercent) / 100);

  return (
    <AppPage>
      <Link href="/lawyers" className="mb-5 inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-primary" data-testid="link-back">
        <ArrowLeft className="h-4 w-4" /> All lawyers
      </Link>
      <section className="ink-panel relative overflow-hidden rounded-[2rem] p-6 md:p-10 rise">
        <div className="absolute -right-24 -top-24 h-72 w-72 rounded-full border-[28px] border-haldi/15" />
        <div className="relative flex flex-col gap-6 md:flex-row md:items-center">
          <PersonAvatar name={l.name} src={l.avatarUrl} className="h-28 w-28 rounded-[1.75rem] ring-4 ring-white/10" />
          <div className="flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="text-3xl font-semibold text-white md:text-5xl" data-testid="text-lawyer-name">{l.name}</h1>
              {l.verified && !l.demo && <BadgeCheck className="h-6 w-6 text-haldi" />}
              {l.demo && <DemoTag className="bg-white/90" />}
            </div>
            <p className="mt-1 text-white/75">{l.title}</p>
            <div className="mt-4 flex flex-wrap gap-x-5 gap-y-2 text-sm text-white/75">
              <span className="flex items-center gap-1.5"><MapPin className="h-4 w-4 text-haldi" />{l.city}</span>
              <span className="flex items-center gap-1.5"><Clock className="h-4 w-4 text-haldi" />{l.experienceYears} years in practice</span>
              <span className="flex items-center gap-1.5"><Languages className="h-4 w-4 text-haldi" />{l.languages.join(', ')}</span>
              <span className="flex items-center gap-1.5">
                <span className={`h-2 w-2 rounded-full ${l.online ? 'live-dot bg-[hsl(152_55%_50%)]' : 'bg-white/40'}`} />
                {l.online ? 'Marked available now' : 'Offline'}
              </span>
            </div>
          </div>
        </div>
      </section>

      <div className="mt-8 grid gap-8 lg:grid-cols-[1fr_340px]">
        <div className="space-y-10">
          {l.demo && (
            <Notice icon={<Info />} tone="ink">
              Illustrative example profile. This person, their credentials, rating and reviews are not real and have not been verified. Requests to this profile are saved as demo.
            </Notice>
          )}
          <section>
            <h2 className="text-2xl font-semibold">About</h2>
            <p className="mt-3 whitespace-pre-line text-[15.5px] leading-relaxed text-foreground/85">{l.bio}</p>
          </section>
          <section>
            <h2 className="text-2xl font-semibold">Practice areas</h2>
            <div className="mt-3 flex flex-wrap gap-2">
              {l.practiceAreas.map((a) => (
                <Link key={a} href={`/lawyers?area=${encodeURIComponent(a)}`} className="rounded-full border bg-card px-3.5 py-1.5 text-sm hover:border-primary/40">{a}</Link>
              ))}
            </div>
          </section>
          <section className="grid gap-4 sm:grid-cols-2">
            <div className="rounded-2xl border bg-card p-5">
              <Landmark className="h-5 w-5 text-primary" />
              <h3 className="mt-2 font-semibold">Enrolment</h3>
              <dl className="mt-2 space-y-1 text-sm">
                <div className="flex justify-between gap-2"><dt className="text-muted-foreground">Bar Council</dt><dd className="text-right">{l.barCouncil}</dd></div>
                <div className="flex justify-between gap-2"><dt className="text-muted-foreground">Enrolment no.</dt><dd className="font-mono text-xs">{l.enrollmentNumber}</dd></div>
              </dl>
              <p className="mt-3 text-[11.5px] text-muted-foreground">{l.demo ? 'Example values for illustration.' : l.verified ? 'Reviewed by our team at approval.' : 'Self-declared by the advocate.'}</p>
            </div>
            <div className="rounded-2xl border bg-card p-5">
              <CalendarDays className="h-5 w-5 text-primary" />
              <h3 className="mt-2 font-semibold">Weekly availability</h3>
              <div className="mt-3 flex gap-1.5">
                {WEEKDAYS.map((d, i) => (
                  <span key={d} className={`grid h-9 flex-1 place-items-center rounded-lg font-mono text-[11px] ${l.availability.includes(i) ? 'bg-primary text-primary-foreground' : 'bg-muted text-muted-foreground/60'}`}>{d.slice(0, 2)}</span>
                ))}
              </div>
            </div>
          </section>
          <section>
            <div className="flex items-end justify-between">
              <h2 className="text-2xl font-semibold">Reviews</h2>
              {l.reviewCount > 0 && <span className="flex items-center gap-2 text-sm"><Stars value={l.rating} /> <span className="font-mono">{l.rating.toFixed(1)} from {l.reviewCount}</span></span>}
            </div>
            <div className="mt-4 space-y-3">
              {reviews.isLoading ? (
                <Skeleton className="h-28 rounded-2xl" />
              ) : reviews.isError ? (
                <ErrorState error={reviews.error} onRetry={() => reviews.refetch()} />
              ) : (reviews.data ?? []).length === 0 ? (
                <EmptyState icon={<MessageSquareQuote />} title="No reviews yet" body="Reviews appear here after clients complete a consultation." />
              ) : (
                (reviews.data ?? []).map((r) => (
                  <article key={r.id} className="rounded-2xl border bg-card p-5" data-testid={`card-review-${r.id}`}>
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2"><Stars value={r.rating} /><span className="text-sm font-medium">{r.clientName}</span></div>
                      <span className="font-mono text-[11px] text-muted-foreground">{fmtDate(r.createdAt)}</span>
                    </div>
                    {r.comment && <p className="mt-2 text-[14.5px] leading-relaxed text-foreground/85">{r.comment}</p>}
                  </article>
                ))
              )}
            </div>
          </section>
        </div>
        <aside className="lg:sticky lg:top-24 lg:self-start">
          <div className="rounded-[1.6rem] border-2 border-primary/15 bg-card p-6 shadow-lg">
            <p className="font-mono text-[10px] uppercase tracking-[0.2em] text-muted-foreground">30-minute consultation</p>
            <div className="mt-1 font-display text-5xl font-semibold" data-testid="text-fee">{inr(l.fee)}</div>
            <div className="mt-4 space-y-2 border-t border-dashed pt-4 text-sm">
              <div className="flex justify-between"><span className="text-muted-foreground">With a drafted document</span><span>{inr(l.fee + docFee)}</span></div>
              <div className="flex justify-between"><span className="text-muted-foreground">Mode</span><span>Chat{platform.data?.callsEnabled ? ' or call' : ''}</span></div>
            </div>
            <Button className="mt-5 h-12 w-full rounded-full text-[15px]" onClick={() => setOpen(true)} disabled={l.approvalStatus !== 'approved'} data-testid="button-request">
              Request a consultation
            </Button>
            <p className="mt-3 text-center text-[12px] text-muted-foreground">Nothing is charged. The lawyer accepts first.</p>
          </div>
        </aside>
      </div>
      <BookingDialog lawyer={l} open={open} onOpenChange={setOpen} callsEnabled={!!platform.data?.callsEnabled} />
    </AppPage>
  );
}
