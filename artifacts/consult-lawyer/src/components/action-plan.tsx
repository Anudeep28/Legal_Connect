import { useEffect, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { CalendarClock, Check, FilePlus2, Info, ListChecks, Loader2, Pencil, Plus, Save, Send, Sparkles, Trash2 } from 'lucide-react';
import {
  useGetActionPlan, getGetActionPlanQueryKey, useSaveActionPlan, useUpdateActionPlanStep, useDraftActionPlan,
  useCreateDeliverable, getListDeliverablesQueryKey, getListNotificationsQueryKey,
  type ActionPlan, type ActionPlanStepInput, type Consultation, type Template,
} from '@workspace/api-client-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Skeleton } from '@/components/ui/skeleton';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { AiRequestConsentDialog } from '@/components/ai-request-consent-dialog';
import { TemplateFiller } from '@/components/template-filler';
import { ErrorState, Notice } from '@/components/kit';
import { useToast } from '@/hooks/use-toast';
import { cn } from '@/lib/utils';
import { errMsg, fmtDateTime } from '@/lib/format';
import { prefillFromBrief } from '@/lib/brief-prefill';

type Props = { c: Consultation; asLawyer: boolean; isClient: boolean; templates: Template[]; languages: string[]; draftingEnabled: boolean };

function fmtDue(d: string | null | undefined) {
  if (!d) return null;
  return new Date(`${d}T12:00:00+05:30`).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'Asia/Kolkata' });
}

export function ActionPlanSection(props: Props) {
  const { c, asLawyer } = props;
  const q = useGetActionPlan(c.id, { query: { queryKey: getGetActionPlanQueryKey(c.id), refetchInterval: asLawyer ? false : 15000 } });
  const [editing, setEditing] = useState(false);
  const ready = c.status === 'booked' || c.status === 'completed';
  if (!ready && !q.data) return null;

  return (
    <section className="overflow-hidden rounded-3xl border bg-card" data-testid="action-plan">
      <div className="flex items-start justify-between gap-3 border-b bg-[hsl(var(--muted)/0.45)] px-5 py-4">
        <div>
          <p className="font-mono text-[10px] uppercase tracking-[0.2em] text-muted-foreground">After the call</p>
          <h3 className="flex items-center gap-2 font-display text-lg font-semibold"><ListChecks className="h-4 w-4 text-primary" /> Action plan</h3>
        </div>
        {q.data && (
          <span className={cn('rounded-full px-2.5 py-0.5 font-mono text-[10px] uppercase tracking-wider',
            q.data.status === 'published' ? 'bg-primary text-primary-foreground' : 'border text-muted-foreground')}>
            {q.data.status === 'published' ? 'Sent to client' : 'Private draft'}
          </span>
        )}
      </div>
      <div className="p-5">
        {q.isLoading ? <Skeleton className="h-24" /> : q.isError ? <ErrorState error={q.error} onRetry={() => q.refetch()} /> :
          asLawyer && (editing || !q.data || q.data.status === 'draft') && ready ? (
            <PlanEditor {...props} plan={q.data ?? null} onDone={() => setEditing(false)} onCancel={q.data?.status === 'published' ? () => setEditing(false) : undefined} />
          ) : q.data ? (
            <PlanView {...props} plan={q.data} onEdit={asLawyer && ready ? () => setEditing(true) : undefined} />
          ) : (
            <p className="text-sm text-muted-foreground">Your lawyer will send a short plan after the call: what it means, what to do next, and by when.</p>
          )}
      </div>
    </section>
  );
}

