import { useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { ClipboardList, Download, FileText, Loader2, Paperclip, Pencil, Save, Trash2, Upload } from 'lucide-react';
import {
  useUpdateConsultationBrief, getGetConsultationQueryKey,
  useListConsultationAttachments, getListConsultationAttachmentsQueryKey,
  requestConsultationAttachmentUpload, confirmConsultationAttachment, useDeleteConsultationAttachment,
  type Consultation, type ConsultationBriefInput, type AttachmentUploadInputContentType,
} from '@workspace/api-client-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { Skeleton } from '@/components/ui/skeleton';
import { useToast } from '@/hooks/use-toast';
import { errMsg } from '@/lib/format';

export const emptyBrief: Required<ConsultationBriefInput> = {
  whatHappened: '', location: '', keyDates: '', otherParty: '', desiredOutcome: '', questions: '', preferredLanguage: '',
};

const QUESTIONS: { key: keyof ConsultationBriefInput; label: string; hint: string; rows?: number; max: number }[] = [
  { key: 'whatHappened', label: 'What happened?', hint: 'In your own words, in any language. Facts, not conclusions.', rows: 4, max: 5000 },
  { key: 'keyDates', label: 'Important dates', hint: 'e.g. 12 Mar 2026 – signed rent agreement; 1 Oct – moved out', rows: 2, max: 2000 },
  { key: 'location', label: 'Where did this happen?', hint: 'City, district or police station', max: 300 },
  { key: 'otherParty', label: 'Who is on the other side?', hint: 'Person, company or department (optional)', max: 300 },
  { key: 'desiredOutcome', label: 'What outcome do you want?', hint: 'e.g. refund of ₹40,000 deposit', rows: 2, max: 2000 },
  { key: 'questions', label: 'Questions for the lawyer', hint: 'What you most want answered on the call', rows: 2, max: 2000 },
];

export function BriefFields({
  value, onChange, languages, idPrefix = 'brief',
}: {
  value: Required<ConsultationBriefInput>;
  onChange: (next: Required<ConsultationBriefInput>) => void;
  languages: string[];
  idPrefix?: string;
}) {
  return (
    <div className="space-y-3">
      {QUESTIONS.map((q, i) => (
        <div key={q.key}>
          <Label htmlFor={`${idPrefix}-${q.key}`} className="text-[13px]">
            <span className="mr-1.5 font-mono text-[11px] text-muted-foreground">{String(i + 1).padStart(2, '0')}</span>
            {q.label}{q.key === 'whatHappened' && <span className="text-destructive"> *</span>}
          </Label>
          {q.rows ? (
            <Textarea id={`${idPrefix}-${q.key}`} rows={q.rows} maxLength={q.max} placeholder={q.hint} className="mt-1"
              value={value[q.key]} onChange={(e) => onChange({ ...value, [q.key]: e.target.value })} data-testid={`input-${idPrefix}-${q.key}`} />
          ) : (
            <Input id={`${idPrefix}-${q.key}`} maxLength={q.max} placeholder={q.hint} className="mt-1"
              value={value[q.key]} onChange={(e) => onChange({ ...value, [q.key]: e.target.value })} data-testid={`input-${idPrefix}-${q.key}`} />
          )}
        </div>
      ))}
      <div>
        <Label htmlFor={`${idPrefix}-language`} className="text-[13px]">Language you are most comfortable in</Label>
        <select id={`${idPrefix}-language`} value={value.preferredLanguage} onChange={(e) => onChange({ ...value, preferredLanguage: e.target.value })}
          className="mt-1 w-full rounded-xl border bg-background px-3 py-2 text-sm" data-testid={`select-${idPrefix}-language`}>
          <option value="">No preference</option>
          {languages.map((l) => <option key={l} value={l}>{l}</option>)}
        </select>
      </div>
      <p className="text-[11.5px] text-muted-foreground">Do not include passwords, Aadhaar or bank numbers. Only you and your lawyer can see this brief.</p>
    </div>
  );
}

const ACCEPT: Record<string, AttachmentUploadInputContentType> = {
  'application/pdf': 'application/pdf',
  'image/jpeg': 'image/jpeg',
  'image/png': 'image/png',
  'image/webp': 'image/webp',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'text/plain': 'text/plain',
};
const MAX_BYTES = 10 * 1024 * 1024;

function fileSize(n: number) {
  return n >= 1024 * 1024 ? `${(n / 1024 / 1024).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`;
}

export function CaseBrief({ c, isClient, languages }: { c: Consultation; isClient: boolean; languages: string[] }) {
  const qc = useQueryClient();
  const { toast } = useToast();
  const open = c.status === 'requested' || c.status === 'booked';
  const canEdit = isClient && open;
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState<Required<ConsultationBriefInput>>(emptyBrief);
  const save = useUpdateConsultationBrief();
  const brief = c.brief;

  const startEdit = () => {
    setDraft({ ...emptyBrief, ...(brief ?? {}), whatHappened: brief?.whatHappened || c.notes || '' });
    setEditing(true);
  };
  const submit = () => save.mutate({ id: c.id, data: draft }, {
    onSuccess: (updated) => {
      qc.setQueryData(getGetConsultationQueryKey(c.id), updated);
      setEditing(false);
      toast({ title: 'Brief saved', description: 'Your lawyer can see the update.' });
    },
    onError: (e) => toast({ title: 'Brief not saved', description: errMsg(e), variant: 'destructive' }),
  });

  const rows: [string, string | undefined][] = brief ? [
    ['What happened', brief.whatHappened], ['Key dates', brief.keyDates], ['Where', brief.location],
    ['Other side', brief.otherParty], ['Wants', brief.desiredOutcome], ['Questions', brief.questions],
    ['Language', brief.preferredLanguage],
  ] : [];
  const filled = rows.filter(([, v]) => v);

  return (
    <section className="rounded-3xl border bg-card p-5" data-testid="case-brief">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="font-mono text-[10px] uppercase tracking-[0.2em] text-muted-foreground">Before the call</p>
          <h3 className="flex items-center gap-2 font-display text-lg font-semibold"><ClipboardList className="h-4 w-4 text-primary" /> Case brief</h3>
        </div>
        {canEdit && !editing && <Button size="sm" variant="ghost" onClick={startEdit} data-testid="button-edit-brief"><Pencil /> {brief ? 'Edit' : 'Add brief'}</Button>}
      </div>

      {editing ? (
        <div className="mt-3 space-y-3">
          <BriefFields value={draft} onChange={setDraft} languages={languages} idPrefix="edit-brief" />
          <div className="flex justify-end gap-2">
            <Button size="sm" variant="outline" onClick={() => setEditing(false)}>Cancel</Button>
            <Button size="sm" onClick={submit} disabled={save.isPending || !draft.whatHappened.trim()} data-testid="button-save-brief">
              {save.isPending ? <Loader2 className="animate-spin" /> : <Save />} Save brief
            </Button>
          </div>
        </div>
      ) : filled.length ? (
        <dl className="mt-3 divide-y">
          {filled.map(([k, v]) => (
            <div key={k} className="grid gap-1 py-2.5 sm:grid-cols-[110px_1fr]">
              <dt className="font-mono text-[10.5px] uppercase tracking-wider text-muted-foreground">{k}</dt>
              <dd className="whitespace-pre-line text-[14px] leading-relaxed">{v}</dd>
            </div>
          ))}
        </dl>
      ) : (
        <p className="mt-2 text-sm text-muted-foreground">
          {isClient ? (open ? 'Answer a few questions so your lawyer can prepare before the call.' : 'No brief was added.') : 'The client has not written a brief yet.'}
        </p>
      )}
      {c.notes && !editing && (!brief || brief.whatHappened !== c.notes) && (
        <div className="mt-3 rounded-2xl bg-muted/60 p-3">
          <p className="font-mono text-[10.5px] uppercase tracking-wider text-muted-foreground">Background note</p>
          <p className="mt-1 whitespace-pre-line text-[14px]">{c.notes}</p>
        </div>
      )}
      <Attachments c={c} canUpload={canEdit} />
    </section>
  );
}

function Attachments({ c, canUpload }: { c: Consultation; canUpload: boolean }) {
  const qc = useQueryClient();
  const { toast } = useToast();
  const inputRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState<string | null>(null);
  const q = useListConsultationAttachments(c.id, { query: { queryKey: getListConsultationAttachmentsQueryKey(c.id) } });
  const remove = useDeleteConsultationAttachment();
  const items = q.data ?? [];

  const upload = async (file: File) => {
    const contentType = ACCEPT[file.type];
    if (!contentType) { toast({ title: 'File type not supported', description: 'Use PDF, JPG, PNG, WebP, Word (.docx) or text files.', variant: 'destructive' }); return; }
    if (file.size > MAX_BYTES) { toast({ title: 'File too large', description: 'Each file can be up to 10 MB.', variant: 'destructive' }); return; }
    setUploading(file.name);
    try {
      const ticket = await requestConsultationAttachmentUpload(c.id, { name: file.name, size: file.size, contentType });
      const put = await fetch(ticket.uploadURL, { method: 'PUT', body: file, headers: { 'Content-Type': contentType } });
      if (!put.ok) throw new Error('The file could not be uploaded. Please try again.');
      await confirmConsultationAttachment(c.id, ticket.attachmentId);
      await qc.invalidateQueries({ queryKey: getListConsultationAttachmentsQueryKey(c.id) });
      toast({ title: 'File attached', description: 'Your lawyer can now open it.' });
    } catch (e) {
      toast({ title: 'Upload failed', description: errMsg(e), variant: 'destructive' });
    } finally {
      setUploading(null);
      if (inputRef.current) inputRef.current.value = '';
    }
  };

  if (!canUpload && !q.isLoading && items.length === 0) return null;
  return (
    <div className="mt-4 border-t pt-4">
      <div className="flex items-center justify-between">
        <p className="flex items-center gap-1.5 text-sm font-medium"><Paperclip className="h-4 w-4" /> Documents shared with the lawyer</p>
        {canUpload && (
          <>
            <input ref={inputRef} type="file" className="sr-only" accept={Object.keys(ACCEPT).join(',')} onChange={(e) => e.target.files?.[0] && void upload(e.target.files[0])} data-testid="input-attachment" aria-label="Attach a document" />
            <Button size="sm" variant="outline" disabled={!!uploading || items.length >= 10} onClick={() => inputRef.current?.click()} data-testid="button-attach">
              {uploading ? <Loader2 className="animate-spin" /> : <Upload />} Attach
            </Button>
          </>
        )}
      </div>
      {q.isLoading ? <Skeleton className="mt-2 h-10" /> : (
        <ul className="mt-2 space-y-1.5">
          {items.map((a) => (
            <li key={a.id} className="flex items-center gap-2 rounded-xl border px-3 py-2 text-sm" data-testid={`row-attachment-${a.id}`}>
              <FileText className="h-4 w-4 shrink-0 text-primary" />
              <span className="min-w-0 flex-1 truncate">{a.name}</span>
              <span className="text-xs text-muted-foreground">{fileSize(a.size)}</span>
              <Button asChild size="icon" variant="ghost" className="h-8 w-8"><a href={`${import.meta.env.BASE_URL}api/${a.downloadPath}`} target="_blank" rel="noreferrer" aria-label={`Open ${a.name}`}><Download /></a></Button>
              {canUpload && a.uploadedBy === 'client' && (
                <Button size="icon" variant="ghost" className="h-8 w-8" aria-label={`Remove ${a.name}`} disabled={remove.isPending}
                  onClick={() => remove.mutate({ id: c.id, attachmentId: a.id }, {
                    onSuccess: () => qc.invalidateQueries({ queryKey: getListConsultationAttachmentsQueryKey(c.id) }),
                    onError: (e) => toast({ title: 'Could not remove file', description: errMsg(e), variant: 'destructive' }),
                  })}><Trash2 /></Button>
              )}
            </li>
          ))}
          {uploading && <li className="flex items-center gap-2 rounded-xl border border-dashed px-3 py-2 text-sm text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" /> Uploading {uploading}…</li>}
          {!uploading && items.length === 0 && <li className="text-xs text-muted-foreground">PDF, photos, Word or text files, up to 10 MB each (max 10 files).</li>}
        </ul>
      )}
    </div>
  );
}
