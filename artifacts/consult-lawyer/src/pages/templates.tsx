import { useMemo, useState } from 'react';
import { useLocation, useSearch } from 'wouter';
import { useQueryClient } from '@tanstack/react-query';
import { Search, FileText, ArrowLeft, Info } from 'lucide-react';
import { useGetPlatform, useCreateDocument, getListDocumentsQueryKey } from '@workspace/api-client-react';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { AppPage } from '@/components/shell';
import { EmptyState, ErrorState, Notice, PageHeader } from '@/components/kit';
import { TemplateFiller } from '@/components/template-filler';
import { useAccount } from '@/lib/account';
import { useToast } from '@/hooks/use-toast';
import { cn } from '@/lib/utils';
import { errMsg } from '@/lib/format';

export default function Templates() {
  const platform = useGetPlatform();
  const searchStr = useSearch();
  const [, setLocation] = useLocation();
  const selectedId = new URLSearchParams(searchStr).get('t');
  const [q, setQ] = useState('');
  const [cat, setCat] = useState('All');
  const { signedIn, me } = useAccount();
  const create = useCreateDocument();
  const qc = useQueryClient();
  const { toast } = useToast();

  const templates = platform.data?.templates ?? [];
  const cats = useMemo(() => ['All', ...Array.from(new Set(templates.map((t) => t.category)))], [templates]);
  const list = templates.filter((t) => (cat === 'All' || t.category === cat) && (t.name + t.description).toLowerCase().includes(q.toLowerCase()));
  const selected = templates.find((t) => t.id === selectedId);
  const canCreate = signedIn && me && me.role !== 'client';

  if (platform.isLoading) return <AppPage><Skeleton className="h-12 w-1/2" /><div className="mt-8 grid gap-3 md:grid-cols-3">{Array.from({ length: 6 }).map((_, i) => <Skeleton key={i} className="h-40 rounded-2xl" />)}</div></AppPage>;
  if (platform.isError) return <AppPage><ErrorState error={platform.error} onRetry={() => platform.refetch()} /></AppPage>;

  if (selected)
    return (
      <AppPage>
        <button onClick={() => setLocation('/templates')} className="mb-5 inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-primary"><ArrowLeft className="h-4 w-4" /> All templates</button>
        <PageHeader eyebrow={selected.category} title={selected.name} sub={selected.description} />
        <Notice icon={<Info />} className="mb-6">
          Templates are general formats. Have a qualified advocate review any filled document before you sign, send or file it.
        </Notice>
        <TemplateFiller
          template={selected}
          pending={create.isPending}
          ctaLabel="Create in my workspace"
          disabledReason={!signedIn ? 'Sign in with a lawyer account to save this as a document.' : !canCreate ? 'Saving documents is part of the lawyer workspace. You can still preview and fill this format here.' : undefined}
          onCreate={(content) =>
            create.mutate(
              { data: { title: selected.name, content, templateId: selected.id, category: selected.category, language: 'English' } },
              {
                onSuccess: (d) => {
                  qc.invalidateQueries({ queryKey: getListDocumentsQueryKey() });
                  setLocation(`/documents/${d.id}`);
                },
                onError: (e) => toast({ title: 'Could not create', description: errMsg(e), variant: 'destructive' }),
              },
            )
          }
        />
      </AppPage>
    );

  return (
    <AppPage wide>
      <PageHeader eyebrow="Template library" title={<>Indian legal formats, <span className="italic text-primary">ready to fill</span></>} sub="Preview any template and fill its fields. Advocates can save filled templates into their document workspace." />
      <div className="mb-6 flex flex-col gap-3 md:flex-row md:items-center">
        <div className="relative md:w-80">
          <Search className="absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search templates" className="h-11 rounded-full pl-10" data-testid="input-template-search" />
        </div>
        <div className="flex flex-wrap gap-1.5">
          {cats.map((c) => (
            <button key={c} onClick={() => setCat(c)} className={cn('rounded-full border px-3.5 py-1.5 text-[13px] transition-colors', cat === c ? 'border-primary bg-primary text-primary-foreground' : 'bg-card hover:border-primary/40')} data-testid={`button-cat-${c}`}>{c}</button>
          ))}
        </div>
      </div>
      {list.length === 0 ? (
        <EmptyState icon={<FileText />} title="No templates match" body="Try another word or category." />
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {list.map((t, i) => (
            <button key={t.id} onClick={() => setLocation(`/templates?t=${t.id}`)} className="lift rise rounded-2xl border bg-card p-5 text-left" style={{ animationDelay: `${i * 30}ms` }} data-testid={`card-template-${t.id}`}>
              <div className="flex items-start justify-between">
                <FileText className="h-5 w-5 text-primary" />
                <span className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground">{t.fields.length} fields</span>
              </div>
              <h3 className="mt-3 text-lg font-semibold leading-tight">{t.name}</h3>
              <p className="mt-1 line-clamp-2 text-[13px] text-muted-foreground">{t.description}</p>
              <span className="mt-3 inline-block rounded-full bg-secondary px-2.5 py-0.5 text-[11px]">{t.category}</span>
            </button>
          ))}
        </div>
      )}
      {!canCreate && (
        <div className="mt-10 flex flex-col items-start gap-3 rounded-2xl border bg-haldi/15 p-5 md:flex-row md:items-center md:justify-between">
          <p className="text-sm">Need one of these drafted for your situation? An advocate can prepare it as part of a consultation.</p>
          <Button onClick={() => setLocation('/lawyers')} className="rounded-full">Find a lawyer</Button>
        </div>
      )}
    </AppPage>
  );
}
