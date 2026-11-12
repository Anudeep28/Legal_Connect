import { useEffect, useRef, useState } from 'react';
import { Link } from 'wouter';
import { useQueryClient } from '@tanstack/react-query';
import { Loader2, Hourglass, BadgeCheck, XCircle, Info, ExternalLink } from 'lucide-react';
import {
  useGetLawyerProfile, getGetLawyerProfileQueryKey, useSaveLawyerProfile, useGetPlatform,
  getGetMeQueryKey, getListLawyersQueryKey, getGetLawyerQueryKey,
  type Account, type Lawyer, type LawyerInput,
} from '@workspace/api-client-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Skeleton } from '@/components/ui/skeleton';
import { Guard } from '@/components/guard';
import { AppPage } from '@/components/shell';
import { ErrorState, Notice, PageHeader } from '@/components/kit';
import { useToast } from '@/hooks/use-toast';
import { cn } from '@/lib/utils';
import { WEEKDAYS, errMsg } from '@/lib/format';

export default function LawyerProfilePage() {
  return (
    <AppPage>
      <Guard signInTitle="Sign in to apply as a lawyer" signInBody="Create a free account first. Then share your Bar Council details for review.">
        {(me) => <Inner me={me} />}
      </Guard>
    </AppPage>
  );
}

function Inner({ me }: { me: Account }) {
  const hasProfile = me.role !== 'client';
  const q = useGetLawyerProfile({ query: { enabled: hasProfile, queryKey: getGetLawyerProfileQueryKey(), retry: false } });
  if (hasProfile && q.isLoading) return <Skeleton className="h-[70vh] rounded-3xl" />;
  if (hasProfile && q.isError && me.role === 'lawyer') return <ErrorState error={q.error} onRetry={() => q.refetch()} />;
  return <ProfileForm me={me} existing={q.data ?? undefined} />;
}

const empty: LawyerInput = {
  name: '', title: '', bio: '', practiceAreas: [], languages: [], experienceYears: 0, barCouncil: '', enrollmentNumber: '', fee: 999, city: '', availability: [1, 2, 3, 4, 5], online: false,
};

