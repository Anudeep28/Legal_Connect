import { useEffect, useRef, useState } from 'react';
import { Link, useParams } from 'wouter';
import { useQueryClient } from '@tanstack/react-query';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import {
  ArrowLeft, Send, Check, X, CheckCheck, Info, FileText, Sparkles, Save, Loader2, Download, Lock, Plus, Pencil, Star,
} from 'lucide-react';
import {
  useGetConsultation, getGetConsultationQueryKey,
  useUpdateConsultation, getListConsultationsQueryKey,
  useListMessages, getListMessagesQueryKey, useSendMessage,
  useListDeliverables, getListDeliverablesQueryKey, useCreateDeliverable, useUpdateDeliverable,
  useCreateReview, getListLawyerReviewsQueryKey, getGetLawyerQueryKey,
  useAssistWriting, useGetPlatform, getListNotificationsQueryKey,
  useListCallTranscripts, getListCallTranscriptsQueryKey, useUpdateCallTranscript, useDraftFromCallTranscript,
  type Account, type Consultation, type ConsultationUpdateStatus, type Deliverable, type DeliverableInputStatus,
  type CallTranscriptSession, type CallTranscriptDraftResponse, type Platform,
} from '@workspace/api-client-react';
import { Button } from '@/components/ui/button';
import { AiRequestConsentDialog } from '@/components/ai-request-consent-dialog';
import { Textarea } from '@/components/ui/textarea';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger,
} from '@/components/ui/alert-dialog';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Guard } from '@/components/guard';
import { AppPage } from '@/components/shell';
import { DemoTag, ErrorState, Notice, PersonAvatar, StatusPill } from '@/components/kit';
import { useToast } from '@/hooks/use-toast';
import { cn } from '@/lib/utils';
import { errMsg, fmtDateTime, fmtTime, inr } from '@/lib/format';
import { exportDocx, exportMarkdown, exportPdf } from '@/lib/export';
import { usePaymentCheckout } from '@/hooks/use-payment-checkout';
import { PaymentHistory } from '@/components/payment-history';
import { ConsultationCall } from '@/components/consultation-call';
import { AiUsageNotice } from '@/components/ai-usage';

export default function ConsultationDetail() {
  const { id = '' } = useParams<{ id: string }>();
  return (
    <AppPage>
      <Link href="/consultations" className="mb-5 inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-primary"><ArrowLeft className="h-4 w-4" /> All consultations</Link>
      <Guard>{(me) => <Inner id={id} me={me} />}</Guard>
    </AppPage>
  );
}

function Inner({ id, me }: { id: string; me: Account }) {
  const q = useGetConsultation(id, { query: { enabled: !!id, queryKey: getGetConsultationQueryKey(id), refetchInterval: 10000 } });
  const [generatedDraft, setGeneratedDraft] = useState<(CallTranscriptDraftResponse & { sessionId: string; version: number }) | null>(null);
  if (q.isLoading) return <div className="space-y-4"><Skeleton className="h-40 rounded-3xl" /><Skeleton className="h-96 rounded-3xl" /></div>;
  if (q.isError || !q.data) return <ErrorState error={q.error} onRetry={() => q.refetch()} title="This consultation is not available" />;
  const c = q.data;
  // Only the consulting advocate sees lawyer controls; admins and other readers get the read-only client view.
  const asLawyer = me.role === 'lawyer' && c.userId !== me.id;
  const isClient = c.userId === me.id;
  const asClient = !asLawyer;
  return (
    <div>
      <Header c={c} asClient={asClient} isClient={isClient} />
      {isClient && <ConsultationPayment c={c} />}
      {c.mode === 'call' && (isClient || me.role === 'lawyer') && <ConsultationCall consultation={c} asLawyer={asLawyer} />}
      <div className="mt-6 grid gap-6 lg:grid-cols-[1.25fr_1fr]">
        <Messages c={c} asClient={asClient} />
        <div className="space-y-6">
          {asLawyer && c.mode === 'call' && <CallTranscriptWorkspace c={c} onDraftReady={(draft) => setGeneratedDraft({ ...draft, version: Date.now() })} />}
          {c.notes && (
            <section className="rounded-3xl border bg-card p-5">
              <h3 className="font-mono text-[11px] uppercase tracking-[0.2em] text-muted-foreground">Client's background note</h3>
              <p className="mt-2 whitespace-pre-line text-[14.5px] leading-relaxed">{c.notes}</p>
            </section>
          )}
          <Transcript c={c} asClient={asClient} />
          <Deliverables
            c={c}
            asClient={asClient}
            initialDraft={generatedDraft}
            onDraftConsumed={() => setGeneratedDraft(null)}
          />
          {isClient && c.status === 'completed' && <ReviewBox c={c} />}
        </div>
      </div>
    </div>
  );
}

