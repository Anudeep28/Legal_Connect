import { useEffect, useRef, useState } from 'react';
import { useLocation, useParams } from 'wouter';
import { useQueryClient } from '@tanstack/react-query';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import {
  ArrowLeft, Save, Loader2, Download, Copy, Trash2, Sparkles, Wand2, Languages, Mic, Square, Info, Pause, Play, Undo2, LayoutTemplate, Eye, PenLine, Columns2,
} from 'lucide-react';
import {
  useGetDocument, getGetDocumentQueryKey, useUpdateDocument, useDuplicateDocument, useDeleteDocument, getListDocumentsQueryKey,
  useAssistWriting, useTranscribeAudio, useGetPlatform,
  type Document, type WritingInputAction, type AudioInputMimeType,
} from '@workspace/api-client-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { Skeleton } from '@/components/ui/skeleton';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Guard } from '@/components/guard';
import { AppPage } from '@/components/shell';
import { ErrorState, Notice } from '@/components/kit';
import { useToast } from '@/hooks/use-toast';
import { cn } from '@/lib/utils';
import { errMsg, fillTemplate, relTime } from '@/lib/format';
import { exportDocx, exportMarkdown, exportPdf } from '@/lib/export';
import { ensureDocumentFont, getDocumentFontFamily, isRtl } from '@/lib/document-fonts';

export default function DocumentEditor() {
  const { id = '' } = useParams<{ id: string }>();
  return (
    <AppPage wide>
      <Guard roles={['lawyer', 'admin']}>{() => <Loader id={id} />}</Guard>
    </AppPage>
  );
}

function Loader({ id }: { id: string }) {
  const q = useGetDocument(id, { query: { enabled: !!id, queryKey: getGetDocumentQueryKey(id) } });
  if (q.isLoading) return <div className="space-y-4"><Skeleton className="h-12 w-1/2" /><Skeleton className="h-[60vh] rounded-3xl" /></div>;
  if (q.isError || !q.data) return <ErrorState error={q.error} onRetry={() => q.refetch()} title="Document not found" />;
  return <Editor key={q.data.id} doc={q.data} />;
}

const MIME_CANDIDATES: AudioInputMimeType[] = ['audio/webm', 'audio/mp4', 'audio/ogg', 'audio/wav'];