function PlanView({ c, plan, asLawyer, isClient, templates, onEdit }: Props & { plan: ActionPlan; onEdit?: () => void }) {
  const qc = useQueryClient();
  const { toast } = useToast();
  const toggle = useUpdateActionPlanStep();
  const [preparing, setPreparing] = useState<Template | null>(null);
  const done = plan.steps.filter((s) => s.done).length;
  const suggested = plan.templateIds.map((id) => templates.find((t) => t.id === id)).filter((t): t is Template => !!t);

  const setDone = (stepId: string, value: boolean) => toggle.mutate({ id: c.id, stepId, data: { done: value } }, {
    onSuccess: (updated) => qc.setQueryData(getGetActionPlanQueryKey(c.id), updated),
    onError: (e) => toast({ title: 'Could not update step', description: errMsg(e), variant: 'destructive' }),
  });

  return (
    <div className="space-y-5">
      <p className="whitespace-pre-line text-[15px] leading-relaxed" data-testid="text-plan-summary">{plan.summary}</p>

      <div>
        <div className="mb-2 flex items-center justify-between">
          <h4 className="text-sm font-semibold">Next steps</h4>
          <span className="font-mono text-[11px] text-muted-foreground">{done}/{plan.steps.length} done</span>
        </div>
        <div className="mb-3 h-1.5 overflow-hidden rounded-full bg-muted"><div className="h-full bg-primary transition-all" style={{ width: `${plan.steps.length ? (done / plan.steps.length) * 100 : 0}%` }} /></div>
        <ol className="space-y-2">
          {plan.steps.map((s, i) => {
            const canToggle = plan.status === 'published' && (asLawyer || (isClient && s.owner === 'client'));
            return (
              <li key={s.id} className={cn('flex items-start gap-3 rounded-2xl border p-3', s.done && 'bg-muted/50')} data-testid={`row-plan-step-${s.id}`}>
                <button type="button" disabled={!canToggle || toggle.isPending} onClick={() => setDone(s.id, !s.done)} aria-pressed={s.done}
                  aria-label={`Mark step ${i + 1} ${s.done ? 'not done' : 'done'}`}
                  className={cn('mt-0.5 grid h-5 w-5 shrink-0 place-items-center rounded-md border-2 transition-colors',
                    s.done ? 'border-primary bg-primary text-primary-foreground' : 'border-border', canToggle ? 'cursor-pointer hover:border-primary' : 'cursor-default opacity-70')}
                  data-testid={`checkbox-plan-step-${s.id}`}>
                  {s.done && <Check className="h-3.5 w-3.5" />}
                </button>
                <div className="min-w-0 flex-1">
                  <p className={cn('text-[14.5px] leading-snug', s.done && 'text-muted-foreground line-through')}>{s.text}</p>
                  <div className="mt-1 flex flex-wrap gap-x-3 gap-y-1 text-xs text-muted-foreground">
                    <span className={cn('rounded-full px-2 py-0.5 font-medium', s.owner === 'client' ? 'bg-haldi/25 text-foreground' : 'bg-primary/10 text-primary')}>
                      {s.owner === 'client' ? (isClient ? 'You' : 'Client') : (asLawyer ? 'You' : 'Lawyer')}
                    </span>
                    {s.dueDate && <span className="flex items-center gap-1"><CalendarClock className="h-3 w-3" /> by {fmtDue(s.dueDate)}</span>}
                  </div>
                </div>
              </li>
            );
          })}
        </ol>
      </div>

      {plan.documentsNeeded.length > 0 && (
        <div>
          <h4 className="mb-2 text-sm font-semibold">{isClient ? 'Documents to gather' : 'Documents the client should gather'}</h4>
          <ul className="grid gap-1.5 sm:grid-cols-2">
            {plan.documentsNeeded.map((d) => <li key={d} className="flex items-start gap-2 rounded-xl bg-muted/60 px-3 py-2 text-sm"><span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-haldi" />{d}</li>)}
          </ul>
        </div>
      )}

      {suggested.length > 0 && (
        <div>
          <h4 className="mb-2 text-sm font-semibold">{asLawyer ? 'Prepare from this plan' : 'Documents your lawyer may prepare'}</h4>
          <div className="flex flex-wrap gap-2">
            {suggested.map((t) => asLawyer ? (
              <Button key={t.id} size="sm" variant="outline" onClick={() => setPreparing(t)} data-testid={`button-prepare-${t.id}`}><FilePlus2 /> {t.name}</Button>
            ) : (
              <span key={t.id} className="rounded-full border px-3 py-1 text-sm">{t.name}</span>
            ))}
          </div>
          {asLawyer && <p className="mt-2 text-[11.5px] text-muted-foreground">Opens the template pre-filled from the client's brief. It is saved as a private draft for your review.</p>}
        </div>
      )}

      <div className="flex flex-wrap items-center justify-between gap-2 border-t pt-3 text-[11.5px] text-muted-foreground">
        <span>
          {plan.lawyerReviewedAt ? `Reviewed and sent by ${c.lawyerName} · ${fmtDateTime(plan.lawyerReviewedAt)} IST` : 'Not yet sent'}
          {plan.aiAssisted && ' · drafted with AI assistance'}
        </span>
        {onEdit && <Button size="sm" variant="ghost" onClick={onEdit} data-testid="button-edit-plan"><Pencil /> Update plan</Button>}
      </div>
      {isClient && <p className="text-[11.5px] text-muted-foreground">This plan reflects your lawyer's advice for this consultation. Ask them in the conversation if anything is unclear.</p>}
      {preparing && <PrepareDocument c={c} template={preparing} onClose={() => setPreparing(null)} />}
    </div>
  );
}

export function PrepareDocument({ c, template, onClose }: { c: Consultation; template: Template; onClose: () => void }) {
  const qc = useQueryClient();
  const { toast } = useToast();
  const create = useCreateDeliverable();
  const [initial] = useState(() => prefillFromBrief(template, c));
  const seeded = Object.keys(initial).length;
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[92dvh] max-w-5xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="font-display text-2xl">{template.name}</DialogTitle>
          <DialogDescription>{seeded ? `${seeded} field${seeded === 1 ? '' : 's'} pre-filled from the client's brief. Check every value.` : 'The brief had nothing to pre-fill for this template.'}</DialogDescription>
        </DialogHeader>
        <TemplateFiller template={template} initialValues={initial} pending={create.isPending} ctaLabel="Save as private draft"
          onCreate={(content) => create.mutate(
            { id: c.id, data: { title: `${c.topic} - ${template.name}`.slice(0, 200), content, status: 'draft', reviewConfirmed: false } },
            {
              onSuccess: () => {
                qc.invalidateQueries({ queryKey: getListDeliverablesQueryKey(c.id) });
                toast({ title: 'Draft saved', description: 'Find it under Documents for this consultation. Review it before publishing.' });
                onClose();
              },
              onError: (e) => toast({ title: 'Draft not saved', description: errMsg(e), variant: 'destructive' }),
            },
          )} />
      </DialogContent>
    </Dialog>
  );
}

type StepDraft = ActionPlanStepInput & { key: string };
let stepKey = 0;
const newStep = (s?: Partial<ActionPlanStepInput>): StepDraft => ({ key: `s${++stepKey}`, text: '', owner: 'client', dueDate: null, ...s });

function PlanEditor({ c, plan, templates, languages, draftingEnabled, onDone, onCancel }: Props & { plan: ActionPlan | null; onDone: () => void; onCancel?: () => void }) {
  const qc = useQueryClient();
  const { toast } = useToast();
  const save = useSaveActionPlan();
  const ai = useDraftActionPlan();
  const [summary, setSummary] = useState(plan?.summary ?? '');
  const [steps, setSteps] = useState<StepDraft[]>(() => plan?.steps.length ? plan.steps.map((s) => newStep(s)) : [newStep()]);
  const [docs, setDocs] = useState<string[]>(plan?.documentsNeeded ?? []);
  const [docInput, setDocInput] = useState('');
  const [templateIds, setTemplateIds] = useState<string[]>(plan?.templateIds ?? []);
  const [aiAssisted, setAiAssisted] = useState(false);
  const [notes, setNotes] = useState(c.transcript);
  const [language, setLanguage] = useState(c.brief?.preferredLanguage || 'English');
  const [consentOpen, setConsentOpen] = useState(false);
  const [reviewed, setReviewed] = useState(false);
  const aiButton = useRef<HTMLButtonElement>(null);
  const wasPublished = plan?.status === 'published';

  useEffect(() => { setReviewed(false); }, [summary, steps, docs, templateIds]);

  const runAi = () => {
    setConsentOpen(false);
    ai.mutate({ id: c.id, data: { notes: notes.trim(), language, dataUseAcknowledged: true } }, {
      onSuccess: (d) => {
        setSummary(d.summary);
        setSteps(d.steps.length ? d.steps.map((s) => newStep({ text: s.text, owner: s.owner, dueDate: s.dueDate })) : [newStep()]);
        setDocs(d.documentsNeeded);
        setTemplateIds(d.templateIds);
        setAiAssisted(true);
        toast({ title: 'Suggested plan ready', description: 'Edit anything that is not right before sending.' });
      },
      onError: (e) => toast({ title: 'AI suggestion failed', description: errMsg(e), variant: 'destructive' }),
    });
  };

  const submit = (status: 'draft' | 'published') => {
    const payload = {
      summary,
      steps: steps.filter((s) => s.text.trim()).map(({ key: _k, ...s }) => ({ ...s, dueDate: s.dueDate || null })),
      documentsNeeded: docs, templateIds, status, reviewConfirmed: status === 'published' && reviewed, aiAssisted,
    };
    save.mutate({ id: c.id, data: payload }, {
      onSuccess: (updated) => {
        qc.setQueryData(getGetActionPlanQueryKey(c.id), updated);
        qc.invalidateQueries({ queryKey: getListNotificationsQueryKey() });
        toast({ title: status === 'published' ? 'Plan sent to client' : 'Draft saved privately' });
        if (status === 'published') onDone();
      },
      onError: (e) => toast({ title: 'Plan not saved', description: errMsg(e), variant: 'destructive' }),
    });
  };

  const addDoc = () => {
    const v = docInput.trim();
    if (v && !docs.includes(v) && docs.length < 20) setDocs([...docs, v]);
    setDocInput('');
  };
  const canSend = reviewed && summary.trim() && steps.some((s) => s.text.trim());

  return (
    <div className="space-y-5">
      {draftingEnabled && (
        <div className="rounded-2xl border border-dashed p-4">
          <p className="flex items-center gap-1.5 text-sm font-medium"><Sparkles className="h-4 w-4 text-primary" /> Start from your notes</p>
          <Textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={4} maxLength={20000} className="mt-2 text-[13.5px]"
            placeholder="Your notes from the call: what you advised, what the client must do, deadlines you mentioned." data-testid="input-plan-notes" />
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <select value={language} onChange={(e) => setLanguage(e.target.value)} aria-label="Plan language" className="rounded-xl border bg-background px-3 py-2 text-sm" data-testid="select-plan-language">
              {languages.map((l) => <option key={l} value={l}>{l}</option>)}
            </select>
            <Button ref={aiButton} size="sm" variant="outline" disabled={!notes.trim() || ai.isPending} onClick={() => setConsentOpen(true)} data-testid="button-ai-plan">
              {ai.isPending ? <Loader2 className="animate-spin" /> : <Sparkles />} Suggest a plan
            </Button>
          </div>
          <p className="mt-2 text-[11.5px] text-muted-foreground">Uses your notes and the client's brief. The suggestion fills the form below and is never sent without your approval.</p>
          <AiRequestConsentDialog open={consentOpen} provider="DeepSeek" returnFocusRef={aiButton} testIdPrefix="action-plan"
            description="Your notes and the client's case brief will be sent to DeepSeek to suggest an action plan. Nothing is saved or shown to the client until you send it."
            onCancel={() => setConsentOpen(false)} onContinue={runAi} />
        </div>
      )}

      <div>
        <label htmlFor="plan-summary" className="text-sm font-semibold">Summary for the client</label>
        <Textarea id="plan-summary" value={summary} onChange={(e) => setSummary(e.target.value)} rows={4} maxLength={4000} className="mt-1"
          placeholder="In plain language: where things stand and what you advise." data-testid="input-plan-summary" />
      </div>

      <div>
        <p className="text-sm font-semibold">Next steps</p>
        <ol className="mt-2 space-y-2">
          {steps.map((s, i) => (
            <li key={s.key} className="rounded-2xl border p-3" data-testid={`row-edit-step-${i}`}>
              <div className="flex gap-2">
                <span className="mt-2 font-mono text-[11px] text-muted-foreground">{String(i + 1).padStart(2, '0')}</span>
                <Input value={s.text} maxLength={500} placeholder="What needs to happen" aria-label={`Step ${i + 1}`}
                  onChange={(e) => setSteps(steps.map((x) => x.key === s.key ? { ...x, text: e.target.value } : x))} data-testid={`input-step-text-${i}`} />
                <Button size="icon" variant="ghost" className="shrink-0" aria-label={`Remove step ${i + 1}`} disabled={steps.length === 1}
                  onClick={() => setSteps(steps.filter((x) => x.key !== s.key))}><Trash2 /></Button>
              </div>
              <div className="mt-2 flex flex-wrap gap-2 pl-6">
                <select value={s.owner} aria-label={`Who does step ${i + 1}`} onChange={(e) => setSteps(steps.map((x) => x.key === s.key ? { ...x, owner: e.target.value as 'client' | 'lawyer' } : x))}
                  className="rounded-xl border bg-background px-2.5 py-1.5 text-sm" data-testid={`select-step-owner-${i}`}>
                  <option value="client">Client does this</option>
                  <option value="lawyer">I do this</option>
                </select>
                <Input type="date" value={s.dueDate ?? ''} aria-label={`Due date for step ${i + 1}`} className="w-auto"
                  onChange={(e) => setSteps(steps.map((x) => x.key === s.key ? { ...x, dueDate: e.target.value || null } : x))} data-testid={`input-step-due-${i}`} />
              </div>
            </li>
          ))}
        </ol>
        <Button size="sm" variant="ghost" className="mt-2" disabled={steps.length >= 20} onClick={() => setSteps([...steps, newStep()])} data-testid="button-add-step"><Plus /> Add step</Button>
      </div>

      <div>
        <p className="text-sm font-semibold">Documents the client should gather</p>
        <div className="mt-2 flex flex-wrap gap-1.5">
          {docs.map((d) => (
            <span key={d} className="inline-flex items-center gap-1 rounded-full bg-muted px-3 py-1 text-sm">
              {d}<button type="button" aria-label={`Remove ${d}`} onClick={() => setDocs(docs.filter((x) => x !== d))} className="text-muted-foreground hover:text-destructive">×</button>
            </span>
          ))}
        </div>
        <form className="mt-2 flex gap-2" onSubmit={(e) => { e.preventDefault(); addDoc(); }}>
          <Input value={docInput} onChange={(e) => setDocInput(e.target.value)} maxLength={200} placeholder="e.g. Signed rent agreement" data-testid="input-plan-doc" />
          <Button type="submit" size="sm" variant="outline" disabled={!docInput.trim()}><Plus /> Add</Button>
        </form>
      </div>

      <div>
        <p className="text-sm font-semibold">Documents you may prepare <span className="font-normal text-muted-foreground">(up to 5)</span></p>
        <div className="mt-2 flex flex-wrap gap-1.5">
          {templates.map((t) => {
            const on = templateIds.includes(t.id);
            return (
              <button key={t.id} type="button" aria-pressed={on} disabled={!on && templateIds.length >= 5}
                onClick={() => setTemplateIds(on ? templateIds.filter((x) => x !== t.id) : [...templateIds, t.id])}
                className={cn('rounded-full border px-3 py-1 text-[13px] transition-colors disabled:opacity-40', on ? 'border-primary bg-primary text-primary-foreground' : 'hover:border-primary/50')}
                data-testid={`toggle-template-${t.id}`}>{t.name}</button>
            );
          })}
        </div>
      </div>

      <Notice icon={<Info />}>
        {aiAssisted ? 'This plan started from an AI suggestion. ' : ''}The client sees this exactly as written once you send it{wasPublished ? '; sending again updates their copy' : ''}. It should reflect your own advice.
      </Notice>
      <label className="flex items-start gap-3 text-sm">
        <input type="checkbox" checked={reviewed} onChange={(e) => setReviewed(e.target.checked)} className="mt-0.5" data-testid="checkbox-review-plan" />
        I reviewed every line of this plan and approve sending it to {c.clientName}.
      </label>
      <div className="flex flex-wrap justify-end gap-2">
        {onCancel && <Button variant="ghost" onClick={onCancel}>Cancel</Button>}
        {!wasPublished && <Button variant="outline" onClick={() => submit('draft')} disabled={save.isPending} data-testid="button-save-plan-draft"><Save /> Save draft</Button>}
        <Button onClick={() => submit('published')} disabled={save.isPending || !canSend} data-testid="button-send-plan">
          {save.isPending ? <Loader2 className="animate-spin" /> : <Send />} {wasPublished ? 'Send update' : 'Send to client'}
        </Button>
      </div>
    </div>
  );
}