function ConsultationPayment({ c }: { c: Consultation }) {
  const [confirmOpen, setConfirmOpen] = useState(false);
  const platform = useGetPlatform({ query: { refetchInterval: 15_000 } });
  const checkout = usePaymentCheckout();
  const payable = !c.demo && c.status === 'requested' && ['unpaid', 'pending'].includes(c.paymentStatus) && new Date(c.startsAt).getTime() > Date.now();
  const checkoutReady = !!platform.data?.paidConsultationsEnabled;
  const checkoutPaused = !!platform.data?.consultationCheckoutPaused;
  const continueToPayment = () => {
    setConfirmOpen(false);
    void checkout.start({ plan: 'consultation', consultationId: c.id });
  };
  return <div className="mt-4">
    <Notice icon={<Info />}>
      Payment: <strong>{c.paymentStatus.replace('_', ' ')}</strong>. {c.paymentStatus === 'paid' ? 'Captured payment does not itself confirm the appointment; the lawyer must accept.'
        : c.demo ? 'Illustrative profiles never accept payments.' : 'Only a server-verified captured payment marks this request paid.'}
      {payable && (
        <div className="mt-3 rounded-xl border border-border/70 bg-background/70 p-3 text-sm" data-testid="payment-review-summary">
          <strong>Before you pay:</strong> {inr(c.fee)} is for one 30-minute {c.mode} consultation scheduled for {fmtDateTime(c.startsAt)} IST. Payment is collected before the advocate accepts. The appointment is confirmed only after the advocate accepts. If they decline or cancel, request an eligible refund from Payment history; Razorpay returns it to the original payment method after processing. Client cancellation is generally non-refundable, subject to applicable law.
        </div>
      )}
      {payable && <Button className="mt-3 block" disabled={!checkoutReady || checkout.pending} onClick={() => setConfirmOpen(true)} data-testid="button-pay-consultation">
        {checkoutReady ? `Pay ${inr(c.fee)} with Razorpay` : checkoutPaused ? 'Consultation checkout is temporarily paused' : 'Paid consultation checkout is closed'}
      </Button>}
      {payable && !checkoutReady && <p className="mt-2 text-sm">{checkoutPaused
        ? 'Paid consultation checkout is temporarily paused by the platform. No payment will be taken. Please check back later.'
        : 'Paid consultations open only after Razorpay verification and qualified-counsel approval of the current policies and contact details.'}</p>}
      <p className="mt-2 text-sm">Consultation refunds require lawyer cancellation. Client cancellation is not refundable, subject to applicable law.</p>
    </Notice>
    <AlertDialog open={confirmOpen} onOpenChange={setConfirmOpen}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle className="font-display">Review before you pay</AlertDialogTitle>
          <AlertDialogDescription>
            You are about to pay {inr(c.fee)} for one 30-minute {c.mode} consultation on {fmtDateTime(c.startsAt)} IST. Payment does not confirm the appointment; the advocate must accept after payment is verified. If the advocate declines or cancels, you can request an eligible refund from Payment history. Client cancellation is generally non-refundable, subject to applicable law.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Go back</AlertDialogCancel>
          <AlertDialogAction onClick={continueToPayment} data-testid="button-confirm-consultation-payment">Continue to Razorpay</AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
    <PaymentHistory consultationId={c.id} />
  </div>;
}

function CallTranscriptWorkspace({
  c,
  onDraftReady,
}: {
  c: Consultation;
  onDraftReady: (draft: CallTranscriptDraftResponse & { sessionId: string }) => void;
}) {
  const q = useListCallTranscripts(c.id, {
    query: { queryKey: getListCallTranscriptsQueryKey(c.id), refetchInterval: 5000 },
  });
  const platform = useGetPlatform();
  return (
    <section className="rounded-3xl border bg-card p-5" data-testid="call-transcript-workspace">
      <h3 className="font-display text-lg font-semibold">Private call transcript</h3>
      <p className="mt-1 text-sm text-muted-foreground">Only the assigned lawyer can view or edit these transcripts. Correct the text before using it to prepare a document.</p>
      <div className="mt-3"><AiUsageNotice /></div>
      {q.isLoading ? <Skeleton className="mt-3 h-20" /> : q.isError ? (
        <ErrorState error={q.error} onRetry={() => q.refetch()} />
      ) : q.data?.length ? (
        <div className="mt-4 space-y-5">
          {q.data.map((session) => (
            <CallTranscriptCard
              key={session.id}
              c={c}
              session={session}
              templates={platform.data?.templates ?? []}
              languages={platform.data?.languages ?? []}
              onDraftReady={onDraftReady}
            />
          ))}
        </div>
      ) : (
        <p className="mt-3 text-sm text-muted-foreground">No consented call transcript is available yet. Transcription begins only after both participants opt in and the call room ends.</p>
      )}
    </section>
  );
}