function ProfileForm({ me, existing }: { me: Account; existing?: Lawyer }) {
  const platform = useGetPlatform();
  const save = useSaveLawyerProfile();
  const qc = useQueryClient();
  const { toast } = useToast();
  const [f, setF] = useState<LawyerInput>({ ...empty, name: me.name });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const init = useRef(false);
  useEffect(() => {
    if (existing && !init.current) {
      init.current = true;
      setF({
        name: existing.name, title: existing.title, bio: existing.bio, practiceAreas: existing.practiceAreas, languages: existing.languages,
        experienceYears: existing.experienceYears, barCouncil: existing.barCouncil, enrollmentNumber: existing.enrollmentNumber, fee: existing.fee,
        city: existing.city, availability: existing.availability, online: existing.online,
      });
    }
  }, [existing]);

  const set = <K extends keyof LawyerInput>(k: K, v: LawyerInput[K]) => setF((p) => ({ ...p, [k]: v }));
  const toggle = (k: 'practiceAreas' | 'languages', v: string) => set(k, f[k].includes(v) ? f[k].filter((x) => x !== v) : [...f[k], v]);

  const validate = () => {
    const e: Record<string, string> = {};
    if (f.name.trim().length < 2) e.name = 'At least 2 characters';
    if (f.title.trim().length < 3) e.title = 'At least 3 characters';
    if (f.bio.trim().length < 40) e.bio = `At least 40 characters (${f.bio.trim().length}/40)`;
    if (!f.practiceAreas.length) e.practiceAreas = 'Choose at least one';
    if (!f.languages.length) e.languages = 'Choose at least one';
    if (f.experienceYears < 0 || f.experienceYears > 70) e.experienceYears = '0 to 70';
    if (f.barCouncil.trim().length < 3) e.barCouncil = 'Required';
    if (f.enrollmentNumber.trim().length < 3) e.enrollmentNumber = 'Required';
    if (f.fee < 1 || f.fee > 100000) e.fee = '₹1 to ₹1,00,000';
    if (f.city.trim().length < 2) e.city = 'Required';
    if (!f.availability.length) e.availability = 'Choose at least one day';
    setErrors(e);
    return Object.keys(e).length === 0;
  };

  const submit = () => {
    if (!validate()) return;
    save.mutate(
      { data: { ...f, name: f.name.trim(), title: f.title.trim(), bio: f.bio.trim(), city: f.city.trim(), barCouncil: f.barCouncil.trim(), enrollmentNumber: f.enrollmentNumber.trim() } },
      {
        onSuccess: (l) => {
          init.current = true;
          qc.setQueryData(getGetLawyerProfileQueryKey(), l);
          qc.invalidateQueries({ queryKey: getGetMeQueryKey() });
          qc.invalidateQueries({ queryKey: getListLawyersQueryKey() });
          qc.invalidateQueries({ queryKey: getGetLawyerQueryKey(l.id) });
          toast({ title: existing ? 'Profile updated' : 'Application submitted', description: l.approvalStatus === 'pending' ? 'Our team will review your enrolment details.' : undefined });
        },
        onError: (e) => toast({ title: 'Could not save', description: errMsg(e), variant: 'destructive' }),
      },
    );
  };

  const status = existing?.approvalStatus;
  return (
    <>
      <PageHeader
        eyebrow={existing ? 'Professional profile' : 'Lawyer application'}
        title={existing ? 'Your practice, as clients see it' : 'Apply to list your practice'}
        sub={existing ? 'Changes to credentials may be reviewed again.' : 'Share your enrolment details. Your listing goes live after review. Meanwhile, the document workspace is open to you.'}
        actions={existing && status === 'approved' ? <Button asChild variant="outline" className="rounded-full"><Link href={`/lawyers/${existing.id}`}><ExternalLink /> View public profile</Link></Button> : undefined}
      />
      {status && (
        <div className={cn('mb-6 flex items-start gap-3 rounded-2xl border p-4 text-sm', status === 'approved' ? 'border-[hsl(168_40%_36%/0.4)] bg-[hsl(168_40%_36%/0.08)]' : status === 'pending' ? 'border-haldi/60 bg-haldi/15' : 'border-destructive/30 bg-destructive/5')} data-testid="status-approval">
          {status === 'approved' ? <BadgeCheck className="h-5 w-5 text-[hsl(168_45%_30%)]" /> : status === 'pending' ? <Hourglass className="h-5 w-5 text-primary" /> : <XCircle className="h-5 w-5 text-destructive" />}
          <div>
            <strong className="capitalize">{status}.</strong>{' '}
            {status === 'approved' ? 'Your profile is listed in the directory.' : status === 'pending' ? 'We are reviewing your application. You can use Documents meanwhile.' : `Reason: ${existing?.rejectionReason || 'not specified'}. Update your details and save to resubmit.`}
            {status === 'pending' && <> <Link href="/documents" className="font-medium text-primary underline">Open documents</Link></>}
          </div>
        </div>
      )}
      <div className="grid gap-8 lg:grid-cols-[1fr_300px]">
        <div className="space-y-8 rounded-3xl border bg-card p-6 md:p-8">
          <Section title="Who you are">
            <Field label="Full name" err={errors.name}><Input value={f.name} maxLength={100} onChange={(e) => set('name', e.target.value)} data-testid="input-name" /></Field>
            <Field label="Professional title" err={errors.title}><Input value={f.title} maxLength={150} placeholder="Advocate, Delhi High Court" onChange={(e) => set('title', e.target.value)} data-testid="input-title" /></Field>
            <Field label="City" err={errors.city}><Input value={f.city} maxLength={100} onChange={(e) => set('city', e.target.value)} data-testid="input-city" /></Field>
            <Field label="Years in practice" err={errors.experienceYears}><Input type="number" min={0} max={70} value={f.experienceYears} onChange={(e) => set('experienceYears', Number(e.target.value))} data-testid="input-experience" /></Field>
            <Field label="About your practice" err={errors.bio} full>
              <Textarea rows={5} maxLength={2000} value={f.bio} onChange={(e) => set('bio', e.target.value)} placeholder="The matters you handle, how you work with clients, courts you appear in." data-testid="input-bio" />
            </Field>
          </Section>
          <Section title="Enrolment">
            <Field label="State Bar Council" err={errors.barCouncil}><Input value={f.barCouncil} maxLength={200} placeholder="Bar Council of Maharashtra & Goa" onChange={(e) => set('barCouncil', e.target.value)} data-testid="input-bar-council" /></Field>
            <Field label="Enrolment number" err={errors.enrollmentNumber}><Input value={f.enrollmentNumber} maxLength={100} placeholder="MAH/1234/2015" onChange={(e) => set('enrollmentNumber', e.target.value)} data-testid="input-enrollment" /></Field>
          </Section>
          <Section title="Practice areas" err={errors.practiceAreas}>
            <Chips options={(platform.data?.categories ?? []).map((c) => c.name)} selected={f.practiceAreas} onToggle={(v) => toggle('practiceAreas', v)} />
          </Section>
          <Section title="Languages you consult in" err={errors.languages}>
            <Chips options={platform.data?.languages ?? []} selected={f.languages} onToggle={(v) => toggle('languages', v)} />
          </Section>
          <Section title="Fee and availability">
            <Field label="Fee for a 30-minute consultation (INR)" err={errors.fee}><Input type="number" min={1} max={100000} value={f.fee} onChange={(e) => set('fee', Number(e.target.value))} data-testid="input-fee" /></Field>
            <Field label="Available now">
              <label className="flex h-10 items-center gap-3 text-sm"><Switch checked={f.online} onCheckedChange={(c) => set('online', c)} data-testid="switch-online" /> Show me as available</label>
            </Field>
            <Field label="Weekly days (IST)" err={errors.availability} full>
              <div className="flex gap-1.5">
                {WEEKDAYS.map((d, i) => (
                  <button key={d} type="button" onClick={() => set('availability', f.availability.includes(i) ? f.availability.filter((x) => x !== i) : [...f.availability, i].sort())} className={cn('h-11 flex-1 rounded-xl border font-mono text-xs transition-colors', f.availability.includes(i) ? 'border-primary bg-primary text-primary-foreground' : 'bg-background')} data-testid={`button-day-${i}`}>{d}</button>
                ))}
              </div>
            </Field>
          </Section>
          <div className="flex justify-end">
            <Button size="lg" className="rounded-full" onClick={submit} disabled={save.isPending} data-testid="button-save-profile">
              {save.isPending && <Loader2 className="animate-spin" />} {existing ? 'Save profile' : 'Submit application'}
            </Button>
          </div>
        </div>
        <aside className="space-y-4 lg:sticky lg:top-24 lg:self-start">
          <Notice icon={<Info />}>Your enrolment details are reviewed manually by an administrator. Do not upload ID documents here.</Notice>
          <Notice icon={<Info />} tone="ink">Checkout stays disabled until Razorpay verification. You can accept real requests only after verified payment. If you cancel a paid consultation, the client becomes eligible for a full refund.</Notice>
        </aside>
      </div>
    </>
  );
}