function Editor({ doc }: { doc: Document }) {
  const qc = useQueryClient();
  const { toast } = useToast();
  const [, setLocation] = useLocation();
  const platform = useGetPlatform();
  const update = useUpdateDocument();
  const dup = useDuplicateDocument();
  const del = useDeleteDocument();
  const ai = useAssistWriting();
  const transcribe = useTranscribeAudio();

  const [title, setTitle] = useState(doc.title);
  const [content, setContent] = useState(doc.content);
  const [language, setLanguage] = useState(doc.language || 'English');
  const [saved, setSaved] = useState({ title: doc.title, content: doc.content, language: doc.language || 'English', at: doc.updatedAt });
  const [view, setView] = useState<'edit' | 'split' | 'preview'>('split');
  const [aiResult, setAiResult] = useState<{ action: WritingInputAction; text: string } | null>(null);
  const [targetLang, setTargetLang] = useState('Hindi');
  const [leaveTo, setLeaveTo] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [tplOpen, setTplOpen] = useState(false);
  const [tplValues, setTplValues] = useState<Record<string, string>>({});

  const [recording, setRecording] = useState(false);
  const [paused, setPaused] = useState(false);
  const [lastDictation, setLastDictation] = useState<{ before: string; after: string } | null>(null);
  const discardRef = useRef(false);
  const streamRef = useRef<MediaStream | null>(null);
  const [seconds, setSeconds] = useState(0);
  const recRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const timerRef = useRef<number | null>(null);

  const dirty = title !== saved.title || content !== saved.content || language !== saved.language;
  const template = platform.data?.templates.find((t) => t.id === doc.templateId);
  const languages = platform.data?.languages ?? ['English', 'Hindi'];
  const draftingEnabled = platform.data?.draftingEnabled ?? false;
  const dictationEnabled = platform.data?.dictationEnabled ?? false;

  useEffect(() => {
    const h = (e: BeforeUnloadEvent) => {
      if (dirty) {
        e.preventDefault();
        e.returnValue = '';
      }
    };
    window.addEventListener('beforeunload', h);
    return () => window.removeEventListener('beforeunload', h);
  }, [dirty]);

  useEffect(() => { ensureDocumentFont(language); }, [language]);
  const docFont = getDocumentFontFamily(language);
  const rtl = isRtl(language);

  // On navigation/unmount: discard any in-flight recording, stop the stream and clear timers.
  useEffect(() => () => {
    discardRef.current = true;
    if (timerRef.current) window.clearInterval(timerRef.current);
    timerRef.current = null;
    const rec = recRef.current;
    recRef.current = null;
    if (rec && rec.state !== 'inactive') {
      try { rec.stop(); } catch { /* already stopped */ }
    }
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
  }, []);

  const startTimer = () => {
    if (timerRef.current) window.clearInterval(timerRef.current);
    timerRef.current = window.setInterval(() => setSeconds((s) => s + 1), 1000);
  };
  const stopTimer = () => {
    if (timerRef.current) window.clearInterval(timerRef.current);
    timerRef.current = null;
  };

  const save = () =>
    update.mutate(
      { id: doc.id, data: { title: title.trim() || 'Untitled document', content, language, templateId: doc.templateId || undefined, category: doc.category || undefined } },
      {
        onSuccess: (d) => {
          setSaved({ title: d.title, content: d.content, language: d.language, at: d.updatedAt });
          setTitle(d.title);
          qc.setQueryData(getGetDocumentQueryKey(doc.id), d);
          qc.invalidateQueries({ queryKey: getListDocumentsQueryKey() });
          toast({ title: 'Saved' });
        },
        onError: (e) => toast({ title: 'Save failed', description: errMsg(e), variant: 'destructive' }),
      },
    );

  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 's') {
        e.preventDefault();
        if (dirty) saveRef.current();
      }
    };
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, [dirty]);
  const saveRef = useRef(save);
  saveRef.current = save;

  const navigate = (to: string) => (dirty ? setLeaveTo(to) : setLocation(to));

  const runAi = (action: WritingInputAction) => {
    const text = action === 'draft' ? content || title : content;
    if (!text.trim()) {
      toast({ title: 'Nothing to work with', description: 'Write or dictate a few lines first.' });
      return;
    }
    ai.mutate(
      { data: { action, text: text.slice(0, 30000), language: action === 'translate' ? targetLang : language } },
      { onSuccess: (r) => setAiResult({ action, text: r.text }), onError: (e) => toast({ title: 'AI request failed', description: errMsg(e), variant: 'destructive' }) },
    );
  };

  const startRec = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      if (discardRef.current) { stream.getTracks().forEach((t) => t.stop()); return; }
      streamRef.current = stream;
      const mime = MIME_CANDIDATES.find((m) => typeof MediaRecorder !== 'undefined' && MediaRecorder.isTypeSupported(m)) ?? 'audio/webm';
      const rec = new MediaRecorder(stream, { mimeType: mime });
      chunksRef.current = [];
      rec.ondataavailable = (e) => e.data.size && chunksRef.current.push(e.data);
      rec.onstop = () => {
        stream.getTracks().forEach((t) => t.stop());
        if (streamRef.current === stream) streamRef.current = null;
        if (discardRef.current) return;
        const blob = new Blob(chunksRef.current, { type: mime });
        const reader = new FileReader();
        reader.onloadend = () => {
          if (discardRef.current) return;
          const b64 = String(reader.result).split(',')[1] ?? '';
          transcribe.mutate(
            { data: { audio: b64, mimeType: mime, language } },
            {
              onSuccess: (r) => {
                if (discardRef.current) return;
                setContent((c) => {
                  const next = c ? `${c.trimEnd()}\n\n${r.text}` : r.text;
                  setLastDictation({ before: c, after: next });
                  return next;
                });
                toast({ title: 'Dictation added', description: 'Review the transcribed text for accuracy.' });
              },
              onError: (e) => toast({ title: 'Transcription failed', description: errMsg(e), variant: 'destructive' }),
            },
          );
        };
        reader.readAsDataURL(blob);
      };
      rec.start();
      recRef.current = rec;
      setRecording(true);
      setPaused(false);
      setSeconds(0);
      startTimer();
    } catch {
      toast({ title: 'Microphone unavailable', description: 'Allow microphone access in your browser to dictate.', variant: 'destructive' });
    }
  };
  const stopRec = () => {
    const rec = recRef.current;
    if (rec && rec.state !== 'inactive') rec.stop();
    recRef.current = null;
    setRecording(false);
    setPaused(false);
    stopTimer();
  };
  const togglePause = () => {
    const rec = recRef.current;
    if (!rec) return;
    if (rec.state === 'recording') { rec.pause(); setPaused(true); stopTimer(); }
    else if (rec.state === 'paused') { rec.resume(); setPaused(false); startTimer(); }
  };
  // Undo only the last transcription; keeps any edits made around it where possible.
  const undoDictation = () => {
    if (!lastDictation) return;
    const { before, after } = lastDictation;
    if (content === after) setContent(before);
    else {
      const inserted = after.slice(before.trimEnd().length);
      const idx = content.lastIndexOf(inserted);
      if (inserted && idx >= 0) setContent(content.slice(0, idx) + content.slice(idx + inserted.length));
      else { toast({ title: 'Could not undo', description: 'The dictated text has since been edited. Remove it manually.' }); return; }
    }
    setLastDictation(null);
    toast({ title: 'Last dictation removed' });
  };

  return (
    <div>
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <button onClick={() => navigate('/documents')} className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-primary" data-testid="button-back-documents"><ArrowLeft className="h-4 w-4" /> Documents</button>
        <span className="ml-auto flex items-center gap-2 font-mono text-[11px] uppercase tracking-widest" data-testid="status-save">
          <span className={cn('h-2 w-2 rounded-full', dirty ? 'bg-haldi' : 'bg-[hsl(152_55%_40%)]')} />
          {dirty ? 'Unsaved changes' : `Saved ${relTime(saved.at)}`}
        </span>
      </div>

      <div className="sticky top-16 z-20 -mx-4 mb-4 flex flex-col gap-3 border-y bg-background/90 px-4 py-3 backdrop-blur md:mx-0 md:rounded-2xl md:border lg:flex-row lg:items-center">
        <Input value={title} onChange={(e) => setTitle(e.target.value)} maxLength={200} className="h-11 border-0 bg-transparent px-1 font-display text-xl font-semibold shadow-none focus-visible:ring-0 lg:max-w-md" data-testid="input-doc-title" />
        <div className="flex flex-wrap items-center gap-1.5 lg:ml-auto">
          <div className="flex rounded-full border p-0.5">
            {([['edit', PenLine], ['split', Columns2], ['preview', Eye]] as const).map(([v, Icon]) => (
              <button key={v} onClick={() => setView(v)} className={cn('rounded-full px-2.5 py-1.5', view === v ? 'bg-primary text-primary-foreground' : 'text-muted-foreground')} title={v} data-testid={`button-view-${v}`}><Icon className="h-4 w-4" /></button>
            ))}
          </div>
          <Select value={language} onValueChange={setLanguage}>
            <SelectTrigger className="h-9 w-[130px] rounded-full" data-testid="select-doc-language"><SelectValue /></SelectTrigger>
            <SelectContent>{languages.map((l) => <SelectItem key={l} value={l}>{l}</SelectItem>)}</SelectContent>
          </Select>
          {recording ? (
            <div className="flex items-center gap-1">
              <Button variant="outline" size="sm" className="rounded-full" onClick={togglePause} title={paused ? 'Resume dictation' : 'Pause dictation'} data-testid="button-pause-recording">
                {paused ? <Play /> : <Pause />} {paused ? 'Resume' : 'Pause'}
              </Button>
              <Button variant="destructive" size="sm" className="rounded-full" onClick={stopRec} title="Stop and transcribe" data-testid="button-stop-recording">
                <span className={cn('h-2 w-2 rounded-full bg-white', !paused && 'rec-blink')} /> {Math.floor(seconds / 60)}:{String(seconds % 60).padStart(2, '0')} <Square />
              </Button>
            </div>
          ) : (
              <Button variant="outline" size="sm" className="rounded-full" onClick={startRec} disabled={transcribe.isPending || !dictationEnabled} title={dictationEnabled ? 'Dictate' : 'ElevenLabs dictation is not configured'} data-testid="button-record">
              {transcribe.isPending ? <Loader2 className="animate-spin" /> : <Mic />} {transcribe.isPending ? 'Transcribing' : 'Dictate'}
            </Button>
          )}
          {lastDictation && !recording && (
            <Button variant="ghost" size="sm" className="rounded-full" onClick={undoDictation} title="Remove the last transcribed passage" data-testid="button-undo-dictation"><Undo2 /> Undo dictation</Button>
          )}
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="outline" size="sm" className="rounded-full" disabled={ai.isPending || !draftingEnabled} data-testid="button-ai-menu">
                {ai.isPending ? <Loader2 className="animate-spin" /> : <Sparkles />} AI assist
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-64">
              <DropdownMenuItem onClick={() => runAi('draft')}><Sparkles className="h-4 w-4" /> Draft a formal document from notes</DropdownMenuItem>
              <DropdownMenuItem onClick={() => runAi('improve')}><Wand2 className="h-4 w-4" /> Improve wording and structure</DropdownMenuItem>
              <div className="flex items-center gap-2 px-2 py-1.5">
                <Select value={targetLang} onValueChange={setTargetLang}>
                  <SelectTrigger className="h-8 flex-1"><SelectValue /></SelectTrigger>
                  <SelectContent>{languages.map((l) => <SelectItem key={l} value={l}>{l}</SelectItem>)}</SelectContent>
                </Select>
                <Button size="sm" variant="secondary" onClick={() => runAi('translate')} data-testid="button-ai-translate"><Languages /> Translate</Button>
              </div>
            </DropdownMenuContent>
          </DropdownMenu>
          {template && template.fields.length > 0 && (
            <Button variant="outline" size="sm" className="rounded-full" onClick={() => setTplOpen(true)} data-testid="button-fill-template"><LayoutTemplate /> Fill fields</Button>
          )}
          <DropdownMenu>
            <DropdownMenuTrigger asChild><Button variant="outline" size="sm" className="rounded-full" data-testid="button-export"><Download /> Export</Button></DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem onClick={() => exportPdf(title, content, language).catch((e) => toast({ title: 'Export failed', description: errMsg(e), variant: 'destructive' }))}>PDF</DropdownMenuItem>
              <DropdownMenuItem onClick={() => exportDocx(title, content, language).catch((e) => toast({ title: 'Export failed', description: errMsg(e), variant: 'destructive' }))}>Word (DOCX)</DropdownMenuItem>
              <DropdownMenuItem onClick={() => exportMarkdown(title, content)}>Markdown</DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
          <Button variant="ghost" size="icon" title="Duplicate" onClick={() => dup.mutate({ id: doc.id }, { onSuccess: (d) => { qc.invalidateQueries({ queryKey: getListDocumentsQueryKey() }); toast({ title: 'Duplicated (saved version)' }); navigate(`/documents/${d.id}`); }, onError: (e) => toast({ title: 'Could not duplicate', description: errMsg(e), variant: 'destructive' }) })} data-testid="button-duplicate"><Copy /></Button>
          <Button variant="ghost" size="icon" title="Delete" onClick={() => setConfirmDelete(true)} data-testid="button-delete"><Trash2 /></Button>
          <Button size="sm" className="rounded-full" onClick={save} disabled={!dirty || update.isPending} data-testid="button-save">
            {update.isPending ? <Loader2 className="animate-spin" /> : <Save />} Save
          </Button>
        </div>
      </div>

      {platform.data && (!draftingEnabled || !dictationEnabled) && (
        <Notice icon={<Info />} tone="ink" className="mb-4">
          {!draftingEnabled && !dictationEnabled
            ? 'DeepSeek drafting and ElevenLabs dictation are not both configured on this server. Editing, templates and exports work as usual.'
            : !draftingEnabled
              ? 'DeepSeek drafting is not configured on this server. Dictation remains available.'
              : 'ElevenLabs dictation is not configured on this server. DeepSeek drafting remains available.'}
        </Notice>
      )}

      <div className={cn('grid gap-4', view === 'split' && 'lg:grid-cols-2')}>
        {view !== 'preview' && (
          <Textarea
            value={content}
            onChange={(e) => setContent(e.target.value)}
            maxLength={100000}
            placeholder={'# Title\n\nWrite in Markdown, or press Dictate to speak.'}
            dir={rtl ? 'rtl' : 'ltr'}
            style={language.toLowerCase() === 'english' ? undefined : { fontFamily: docFont }}
            className="min-h-[65vh] resize-none rounded-3xl border bg-card p-6 font-mono text-[13.5px] leading-relaxed"
            data-testid="input-doc-content"
          />
        )}
        {view !== 'edit' && (
          <div className="min-h-[65vh] overflow-y-auto rounded-3xl border bg-[hsl(42_60%_99%)] p-8 shadow-inner md:p-12">
            <article dir={rtl ? 'rtl' : 'ltr'} style={{ fontFamily: docFont }} className={cn('prose max-w-none font-serif', language.toLowerCase() === 'english' && 'prose-headings:font-display')} data-testid="preview-doc">
              {content.trim() ? <ReactMarkdown remarkPlugins={[remarkGfm]}>{content}</ReactMarkdown> : <p className="text-muted-foreground">Preview appears here.</p>}
            </article>
          </div>
        )}
      </div>
      <p className="mt-3 text-[12px] text-muted-foreground">Keyboard: Ctrl/Cmd + S to save. AI output and transcriptions are assistive and must be reviewed by a qualified advocate.</p>

      <Dialog open={!!aiResult} onOpenChange={(o) => !o && setAiResult(null)}>
        <DialogContent className="max-h-[90dvh] max-w-3xl overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="font-display text-2xl">{aiResult?.action === 'translate' ? `Translation (${targetLang})` : aiResult?.action === 'improve' ? 'Suggested improvement' : 'AI draft'}</DialogTitle>
            <DialogDescription>Review carefully. Nothing changes in your document until you choose.</DialogDescription>
          </DialogHeader>
          <div className="max-h-[50vh] overflow-y-auto rounded-2xl border bg-[hsl(42_60%_99%)] p-5"><article className="prose prose-sm max-w-none font-serif"><ReactMarkdown remarkPlugins={[remarkGfm]}>{aiResult?.text ?? ''}</ReactMarkdown></article></div>
          <div className="flex flex-wrap justify-end gap-2">
            <Button variant="outline" onClick={() => setAiResult(null)}>Discard</Button>
            <Button variant="outline" onClick={() => { if (aiResult) setContent((c) => `${c.trimEnd()}\n\n${aiResult.text}`); setAiResult(null); }} data-testid="button-ai-append">Append</Button>
            <Button onClick={() => { if (aiResult) { setContent(aiResult.text); if (aiResult.action === 'translate') setLanguage(targetLang); } setAiResult(null); }} data-testid="button-ai-replace">Replace content</Button>
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={tplOpen} onOpenChange={setTplOpen}>
        <DialogContent className="max-h-[90dvh] max-w-lg overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="font-display text-2xl">Fill template fields</DialogTitle>
            <DialogDescription>Values replace matching {'{{field}}'} placeholders still in the document.</DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            {template?.fields.map((f) => (
              <div key={f.id}>
                <Label className="text-[13px]">{f.name} {f.required && <span className="text-destructive">*</span>}</Label>
                <Input className="mt-1" type={f.type === 'date' ? 'date' : f.type === 'number' ? 'number' : 'text'} placeholder={f.placeholder} value={tplValues[f.id] ?? ''} onChange={(e) => setTplValues((v) => ({ ...v, [f.id]: e.target.value }))} />
              </div>
            ))}
          </div>
          <Button onClick={() => { setContent((c) => fillTemplate(c, tplValues)); setTplOpen(false); }} data-testid="button-apply-fields">Apply to document</Button>
        </DialogContent>
      </Dialog>

      <AlertDialog open={!!leaveTo} onOpenChange={(o) => !o && setLeaveTo(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle className="font-display">Leave without saving?</AlertDialogTitle>
            <AlertDialogDescription>You have unsaved changes in this document. They will be lost.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Stay</AlertDialogCancel>
            <AlertDialogAction className="bg-destructive text-destructive-foreground" onClick={() => leaveTo && setLocation(leaveTo)} data-testid="button-discard-leave">Discard and leave</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={confirmDelete} onOpenChange={setConfirmDelete}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle className="font-display">Delete this document?</AlertDialogTitle>
            <AlertDialogDescription>This cannot be undone.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Keep</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground"
              onClick={() => del.mutate({ id: doc.id }, { onSuccess: () => { qc.invalidateQueries({ queryKey: getListDocumentsQueryKey() }); setLocation('/documents'); }, onError: (e) => toast({ title: 'Could not delete', description: errMsg(e), variant: 'destructive' }) })}
              data-testid="button-confirm-delete"
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