function CallTranscriptCard({
  c,
  session,
  templates,
  languages,
  onDraftReady,
}: {
  c: Consultation;
  session: CallTranscriptSession;
  templates: Platform['templates'];
  languages: Platform['languages'];
  onDraftReady: (draft: CallTranscriptDraftResponse & { sessionId: string }) => void;
}) {
  const qc = useQueryClient();
  const { toast } = useToast();
  const save = useUpdateCallTranscript();
  const generate = useDraftFromCallTranscript();
  const [text, setText] = useState(session.editedTranscript);
  const [templateId, setTemplateId] = useState('');
  const [language, setLanguage] = useState('English');
  const [draftConsentOpen, setDraftConsentOpen] = useState(false);
  const draftTriggerRef = useRef<HTMLButtonElement>(null);
  const dirty = text !== session.editedTranscript;

  useEffect(() => {
    setText(session.editedTranscript);
  }, [session.id, session.editedTranscript]);
  useEffect(() => {
    if (!templateId && templates[0]) setTemplateId(templates[0].id);
  }, [templateId, templates]);

  const saveTranscript = () => save.mutate(
    { id: c.id, sessionId: session.id, data: { editedTranscript: text } },
    {
      onSuccess: () => {
        qc.invalidateQueries({ queryKey: getListCallTranscriptsQueryKey(c.id) });
        toast({ title: 'Transcript saved privately' });
      },
      onError: (error) => toast({ title: 'Transcript could not be saved', description: errMsg(error), variant: 'destructive' }),
    },
  );

  const openDraftConsent = () => {
    if (!templateId || dirty || session.status !== 'ready' || generate.isPending) return;
    setDraftConsentOpen(true);
  };

  const draftFromTranscript = () => {
    if (!templateId || dirty || session.status !== 'ready' || generate.isPending) return;
    setDraftConsentOpen(false);
    generate.mutate(
      {
        id: c.id,
        sessionId: session.id,
        data: { templateId, language, dataUseAcknowledged: true },
      },
      {
        onSuccess: (draft) => {
          onDraftReady({ ...draft, sessionId: session.id });
          toast({ title: 'Draft preview is ready for your review' });
        },
        onError: (error) => toast({ title: 'AI draft could not be created', description: errMsg(error), variant: 'destructive' }),
      },
    );
  };

  const statusLabel = session.status === 'recording' ? 'Recording in progress'
    : session.status === 'processing' ? 'Transcribing the completed call'
      : session.status === 'ready' ? 'Transcript ready for lawyer review'
        : session.status === 'withdrawn' ? 'Recording was withdrawn; no transcript was created'
          : 'Transcription failed; raw audio cleanup is being retried';

  return (
    <article className="rounded-2xl border p-4" data-testid={`call-transcript-${session.id}`}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="font-medium">{statusLabel}</p>
        <span className="text-xs text-muted-foreground">{new Date(session.createdAt).toLocaleString()}</span>
      </div>
      {session.detectedLanguages.length > 0 && (
        <p className="mt-1 text-xs text-muted-foreground">Detected languages: {session.detectedLanguages.join(', ')}</p>
      )}
      {session.status === 'ready' ? (
        <>
          <Textarea
            value={text}
            onChange={(event) => setText(event.target.value)}
            rows={12}
            maxLength={100000}
            className="mt-3 font-mono text-[13px]"
            aria-label="Edit private call transcript"
            data-testid={`input-call-transcript-${session.id}`}
          />
          <div className="mt-2 flex flex-wrap gap-2">
            <Button size="sm" variant="outline" onClick={saveTranscript} disabled={!dirty || save.isPending} data-testid={`button-save-call-transcript-${session.id}`}>
              {save.isPending ? <Loader2 className="animate-spin" /> : <Save />} Save transcript
            </Button>
          </div>
          <div className="mt-4 grid gap-3 sm:grid-cols-2">
            <label className="space-y-1 text-sm">
              <span>Legal template</span>
              <select value={templateId} onChange={(event) => setTemplateId(event.target.value)} className="w-full rounded-xl border bg-background px-3 py-2" data-testid={`select-call-template-${session.id}`}>
                {templates.map((template) => <option key={template.id} value={template.id}>{template.name}</option>)}
              </select>
            </label>
            <label className="space-y-1 text-sm">
              <span>Draft language</span>
              <select value={language} onChange={(event) => setLanguage(event.target.value)} className="w-full rounded-xl border bg-background px-3 py-2" data-testid={`select-draft-language-${session.id}`}>
                {languages.map((item) => <option key={item} value={item}>{item}</option>)}
              </select>
            </label>
          </div>
          <Notice icon={<Info />} className="mt-3">
            Generating a draft sends this lawyer-edited transcript and the selected template to DeepSeek. The result is only a preview; it is not saved or sent to the client automatically.
          </Notice>
          <Button ref={draftTriggerRef} className="mt-3" onClick={openDraftConsent} disabled={!templateId || dirty || generate.isPending} data-testid={`button-generate-call-draft-${session.id}`}>
            {generate.isPending ? <Loader2 className="animate-spin" /> : <Sparkles />} Generate document draft
          </Button>
          {dirty && <p className="mt-2 text-xs text-muted-foreground">Save your transcript corrections before generating this draft.</p>}
          <AiRequestConsentDialog
            open={draftConsentOpen}
            provider="DeepSeek"
            description="Your reviewed transcript and selected legal template will be sent to DeepSeek for a draft preview. The draft is not saved or delivered automatically."
            testIdPrefix={`call-draft-${session.id}`}
            returnFocusRef={draftTriggerRef}
            onCancel={() => setDraftConsentOpen(false)}
            onContinue={draftFromTranscript}
          />
        </>
      ) : session.status === 'failed' ? (
        <p className="mt-2 text-sm text-muted-foreground">No AI draft can be generated from an incomplete transcript. The call recording is deleted after transcription retries are exhausted.</p>
      ) : null}
    </article>
  );
}