function Section({ title, err, children }: { title: string; err?: string; children: React.ReactNode }) {
  return (
    <section>
      <h2 className="mb-4 flex items-baseline gap-3 text-xl font-semibold">{title}{err && <span className="font-sans text-xs font-normal text-destructive">{err}</span>}</h2>
      <div className="grid gap-4 sm:grid-cols-2">{children}</div>
    </section>
  );
}
function Field({ label, err, full, children }: { label: string; err?: string; full?: boolean; children: React.ReactNode }) {
  return (
    <div className={full ? 'sm:col-span-2' : ''}>
      <Label className="text-[13px]">{label}</Label>
      <div className="mt-1.5">{children}</div>
      {err && <p className="mt-1 text-xs text-destructive">{err}</p>}
    </div>
  );
}
function Chips({ options, selected, onToggle }: { options: string[]; selected: string[]; onToggle: (v: string) => void }) {
  return (
    <div className="flex flex-wrap gap-2 sm:col-span-2">
      {options.map((o) => (
        <button key={o} type="button" onClick={() => onToggle(o)} className={cn('rounded-full border px-3.5 py-1.5 text-[13px] transition-all', selected.includes(o) ? 'border-primary bg-primary text-primary-foreground' : 'bg-background hover:border-primary/40')} data-testid={`chip-${o}`}>{o}</button>
      ))}
    </div>
  );
}
