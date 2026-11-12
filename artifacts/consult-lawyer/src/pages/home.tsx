import { useState } from 'react';
import { Link, useLocation } from 'wouter';
import { Search, ArrowRight, ShieldQuestion, FileText, MessagesSquare, CalendarClock, Scale, Info } from 'lucide-react';
import { useGetPlatform, useListLawyers } from '@workspace/api-client-react';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from '@/components/ui/accordion';
import { LawyerCard } from '@/components/lawyer-card';
import { ErrorState, Notice } from '@/components/kit';
import { inr } from '@/lib/format';

const base = import.meta.env.BASE_URL;

const worries = [
  'My landlord will not return the deposit',
  'Cheque bounced, what now?',
  'Husband filed for divorce',
  'Employer has not paid salary for 3 months',
  'Builder delayed possession by 2 years',
  'Received a legal notice',
  'Property dispute with siblings',
  'Online fraud took my savings',
  'Need a rent agreement drafted',
];

export default function Home() {
  const [, setLocation] = useLocation();
  const [q, setQ] = useState('');
  const platform = useGetPlatform();
  const lawyers = useListLawyers({ sort: 'recommended' });
  const p = platform.data;
  const featured = (lawyers.data ?? []).slice(0, 6);
  const minFee = (lawyers.data ?? []).reduce((m, l) => Math.min(m, l.fee), Infinity);

  const go = (search: string) => setLocation(search ? `/lawyers?search=${encodeURIComponent(search)}` : '/lawyers');

  return (
    <div>
      {/* HERO */}
      <section className="relative overflow-hidden">
        <div className="mx-auto grid max-w-7xl items-center gap-10 px-4 pb-16 pt-10 md:px-6 lg:grid-cols-[1.15fr_1fr] lg:pt-16">
          <div>
            <p className="rise inline-flex items-center gap-2 rounded-full border border-primary/15 bg-card px-3 py-1 font-mono text-[11px] uppercase tracking-[0.18em] text-primary">
              <span className="live-dot h-2 w-2 rounded-full bg-[hsl(152_55%_40%)]" />
              {p ? `${p.onlineCount} of ${p.lawyerCount} listed advocates marked available` : 'Advocates across India'}
            </p>
            <h1 className="rise rise-1 mt-6 text-[2.75rem] font-semibold leading-[0.98] sm:text-6xl lg:text-[4.6rem]">
              A legal worry is heavy. <span className="italic text-primary">Talking it through</span> <span className="haldi-underline">should not be.</span>
            </h1>
            <p className="rise rise-2 mt-6 max-w-xl text-[17px] leading-relaxed text-muted-foreground">
              Find an advocate who speaks your language and practises in your kind of problem. See the fee for a 30-minute consultation upfront, then send a request at a time that suits you.
            </p>
            <form
              onSubmit={(e) => {
                e.preventDefault();
                go(q.trim());
              }}
              className="rise rise-3 mt-8 flex max-w-xl items-center gap-2 rounded-full border-2 border-primary/15 bg-card p-1.5 pl-5 shadow-md focus-within:border-primary/50"
            >
              <Search className="h-5 w-5 shrink-0 text-muted-foreground" />
              <input
                value={q}
                onChange={(e) => setQ(e.target.value)}
                placeholder="Search by name, problem or city"
                className="min-w-0 flex-1 bg-transparent py-2 text-[15px] outline-none placeholder:text-muted-foreground"
                data-testid="input-hero-search"
              />
              <Button type="submit" className="rounded-full px-5" data-testid="button-hero-search">
                Find a lawyer
              </Button>
            </form>
            <div className="rise rise-4 mt-5 flex flex-wrap gap-x-6 gap-y-2 text-sm text-muted-foreground">
              <span>
                <strong className="font-display text-lg text-foreground">{Number.isFinite(minFee) ? inr(minFee) : '...'}</strong> lowest 30-min fee
              </span>
              <span>
                <strong className="font-display text-lg text-foreground">{p?.languages.length ?? '..'}</strong> languages
              </span>
              <span>
                <strong className="font-display text-lg text-foreground">{p?.templates.length ?? '..'}</strong> document templates
              </span>
            </div>
          </div>
          <div className="relative rise rise-2">
            <div className="absolute -inset-4 -z-10 rotate-2 rounded-[2.5rem] bg-haldi/40" />
            <img src={`${base}images/hero.png`} alt="A client talking through her problem with an advocate" className="aspect-[4/3.6] w-full rounded-[2rem] object-cover shadow-xl" />
            <div className="absolute -bottom-6 -left-4 max-w-[260px] rounded-2xl border bg-card p-4 shadow-lg md:-left-10">
              <p className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground">Fee shown upfront</p>
              <p className="mt-1 font-display text-lg leading-snug">One price for 30 minutes. Never a per-minute meter.</p>
            </div>
          </div>
        </div>
        {/* worry marquee */}
        <div className="border-y bg-card/60 py-3">
          <div className="flex overflow-hidden">
            <div className="marquee flex shrink-0 gap-3 pr-3">
              {[...worries, ...worries].map((w, i) => (
                <button key={i} onClick={() => go(w.split(' ').slice(-2).join(' '))} className="shrink-0 rounded-full border bg-background px-4 py-1.5 text-[13px] text-foreground/75 hover:border-primary/40 hover:text-primary">
                  {w}
                </button>
              ))}
            </div>
          </div>
        </div>
      </section>

      {p?.demo && (
        <div className="mx-auto mt-8 max-w-7xl px-4 md:px-6">
          <Notice icon={<Info />} tone="ink">
            This is a pilot. Profiles marked <strong>Illustrative</strong> are example lawyers created to show how the marketplace works. They are not real advocates and their ratings are not real reviews. Checkout stays disabled until Razorpay verification. Calls are not connected.
          </Notice>
        </div>
      )}

      {/* CATEGORIES */}
      <section className="mx-auto max-w-7xl px-4 pt-20 md:px-6">
        <div className="flex flex-col justify-between gap-4 md:flex-row md:items-end">
          <div>
            <p className="font-mono text-[11px] uppercase tracking-[0.2em] text-primary/70">Start with what is happening</p>
            <h2 className="mt-2 text-4xl font-semibold md:text-5xl">Pick the shape of your problem</h2>
          </div>
          <Link href="/lawyers" className="inline-flex items-center gap-1 text-sm font-medium text-primary hover:gap-2 transition-all">
            Browse the full directory <ArrowRight className="h-4 w-4" />
          </Link>
        </div>
        <div className="mt-8 grid grid-cols-2 gap-3 md:grid-cols-3 lg:grid-cols-4">
          {platform.isLoading
            ? Array.from({ length: 8 }).map((_, i) => <Skeleton key={i} className="h-32 rounded-2xl" />)
            : (p?.categories ?? []).map((c, i) => (
                <Link
                  key={c.id}
                  href={`/lawyers?area=${encodeURIComponent(c.name)}`}
                  className={`lift group relative overflow-hidden rounded-2xl border p-5 ${i === 0 ? 'ink-panel md:col-span-2 md:row-span-2' : 'bg-card'}`}
                  data-testid={`link-category-${c.id}`}
                >
                  <span className={`font-mono text-[11px] ${i === 0 ? 'text-haldi' : 'text-muted-foreground'}`}>{String(i + 1).padStart(2, '0')}</span>
                  <h3 className={`mt-2 font-semibold leading-tight ${i === 0 ? 'text-3xl md:text-4xl' : 'text-lg'}`}>{c.name}</h3>
                  <p className={`mt-1.5 line-clamp-2 text-[13px] ${i === 0 ? 'max-w-sm text-white/70' : 'text-muted-foreground'}`}>{c.description}</p>
                  <span className={`mt-3 inline-flex items-center gap-1 text-xs font-medium ${i === 0 ? 'text-haldi' : 'text-primary'}`}>
                    {c.count} {c.count === 1 ? 'lawyer' : 'lawyers'} <ArrowRight className="h-3 w-3 transition-transform group-hover:translate-x-1" />
                  </span>
                </Link>
              ))}
        </div>
      </section>

      {/* FEATURED */}
      <section className="mx-auto max-w-7xl px-4 pt-24 md:px-6">
        <div className="flex flex-col justify-between gap-4 md:flex-row md:items-end">
          <div>
            <p className="font-mono text-[11px] uppercase tracking-[0.2em] text-primary/70">The directory</p>
            <h2 className="mt-2 text-4xl font-semibold md:text-5xl">Advocates you can request today</h2>
          </div>
          <Button asChild variant="outline" className="rounded-full">
            <Link href="/lawyers">See all lawyers <ArrowRight /></Link>
          </Button>
        </div>
        <div className="mt-8">
          {lawyers.isLoading ? (
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">{Array.from({ length: 6 }).map((_, i) => <Skeleton key={i} className="h-72 rounded-[1.4rem]" />)}</div>
          ) : lawyers.isError ? (
            <ErrorState error={lawyers.error} onRetry={() => lawyers.refetch()} />
          ) : (
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">{featured.map((l, i) => <LawyerCard key={l.id} lawyer={l} index={i} />)}</div>
          )}
        </div>
      </section>

      {/* HOW */}
      <section className="mx-auto max-w-7xl px-4 pt-28 md:px-6">
        <div className="grid gap-12 lg:grid-cols-[0.9fr_1.1fr]">
          <div className="lg:sticky lg:top-28 lg:self-start">
            <p className="font-mono text-[11px] uppercase tracking-[0.2em] text-primary/70">How it works</p>
            <h2 className="mt-2 text-4xl font-semibold md:text-5xl">Four calm steps, no surprises</h2>
            <p className="mt-4 max-w-md text-muted-foreground">Nothing is charged when you send a request. The lawyer reviews your note and accepts the time if they can help.</p>
          </div>
          <ol className="relative space-y-4 border-l-2 border-dashed border-primary/20 pl-8">
            {[
              { icon: Search, t: 'Find the right specialist', b: 'Filter by legal area, language and who is available. Every card shows the 30-minute fee.' },
              { icon: CalendarClock, t: 'Request a half-hour slot', b: 'Pick a day and time in IST and describe your situation in plain words.' },
              { icon: MessagesSquare, t: 'Talk it through', b: 'Once accepted, you and the advocate message inside the consultation room.' },
              { icon: FileText, t: 'Receive documents if needed', b: 'Choose the document package and the advocate can publish a drafted notice or agreement to you.' },
            ].map((s, i) => (
              <li key={s.t} className="relative rounded-2xl border bg-card p-6">
                <span className="absolute -left-[3.05rem] top-6 grid h-9 w-9 place-items-center rounded-full bg-primary font-mono text-sm text-primary-foreground ring-4 ring-background">{i + 1}</span>
                <s.icon className="h-5 w-5 text-primary" />
                <h3 className="mt-3 text-xl font-semibold">{s.t}</h3>
                <p className="mt-1 text-[14.5px] text-muted-foreground">{s.b}</p>
              </li>
            ))}
          </ol>
        </div>
      </section>

      {/* HONEST */}
      <section className="mx-auto max-w-7xl px-4 pt-28 md:px-6">
        <div className="ink-panel overflow-hidden rounded-[2rem] p-8 md:p-14">
          <div className="grid gap-10 md:grid-cols-2">
            <div>
              <ShieldQuestion className="h-8 w-8 text-haldi" />
              <h2 className="mt-4 text-4xl font-semibold text-white md:text-5xl">What we are, and what we are not</h2>
              <p className="mt-4 text-white/70">You deserve straight answers when you are already worried.</p>
            </div>
            <div className="grid gap-6 sm:grid-cols-2">
              {[
                ['We are', 'A platform that lists advocates and helps you request their time.'],
                ['We are not', 'A law firm. We do not give legal advice or predict how a case will end.'],
                ['AI drafts', 'Assist advocates. Every AI draft needs review by a qualified advocate before use.'],
                ['Your notes', 'Shared with the lawyer you choose. Avoid passwords and full ID numbers in messages.'],
              ].map(([h, b]) => (
                <div key={h} className="border-t border-white/15 pt-4">
                  <h4 className="font-mono text-[11px] uppercase tracking-[0.2em] text-haldi">{h}</h4>
                  <p className="mt-2 text-[15px] leading-relaxed text-white/85">{b}</p>
                </div>
              ))}
            </div>
          </div>
        </div>
      </section>

      {/* TEMPLATES */}
      <section className="mx-auto max-w-7xl px-4 pt-28 md:px-6">
        <div className="flex flex-col justify-between gap-4 md:flex-row md:items-end">
          <div>
            <p className="font-mono text-[11px] uppercase tracking-[0.2em] text-primary/70">Template library</p>
            <h2 className="mt-2 text-4xl font-semibold md:text-5xl">Common Indian legal formats</h2>
          </div>
          <Link href="/templates" className="inline-flex items-center gap-1 text-sm font-medium text-primary">All templates <ArrowRight className="h-4 w-4" /></Link>
        </div>
        <div className="mt-8 grid gap-3 md:grid-cols-2 lg:grid-cols-4">
          {(p?.templates ?? []).slice(0, 4).map((t) => (
            <Link key={t.id} href={`/templates?t=${t.id}`} className="lift rounded-2xl border bg-card p-5" data-testid={`link-template-${t.id}`}>
              <FileText className="h-5 w-5 text-primary" />
              <h3 className="mt-3 text-lg font-semibold leading-tight">{t.name}</h3>
              <p className="mt-1 line-clamp-2 text-[13px] text-muted-foreground">{t.description}</p>
              <span className="mt-3 inline-block rounded-full bg-secondary px-2.5 py-0.5 text-[11px]">{t.category}</span>
            </Link>
          ))}
        </div>
      </section>

      {/* LAWYERS + FAQ */}
      <section className="mx-auto max-w-7xl px-4 pt-28 md:px-6">
        <div className="grid gap-12 lg:grid-cols-2">
          <div className="relative overflow-hidden rounded-[2rem] border bg-haldi/25 p-8 md:p-10">
            <Scale className="h-8 w-8 text-primary" />
            <h2 className="mt-4 text-3xl font-semibold md:text-4xl">Are you an advocate?</h2>
            <p className="mt-3 max-w-md text-foreground/75">Set your own 30-minute fee and weekly availability, accept requests you can help with, and draft documents with templates, dictation and AI assistance.</p>
            <div className="mt-6 flex flex-wrap gap-2">
              <Button asChild className="rounded-full"><Link href="/for-lawyers">How it works for lawyers</Link></Button>
              <Button asChild variant="outline" className="rounded-full bg-card"><Link href="/lawyer/profile">Apply now</Link></Button>
            </div>
          </div>
          <div>
            <h2 className="text-3xl font-semibold">Questions people ask first</h2>
            <Accordion type="single" collapsible className="mt-4">
              {[
                ['Do I pay when I send a request?', 'No. Saving a request does not charge you. Once checkout is verified and enabled, pay from your consultation page; the advocate can then accept. Illustrative profiles cannot accept payments.'],
                ['How is the fee calculated?', 'Each advocate sets one price for a 30-minute consultation in INR. If you add a document, their document percentage is added on top.'],
                ['Can I talk in Hindi or my regional language?', 'Yes. Filter the directory by language to find advocates who speak it.'],
                ['Will the lawyer guarantee a result?', 'No honest advocate can. Expect a clear explanation of your options and next steps.'],
                ['Is my conversation confidential?', 'Messages are visible to you, the advocate and platform administrators where needed for safety. Do not share passwords or full ID numbers.'],
              ].map(([q2, a], i) => (
                <AccordionItem key={i} value={`f${i}`}>
                  <AccordionTrigger className="text-left font-display text-lg">{q2}</AccordionTrigger>
                  <AccordionContent className="text-muted-foreground">{a}</AccordionContent>
                </AccordionItem>
              ))}
            </Accordion>
          </div>
        </div>
      </section>

      {/* CLOSING */}
      <section className="mx-auto max-w-4xl px-4 pt-28 text-center md:px-6">
        <h2 className="text-4xl font-semibold leading-tight md:text-6xl">
          Thirty minutes with the right advocate can <span className="italic text-primary">change the next thirty days.</span>
        </h2>
        <div className="mt-8 flex flex-wrap justify-center gap-3">
          <Button asChild size="lg" className="rounded-full"><Link href="/lawyers">Find a lawyer</Link></Button>
          <Button asChild size="lg" variant="outline" className="rounded-full"><Link href="/sign-up">Create a free account</Link></Button>
        </div>
      </section>
    </div>
  );
}