function useStatusMutation(c: Consultation) {
  const qc = useQueryClient();
  const { toast } = useToast();
  const m = useUpdateConsultation();
  const run = (status: ConsultationUpdateStatus, msg: string) =>
    m.mutate(
      { id: c.id, data: { status } },
      {
        onSuccess: (updated) => {
          qc.setQueryData(getGetConsultationQueryKey(c.id), updated);
          qc.invalidateQueries({ queryKey: getListConsultationsQueryKey() });
          qc.invalidateQueries({ queryKey: getListMessagesQueryKey(c.id) });
          qc.invalidateQueries({ queryKey: getListNotificationsQueryKey() });
          toast({ title: msg });
        },
        onError: (e) => toast({ title: 'Could not update', description: errMsg(e), variant: 'destructive' }),
      },
    );
  return { run, pending: m.isPending };
}

function Header({ c, asClient, isClient }: { c: Consultation; asClient: boolean; isClient: boolean }) {
  const { run, pending } = useStatusMutation(c);
  const other = asClient ? c.lawyerName : c.clientName;
  return (
    <section className="ink-panel relative overflow-hidden rounded-[2rem] p-6 md:p-8 rise">
      <div className="flex flex-col gap-5 md:flex-row md:items-start md:justify-between">
        <div className="flex gap-4">
          <PersonAvatar name={other} src={asClient ? c.lawyerAvatar : undefined} className="h-16 w-16" />
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <StatusPill status={c.status} />
              <span className="text-xs text-white/80">Payment: {c.paymentStatus.replace('_', ' ')}</span>
              {c.demo && <DemoTag className="bg-white/90" />}
              <span className="rounded-full border border-white/20 px-2 py-0.5 font-mono text-[10px] uppercase text-white/70">{!asClient ? 'You are the advocate' : isClient ? 'You are the client' : 'Read-only view'}</span>
            </div>
            <h1 className="mt-2 text-2xl font-semibold text-white md:text-4xl" data-testid="text-topic">{c.topic}</h1>
            <p className="mt-1 text-sm text-white/70">
              {asClient ? 'with' : 'from'} {other} · {fmtDateTime(c.startsAt)} to {fmtTime(c.endsAt)} IST · {c.mode} · {c.package === 'consultation_document' ? 'with document' : 'consultation only'} · {inr(c.fee)}
            </p>
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          {!asClient && c.status === 'requested' && (
            <>
              <Button onClick={() => run('booked', 'Request accepted')} disabled={pending || (!c.demo && c.paymentStatus !== 'paid')} className="rounded-full bg-haldi text-ink hover:bg-haldi" data-testid="button-accept"><Check /> {c.paymentStatus === 'paid' ? 'Accept request' : 'Awaiting verified payment'}</Button>
              <ConfirmButton label="Decline" icon={<X />} title="Decline this request?" body="The client will see it as cancelled." onConfirm={() => run('cancelled', 'Request declined')} />
            </>
          )}
          {!asClient && c.status === 'booked' && (
            <>
              <Button onClick={() => run('completed', 'Marked as completed')} disabled={pending} className="rounded-full bg-haldi text-ink hover:bg-haldi" data-testid="button-complete"><CheckCheck /> Mark completed</Button>
              <ConfirmButton label="Cancel" icon={<X />} title="Cancel this consultation?" body="The client will be notified that it is cancelled." onConfirm={() => run('cancelled', 'Consultation cancelled')} />
            </>
          )}
          {isClient && (c.status === 'requested' || c.status === 'booked') && (
            <ConfirmButton label="Cancel request" icon={<X />} title="Cancel this consultation request?" body="The lawyer will be notified. Client cancellation is not refundable, except where required by applicable law. Check payment history for any pending payment." onConfirm={() => run('cancelled', 'Request cancelled')} />
          )}
        </div>
      </div>
      {(c.status === 'requested' || c.status === 'booked') && (
        <p className="mt-5 flex items-start gap-2 border-t border-white/10 pt-4 text-[13px] text-white/65">
          <Info className="mt-0.5 h-4 w-4 shrink-0 text-haldi" />
          {c.status === 'requested'
            ? `Saved request. Payment: ${c.paymentStatus.replace('_', ' ')}. The advocate still needs to accept.`
            : `Accepted by the advocate. Payment: ${c.paymentStatus.replace('_', ' ')}.`}
          {c.demo && ' This is a demo consultation with an illustrative profile; no real advice will be given.'}
        </p>
      )}
    </section>
  );
}

