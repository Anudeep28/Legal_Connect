import { useMemo, useState } from 'react';
import { Link, useLocation } from 'wouter';
import { useQueryClient } from '@tanstack/react-query';
import { MessageSquareText, Phone, FileSignature, Info, Loader2, CalendarX2 } from 'lucide-react';
import {
  useGetLawyerSlots,
  getGetLawyerSlotsQueryKey,
  useCreateConsultation,
  getListConsultationsQueryKey,
  getListNotificationsQueryKey,
  type Lawyer,
  type ConsultationInputPackage,
} from '@workspace/api-client-react';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { Skeleton } from '@/components/ui/skeleton';
import { useToast } from '@/hooks/use-toast';
import { cn } from '@/lib/utils';
import { errMsg, fmtTime, inr, istDateKey, labelOfKey, weekdayOfKey } from '@/lib/format';
import { useAccount } from '@/lib/account';
import { Notice } from '@/components/kit';

export function BookingDialog({ lawyer, open, onOpenChange, callsEnabled }: { lawyer: Lawyer; open: boolean; onOpenChange: (o: boolean) => void; callsEnabled: boolean }) {
  const { signedIn } = useAccount();
  const [, setLocation] = useLocation();
  const qc = useQueryClient();
  const { toast } = useToast();
  const days = useMemo(() => Array.from({ length: 14 }, (_, i) => istDateKey(i)), []);
  const [date, setDate] = useState(() => days.find((d) => lawyer.availability.includes(weekdayOfKey(d))) ?? days[0]);
  const [slot, setSlot] = useState<string | null>(null);
  const [topic, setTopic] = useState('');
  const [notes, setNotes] = useState('');
  const [pkg, setPkg] = useState<ConsultationInputPackage>('consultation_only');
  const [mode, setMode] = useState<'chat' | 'call'>('chat');
  const slots = useGetLawyerSlots(lawyer.id, date, { query: { enabled: open && signedIn, queryKey: getGetLawyerSlotsQueryKey(lawyer.id, date) } });
  const create = useCreateConsultation();

  const docFee = Math.round((lawyer.fee * lawyer.documentFeePercent) / 100);
  const total = pkg === 'consultation_document' ? lawyer.fee + docFee : lawyer.fee;
  const canSubmit = !!slot && topic.trim().length >= 3 && !create.isPending && (mode === 'chat' || (callsEnabled && !lawyer.demo));

  const submit = () => {
    if (!slot || !canSubmit) return;
    create.mutate(
      { data: { lawyerId: lawyer.id, startsAt: slot, topic: topic.trim(), notes: notes.trim() || undefined, mode, package: pkg } },
      {
        onSuccess: (c) => {
          qc.invalidateQueries({ queryKey: getListConsultationsQueryKey() });
          qc.invalidateQueries({ queryKey: getGetLawyerSlotsQueryKey(lawyer.id, date) });
          qc.invalidateQueries({ queryKey: getListNotificationsQueryKey() });
          toast({ title: c.demo ? 'Demo request saved' : 'Request sent', description: 'Unpaid request saved. Payment and lawyer acceptance are separate steps.' });
          onOpenChange(false);
          setLocation(`/consultations/${c.id}`);
        },
        onError: (e) => toast({ title: 'Could not save request', description: errMsg(e), variant: 'destructive' }),
      },
    );
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[92dvh] max-w-2xl overflow-y-auto rounded-3xl p-0">
        <div className="ink-panel rounded-t-3xl px-6 pb-5 pt-6">
          <DialogHeader>
            <p className="font-mono text-[10px] uppercase tracking-[0.25em] text-haldi">Request a 30-minute consultation</p>
            <DialogTitle className="font-display text-2xl text-white">{lawyer.name}</DialogTitle>
            <DialogDescription className="text-white/70">
              {inr(lawyer.fee)} per 30-minute consultation · all times in IST
            </DialogDescription>
          </DialogHeader>
        </div>
        {!signedIn ? (
          <div className="p-6 text-center">
            <p className="text-sm text-muted-foreground">Sign in to save a consultation request with this lawyer.</p>
            <div className="mt-4 flex justify-center gap-2">
              <Button asChild><Link href="/sign-in">Sign in</Link></Button>
              <Button asChild variant="outline"><Link href="/sign-up">Create account</Link></Button>
            </div>
          </div>
        ) : (
          <div className="space-y-6 p-6">
            {lawyer.demo && (
              <Notice icon={<Info />} tone="ink">
                This is an <strong>illustrative example profile</strong>, not a real advocate. Your request is saved as a labelled demo and no legal advice will be given.
              </Notice>
            )}
            <section>
              <Label className="mb-2 block text-[13px]">Pick a day</Label>
              <div className="-mx-1 flex gap-2 overflow-x-auto px-1 pb-2">
                {days.map((d) => {
                  const l = labelOfKey(d);
                  const avail = lawyer.availability.includes(weekdayOfKey(d));
                  return (
                    <button
                      key={d}
                      type="button"
                      disabled={!avail}
                      onClick={() => {
                        setDate(d);
                        setSlot(null);
                      }}
                      className={cn(
                        'flex w-14 shrink-0 flex-col items-center rounded-2xl border py-2 transition-all',
                        d === date ? 'border-primary bg-primary text-primary-foreground shadow-md' : 'bg-card hover:border-primary/40',
                        !avail && 'cursor-not-allowed opacity-35',
                      )}
                      data-testid={`button-day-${d}`}
                    >
                      <span className="font-mono text-[10px] uppercase">{l.wd}</span>
                      <span className="font-display text-xl leading-tight">{l.day}</span>
                      <span className="text-[10px]">{l.mon}</span>
                    </button>
                  );
                })}
              </div>
            </section>
            <section>
              <Label className="mb-2 block text-[13px]">Available half-hour slots</Label>
              {slots.isLoading ? (
                <div className="grid grid-cols-3 gap-2 sm:grid-cols-5">{Array.from({ length: 10 }).map((_, i) => <Skeleton key={i} className="h-9 rounded-xl" />)}</div>
              ) : slots.isError ? (
                <p className="text-sm text-destructive">{errMsg(slots.error)}</p>
              ) : (slots.data ?? []).length === 0 ? (
                <div className="flex items-center gap-2 rounded-xl bg-muted px-4 py-3 text-sm text-muted-foreground"><CalendarX2 className="h-4 w-4" /> No open slots this day. Try another date.</div>
              ) : (
                <div className="grid grid-cols-3 gap-2 sm:grid-cols-5">
                  {(slots.data ?? []).map((s) => (
                    <button
                      key={s}
                      type="button"
                      onClick={() => setSlot(s)}
                      className={cn('rounded-xl border py-2 font-mono text-[12.5px] transition-all', slot === s ? 'border-haldi bg-haldi text-ink' : 'bg-card hover:border-primary/40')}
                      data-testid={`button-slot-${s}`}
                    >
                      {fmtTime(s)}
                    </button>
                  ))}
                </div>
              )}
            </section>
            <section className="grid gap-3 sm:grid-cols-2">
              <button type="button" onClick={() => setMode('chat')} aria-pressed={mode === 'chat'} className={cn("flex items-start gap-3 rounded-2xl border-2 p-4 text-left", mode === 'chat' ? 'border-primary bg-primary/5' : 'border-border')} data-testid="button-mode-chat">
                <MessageSquareText className="mt-0.5 h-5 w-5 text-primary" />
                <span><span className="block font-medium">Chat</span><span className="text-xs text-muted-foreground">Written messages inside the consultation</span></span>
              </button>
              <button type="button" disabled={!callsEnabled || lawyer.demo} onClick={() => setMode('call')} aria-pressed={mode === 'call'} className={cn("flex items-start gap-3 rounded-2xl border-2 p-4 text-left disabled:cursor-not-allowed disabled:opacity-50", mode === 'call' ? 'border-primary bg-primary/5' : 'border-border')} data-testid="button-mode-call">
                <Phone className="mt-0.5 h-5 w-5" />
                <span><span className="block font-medium">Call</span><span className="text-xs text-muted-foreground">{lawyer.demo ? 'Unavailable for illustrative profiles' : callsEnabled ? 'Private audio through Twilio' : 'Twilio is not configured'}</span></span>
              </button>
            </section>
            <section className="grid gap-3 sm:grid-cols-2">
              {(['consultation_only', 'consultation_document'] as const).map((p) => (
                <button
                  key={p}
                  type="button"
                  onClick={() => setPkg(p)}
                  className={cn('rounded-2xl border-2 p-4 text-left transition-all', pkg === p ? 'border-primary bg-primary/5' : 'border-border hover:border-primary/30')}
                  data-testid={`button-package-${p}`}
                >
                  <div className="flex items-center gap-2 font-medium">
                    {p === 'consultation_document' && <FileSignature className="h-4 w-4 text-primary" />}
                    {p === 'consultation_only' ? 'Consultation only' : 'Consultation + document'}
                  </div>
                  <div className="mt-1 font-display text-xl">{inr(p === 'consultation_only' ? lawyer.fee : lawyer.fee + docFee)}</div>
                  <div className="text-xs text-muted-foreground">
                    {p === 'consultation_only' ? '30 minutes with the advocate' : `Includes a drafted document (+${lawyer.documentFeePercent}%)`}
                  </div>
                </button>
              ))}
            </section>
            <section className="space-y-3">
              <div>
                <Label htmlFor="topic" className="text-[13px]">What is this about?</Label>
                <Input id="topic" value={topic} maxLength={200} onChange={(e) => setTopic(e.target.value)} placeholder="e.g. Landlord is withholding my security deposit" className="mt-1.5" data-testid="input-topic" />
              </div>
              <div>
                <Label htmlFor="notes" className="text-[13px]">Background for the lawyer (optional)</Label>
                <Textarea id="notes" value={notes} maxLength={5000} onChange={(e) => setNotes(e.target.value)} rows={4} placeholder="Dates, documents you have, what you have tried so far. Avoid sharing passwords or ID numbers." className="mt-1.5" data-testid="input-notes" />
              </div>
            </section>
            <Notice icon={<Info />}>
              This saves an <strong>unpaid consultation request</strong>, not a confirmed appointment. For real lawyers, verified payment is required before acceptance. Checkout remains disabled until Razorpay verification. Fee {inr(total)}. Client cancellation does not qualify for a refund; lawyer cancellation does, subject to applicable law.
            </Notice>
            <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
              <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
              <Button disabled={!canSubmit} onClick={submit} className="min-w-[200px]" data-testid="button-submit-request">
                {create.isPending ? <Loader2 className="animate-spin" /> : null}
                {lawyer.demo ? 'Save demo request' : 'Send request'}
              </Button>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