function ConfirmButton({ label, icon, title, body, onConfirm }: { label: string; icon: React.ReactNode; title: string; body: string; onConfirm: () => void }) {
  return (
    <AlertDialog>
      <AlertDialogTrigger asChild>
        <Button variant="outline" className="rounded-full border-white/25 bg-transparent text-white hover:bg-white/10" data-testid={`button-${label.toLowerCase().replace(/\s/g, '-')}`}>{icon} {label}</Button>
      </AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle className="font-display">{title}</AlertDialogTitle>
          <AlertDialogDescription>{body}</AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Keep it</AlertDialogCancel>
          <AlertDialogAction onClick={onConfirm} className="bg-destructive text-destructive-foreground" data-testid="button-confirm">Yes, {label.toLowerCase()}</AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

function Messages({ c, asClient }: { c: Consultation; asClient: boolean }) {
  const qc = useQueryClient();
  const { toast } = useToast();
  const msgs = useListMessages(c.id, { query: { queryKey: getListMessagesQueryKey(c.id), refetchInterval: 4000 } });
  const send = useSendMessage();
  const [text, setText] = useState('');
  const endRef = useRef<HTMLDivElement>(null);
  const count = msgs.data?.length ?? 0;
  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }, [count]);
  const closed = c.status === 'cancelled';
  const mine = asClient ? 'client' : 'lawyer';

  const submit = () => {
    const content = text.trim();
    if (!content) return;
    send.mutate(
      { id: c.id, data: { content } },
      {
        onSuccess: () => {
          setText('');
          qc.invalidateQueries({ queryKey: getListMessagesQueryKey(c.id) });
        },
        onError: (e) => toast({ title: 'Message not sent', description: errMsg(e), variant: 'destructive' }),
      },
    );
  };

  return (
    <section className="flex h-[620px] flex-col overflow-hidden rounded-3xl border bg-card">
      <div className="flex items-center justify-between border-b px-5 py-3.5">
        <h2 className="font-display text-lg font-semibold">Conversation</h2>
        <span className="flex items-center gap-1.5 font-mono text-[10px] uppercase tracking-widest text-muted-foreground">
          <span className="live-dot h-1.5 w-1.5 rounded-full bg-[hsl(152_55%_40%)]" /> refreshes every 4s
        </span>
      </div>
      <div className="flex-1 space-y-3 overflow-y-auto bg-[hsl(var(--muted)/0.45)] px-4 py-5">
        {msgs.isLoading ? (
          <div className="space-y-3"><Skeleton className="h-12 w-2/3" /><Skeleton className="ml-auto h-12 w-1/2" /></div>
        ) : msgs.isError ? (
          <ErrorState error={msgs.error} onRetry={() => msgs.refetch()} />
        ) : count === 0 ? (
          <div className="grid h-full place-items-center text-center text-sm text-muted-foreground">
            <div className="max-w-xs">
              <p className="font-display text-lg text-foreground">No messages yet</p>
              <p className="mt-1">{c.demo ? 'Demo profiles do not reply. Messages you send are saved.' : 'Messages are saved and visible to both of you.'}</p>
            </div>
          </div>
        ) : (
          (msgs.data ?? []).map((m) =>
            m.sender === 'system' ? (
              <div key={m.id} className="mx-auto max-w-sm rounded-full bg-background px-3 py-1 text-center text-[11.5px] text-muted-foreground">{m.content}</div>
            ) : (
              <div key={m.id} className={cn('flex flex-col', m.sender === mine ? 'items-end' : 'items-start')} data-testid={`message-${m.id}`}>
                <div className={cn('max-w-[82%] whitespace-pre-wrap rounded-2xl px-4 py-2.5 text-[14.5px] leading-relaxed', m.sender === mine ? 'rounded-br-md bg-primary text-primary-foreground' : 'rounded-bl-md border bg-card')}>
                  {m.content}
                </div>
                <span className="mt-1 px-1 text-[10.5px] text-muted-foreground">{m.senderName} · {fmtTime(m.createdAt)}</span>
              </div>
            ),
          )
        )}
        <div ref={endRef} />
      </div>
      <form onSubmit={(e) => { e.preventDefault(); submit(); }} className="flex items-end gap-2 border-t p-3">
        <Textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); submit(); } }}
          disabled={closed || send.isPending}
          maxLength={5000}
          rows={1}
          placeholder={closed ? 'This consultation is cancelled' : 'Write a message. Enter to send, Shift+Enter for a new line'}
          className="max-h-32 min-h-[44px] resize-none rounded-2xl"
          data-testid="input-message"
        />
        <Button type="submit" size="icon" className="h-11 w-11 shrink-0 rounded-full" disabled={closed || !text.trim() || send.isPending} data-testid="button-send">
          {send.isPending ? <Loader2 className="animate-spin" /> : <Send />}
        </Button>
      </form>
    </section>
  );
}

function Transcript({ c, asClient }: { c: Consultation; asClient: boolean }) {
  const qc = useQueryClient();
  const { toast } = useToast();
  const m = useUpdateConsultation();
  const [val, setVal] = useState(c.transcript);
  const [editing, setEditing] = useState(false);
  if (asClient && !c.transcript) return null;
  const save = () =>
    m.mutate(
      { id: c.id, data: { transcript: val } },
      {
        onSuccess: (u) => {
          qc.setQueryData(getGetConsultationQueryKey(c.id), u);
          setEditing(false);
          toast({ title: 'Transcript saved' });
        },
        onError: (e) => toast({ title: 'Could not save', description: errMsg(e), variant: 'destructive' }),
      },
    );
  return (
    <section className="rounded-3xl border bg-card p-5">
      <div className="flex items-center justify-between">
        <h3 className="font-display text-lg font-semibold">Transcript &amp; notes</h3>
        {!asClient && !editing && <Button size="sm" variant="ghost" onClick={() => { setVal(c.transcript); setEditing(true); }} data-testid="button-edit-transcript"><Pencil /> Edit</Button>}
      </div>
      {editing ? (
        <div className="mt-3 space-y-2">
          <Textarea value={val} onChange={(e) => setVal(e.target.value)} rows={8} maxLength={100000} placeholder="Summary of what was discussed, facts, next steps." data-testid="input-transcript" />
          <div className="flex justify-end gap-2">
            <Button size="sm" variant="outline" onClick={() => setEditing(false)}>Cancel</Button>
            <Button size="sm" onClick={save} disabled={m.isPending} data-testid="button-save-transcript">{m.isPending ? <Loader2 className="animate-spin" /> : <Save />} Save</Button>
          </div>
        </div>
      ) : c.transcript ? (
        <p className="mt-2 max-h-60 overflow-y-auto whitespace-pre-line text-[14px] leading-relaxed text-foreground/85">{c.transcript}</p>
      ) : (
        <p className="mt-2 text-sm text-muted-foreground">No transcript yet. Add notes from the conversation; they can seed a document draft.</p>
      )}
    </section>
  );
}

function Deliverables({
  c,
  asClient,
  initialDraft,
  onDraftConsumed,
}: {
  c: Consultation;
  asClient: boolean;
  initialDraft: (CallTranscriptDraftResponse & { sessionId: string; version: number }) | null;
  onDraftConsumed: () => void;
}) {
  const q = useListDeliverables(c.id, { query: { queryKey: getListDeliverablesQueryKey(c.id) } });
  const [editing, setEditing] = useState<Deliverable | 'new' | null>(null);
  const [viewing, setViewing] = useState<Deliverable | null>(null);
  const { toast } = useToast();
  const items = (q.data ?? []).filter((d) => !asClient || d.status === 'delivered');
  useEffect(() => {
    if (initialDraft) setEditing('new');
  }, [initialDraft?.version]);
  if (asClient && c.package !== 'consultation_document' && items.length === 0) return null;
  return (
    <section className="rounded-3xl border bg-card p-5">
      <div className="flex items-center justify-between">
        <h3 className="font-display text-lg font-semibold">Documents for this consultation</h3>
        {!asClient && c.status !== 'cancelled' && <Button size="sm" variant="outline" onClick={() => setEditing('new')} data-testid="button-new-deliverable"><Plus /> Draft</Button>}
      </div>
      {q.isLoading ? (
        <Skeleton className="mt-3 h-16" />
      ) : q.isError ? (
        <ErrorState error={q.error} onRetry={() => q.refetch()} />
      ) : items.length === 0 ? (
        <p className="mt-2 text-sm text-muted-foreground">
          {asClient ? 'Your advocate has not published a document yet. You will be notified when they do.' : 'No drafts yet. Drafts stay private until you publish them.'}
        </p>
      ) : (
        <ul className="mt-3 space-y-2">
          {items.map((d) => (
            <li key={d.id} className="flex items-center gap-3 rounded-2xl border p-3" data-testid={`row-deliverable-${d.id}`}>
              <FileText className="h-5 w-5 text-primary" />
              <div className="min-w-0 flex-1">
                <div className="truncate font-medium">{d.title}</div>
                <div className="flex items-center gap-1 text-xs text-muted-foreground">
                  {d.status === 'draft' ? <><Lock className="h-3 w-3" /> Private draft</> : <><Check className="h-3 w-3" /> Delivered to client</>}
                </div>
              </div>
              <Button size="sm" variant="ghost" onClick={() => setViewing(d)}>View</Button>
              {!asClient && <Button size="sm" variant="ghost" onClick={() => setEditing(d)}><Pencil /></Button>}
            </li>
          ))}
        </ul>
      )}
      {!asClient && <p className="mt-3 text-[11.5px] text-muted-foreground">AI-assisted drafts must be reviewed by you before publishing. Clients only see delivered documents.</p>}
      {editing && <DeliverableEditor
        key={editing === 'new' ? `new-${initialDraft?.version ?? 'manual'}` : editing.id}
        c={c}
        item={editing === 'new' ? null : editing}
        initialDraft={editing === 'new' ? initialDraft : null}
        onClose={() => {
          setEditing(null);
          if (initialDraft) onDraftConsumed();
        }}
      />}
      <Dialog open={!!viewing} onOpenChange={(o) => !o && setViewing(null)}>
        <DialogContent className="max-h-[90dvh] max-w-3xl overflow-y-auto">
          <DialogHeader><DialogTitle className="font-display text-2xl">{viewing?.title}</DialogTitle></DialogHeader>
          <article className="prose prose-sm max-w-none prose-headings:font-display"><ReactMarkdown remarkPlugins={[remarkGfm]}>{viewing?.content ?? ''}</ReactMarkdown></article>
          <div className="flex gap-2">
            <Button variant="outline" size="sm" onClick={() => viewing && exportPdf(viewing.title, viewing.content).catch((e) => toast({ title: 'Export failed', description: errMsg(e), variant: 'destructive' }))}><Download /> PDF</Button>
            <Button variant="outline" size="sm" onClick={() => viewing && exportDocx(viewing.title, viewing.content).catch((e) => toast({ title: 'Export failed', description: errMsg(e), variant: 'destructive' }))}><Download /> Word</Button>
            <Button variant="outline" size="sm" onClick={() => viewing && exportMarkdown(viewing.title, viewing.content)}><Download /> Markdown</Button>
          </div>
        </DialogContent>
      </Dialog>
    </section>
  );
}

function DeliverableEditor({
  c,
  item,
  initialDraft,
  onClose,
}: {
  c: Consultation;
  item: Deliverable | null;
  initialDraft: CallTranscriptDraftResponse | null;
  onClose: () => void;
}) {
  const qc = useQueryClient();
  const { toast } = useToast();
  const platform = useGetPlatform();
  const create = useCreateDeliverable();
  const update = useUpdateDeliverable();
  const ai = useAssistWriting();
  const [title, setTitle] = useState(item?.title ?? initialDraft?.title ?? `${c.topic} - advice note`);
  const [content, setContent] = useState(item?.content ?? initialDraft?.content ?? '');
  const [reviewConfirmed, setReviewConfirmed] = useState(false);
  const [aiConsentOpen, setAiConsentOpen] = useState(false);
  const pending = create.isPending || update.isPending;

  const save = (status: DeliverableInputStatus) => {
    if (status === 'delivered' && !reviewConfirmed) return;
    const data = { title: title.trim() || 'Untitled', content, status, reviewConfirmed };
    const opts = {
      onSuccess: () => {
        qc.invalidateQueries({ queryKey: getListDeliverablesQueryKey(c.id) });
        toast({ title: status === 'delivered' ? 'Published to client' : 'Draft saved' });
        onClose();
      },
      onError: (e: unknown) => toast({ title: 'Could not save', description: errMsg(e), variant: 'destructive' }),
    };
    if (item) update.mutate({ id: item.id, data }, opts);
    else create.mutate({ id: c.id, data }, opts);
  };

  const openDraftConsent = () => {
    const source = [c.topic, c.notes, c.transcript].filter(Boolean).join('\n\n');
    if (!source.trim()) {
      toast({ title: 'Nothing to draft', description: 'Add consultation notes or transcript text first.' });
      return;
    }
    setAiConsentOpen(true);
  };

  const draftFromTranscript = () => {
    const source = [c.topic, c.notes, c.transcript].filter(Boolean).join('\n\n');
    if (!source.trim() || ai.isPending) return;
    setAiConsentOpen(false);
    ai.mutate(
      { data: { action: 'draft', text: source, language: 'English', dataUseAcknowledged: true } },
      { onSuccess: (r) => { setContent(r.text); setReviewConfirmed(false); }, onError: (e) => toast({ title: 'AI draft failed', description: errMsg(e), variant: 'destructive' }) },
    );
  };

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[92dvh] max-w-3xl overflow-y-auto">
        <DialogHeader><DialogTitle className="font-display text-2xl">{item ? 'Edit document' : 'New document draft'}</DialogTitle></DialogHeader>
        <Input value={title} onChange={(e) => { setTitle(e.target.value); setReviewConfirmed(false); }} maxLength={200} data-testid="input-deliverable-title" />
        <Textarea value={content} onChange={(e) => { setContent(e.target.value); setReviewConfirmed(false); }} rows={14} className="font-mono text-[13px]" placeholder="Markdown supported" data-testid="input-deliverable-content" />
        {platform.data?.draftingEnabled && (
          <>
          <Button variant="outline" size="sm" onClick={openDraftConsent} disabled={ai.isPending} className="self-start" data-testid="button-ai-draft">
            {ai.isPending ? <Loader2 className="animate-spin" /> : <Sparkles />} Draft from topic, notes and transcript
          </Button>
          </>
        )}
        <AiRequestConsentDialog
          open={aiConsentOpen}
          provider="DeepSeek"
          description="The consultation topic, notes, and transcript will be sent to DeepSeek to create a draft preview."
          testIdPrefix="consultation-deliverable-draft"
          onCancel={() => setAiConsentOpen(false)}
          onContinue={draftFromTranscript}
        />
        <Notice icon={<Info />}>Review every line before publishing. AI output can be wrong and is not legal advice on its own.</Notice>
        <label className="flex items-start gap-3 text-sm">
          <input type="checkbox" checked={reviewConfirmed} onChange={(e) => setReviewConfirmed(e.target.checked)} data-testid="checkbox-review-deliverable" />
          I reviewed this document and approve sharing it with the client.
        </label>
        <div className="flex flex-wrap justify-end gap-2">
          <Button variant="outline" onClick={() => save('draft')} disabled={pending} data-testid="button-save-draft"><Save /> Save draft</Button>
          <Button onClick={() => save('delivered')} disabled={pending || !content.trim() || !reviewConfirmed} data-testid="button-publish">{pending ? <Loader2 className="animate-spin" /> : <Send />} Publish to client</Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function ReviewBox({ c }: { c: Consultation }) {
  const qc = useQueryClient();
  const { toast } = useToast();
  const m = useCreateReview();
  const [rating, setRating] = useState(0);
  const [hover, setHover] = useState(0);
  const [comment, setComment] = useState('');
  const [done, setDone] = useState(false);
  if (done)
    return <section className="rounded-3xl border bg-haldi/15 p-5 text-center"><p className="font-display text-lg">Thank you for your review.</p><p className="text-sm text-muted-foreground">It helps others choose with confidence.</p></section>;
  const submit = () =>
    m.mutate(
      { id: c.id, data: { rating, comment: comment.trim() } },
      {
        onSuccess: () => {
          qc.invalidateQueries({ queryKey: getListLawyerReviewsQueryKey(c.lawyerId) });
          qc.invalidateQueries({ queryKey: getGetLawyerQueryKey(c.lawyerId) });
          setDone(true);
        },
        onError: (e) => toast({ title: 'Review not saved', description: errMsg(e), variant: 'destructive' }),
      },
    );
  return (
    <section className="rounded-3xl border bg-card p-5">
      <h3 className="font-display text-lg font-semibold">How was your consultation?</h3>
      {c.demo && <p className="mt-1 text-xs text-muted-foreground">Demo consultation: your review is stored for illustration.</p>}
      <div className="mt-3 flex gap-1" onMouseLeave={() => setHover(0)}>
        {[1, 2, 3, 4, 5].map((i) => (
          <button key={i} type="button" onMouseEnter={() => setHover(i)} onClick={() => setRating(i)} className="transition-transform hover:scale-110" data-testid={`button-star-${i}`}>
            <Star className={cn('h-8 w-8', (hover || rating) >= i ? 'fill-haldi text-haldi' : 'text-border')} />
          </button>
        ))}
      </div>
      <Textarea value={comment} onChange={(e) => setComment(e.target.value)} maxLength={2000} rows={3} className="mt-3" placeholder="What helped? What could be clearer?" data-testid="input-review" />
      <Button className="mt-3" onClick={submit} disabled={!rating || m.isPending} data-testid="button-submit-review">{m.isPending && <Loader2 className="animate-spin" />} Submit review</Button>
    </section>
  );
}
