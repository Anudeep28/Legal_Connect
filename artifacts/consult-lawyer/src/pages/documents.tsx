import { useState } from 'react';
import { Link, useLocation } from 'wouter';
import { useQueryClient } from '@tanstack/react-query';
import { FilePlus2, FileText, Copy, Trash2, Search, MoreHorizontal, LayoutTemplate, ArrowLeft } from 'lucide-react';
import {
  useListDocuments, getListDocumentsQueryKey, useCreateDocument, useDuplicateDocument, useDeleteDocument, useGetPlatform,
  type Template,
} from '@workspace/api-client-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Guard } from '@/components/guard';
import { AppPage } from '@/components/shell';
import { EmptyState, ErrorState, ListSkeleton, PageHeader } from '@/components/kit';
import { TemplateFiller } from '@/components/template-filler';
import { useToast } from '@/hooks/use-toast';
import { errMsg, relTime } from '@/lib/format';

export default function Documents() {
  return (
    <AppPage>
      <Guard roles={['lawyer', 'admin']}>{() => <Inner />}</Guard>
    </AppPage>
  );
}

function Inner() {
  const q = useListDocuments();
  const platform = useGetPlatform();
  const create = useCreateDocument();
  const dup = useDuplicateDocument();
  const del = useDeleteDocument();
  const qc = useQueryClient();
  const { toast } = useToast();
  const [, setLocation] = useLocation();
  const [search, setSearch] = useState('');
  const [newOpen, setNewOpen] = useState(false);
  const [tpl, setTpl] = useState<Template | null>(null);
  const [toDelete, setToDelete] = useState<string | null>(null);

  const invalidate = () => qc.invalidateQueries({ queryKey: getListDocumentsQueryKey() });
  const docs = (q.data ?? []).filter((d) => d.title.toLowerCase().includes(search.toLowerCase())).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));

  const make = (title: string, content: string, t?: Template) =>
    create.mutate(
      { data: { title, content, templateId: t?.id, category: t?.category, language: 'English' } },
      {
        onSuccess: (d) => { invalidate(); setNewOpen(false); setLocation(`/documents/${d.id}`); },
        onError: (e) => toast({ title: 'Could not create', description: errMsg(e), variant: 'destructive' }),
      },
    );

  return (
    <>
      <PageHeader
        eyebrow="Lawyer workspace"
        title="Documents"
        sub="Draft notices, agreements and advice notes. Fill templates, dictate, and use AI assistance. Every AI draft needs your review."
        actions={<Button className="rounded-full" onClick={() => { setTpl(null); setNewOpen(true); }} data-testid="button-new-document"><FilePlus2 /> New document</Button>}
      />
      <div className="relative mb-5 md:w-80">
        <Search className="absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
        <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search your documents" className="h-11 rounded-full pl-10" data-testid="input-doc-search" />
      </div>
      {q.isLoading ? (
        <ListSkeleton />
      ) : q.isError ? (
        <ErrorState error={q.error} onRetry={() => q.refetch()} />
      ) : docs.length === 0 ? (
        <EmptyState
          icon={<FileText />}
          title={search ? 'No documents match' : 'Your desk is clear'}
          body="Start from one of the Indian legal templates or a blank page. Documents are private to your account."
          action={<Button onClick={() => setNewOpen(true)}><FilePlus2 /> New document</Button>}
        />
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {docs.map((d, i) => (
            <div key={d.id} className="lift rise group relative rounded-2xl border bg-card" style={{ animationDelay: `${i * 30}ms` }}>
              <Link href={`/documents/${d.id}`} className="block p-5" data-testid={`card-document-${d.id}`}>
                <div className="mb-4 h-28 overflow-hidden rounded-xl border bg-[hsl(42_60%_99%)] p-3 font-serif text-[9px] leading-tight text-muted-foreground">{d.content.slice(0, 380) || 'Empty document'}</div>
                <h3 className="truncate pr-8 font-semibold group-hover:text-primary">{d.title}</h3>
                <p className="mt-0.5 text-xs text-muted-foreground">{d.category || 'General'} · {d.language} · edited {relTime(d.updatedAt)}</p>
              </Link>
              <DropdownMenu>
                <DropdownMenuTrigger className="absolute bottom-5 right-4 rounded-full p-1.5 hover:bg-muted" data-testid={`button-doc-menu-${d.id}`}><MoreHorizontal className="h-4 w-4" /></DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  <DropdownMenuItem onClick={() => dup.mutate({ id: d.id }, { onSuccess: () => { invalidate(); toast({ title: 'Duplicated' }); }, onError: (e) => toast({ title: 'Could not duplicate', description: errMsg(e), variant: 'destructive' }) })}><Copy className="h-4 w-4" /> Duplicate</DropdownMenuItem>
                  <DropdownMenuItem className="text-destructive" onClick={() => setToDelete(d.id)}><Trash2 className="h-4 w-4" /> Delete</DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
          ))}
        </div>
      )}

      <Dialog open={newOpen} onOpenChange={setNewOpen}>
        <DialogContent className="max-h-[92dvh] max-w-5xl overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="font-display text-2xl">{tpl ? tpl.name : 'Start a document'}</DialogTitle>
            <DialogDescription>{tpl ? 'Fill the fields; the preview updates as you type. Placeholders you leave empty stay as {{field}}.' : 'Pick a template or begin with a blank page.'}</DialogDescription>
          </DialogHeader>
          {tpl ? (
            <>
              <button onClick={() => setTpl(null)} className="inline-flex items-center gap-1 self-start text-sm text-muted-foreground hover:text-primary"><ArrowLeft className="h-4 w-4" /> Choose another</button>
              <TemplateFiller template={tpl} pending={create.isPending} onCreate={(content) => make(tpl.name, content, tpl)} />
            </>
          ) : (
            <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
              <button onClick={() => make('Untitled document', '')} className="flex flex-col items-start rounded-2xl border-2 border-dashed border-primary/30 p-4 text-left hover:bg-primary/5" data-testid="button-blank-document">
                <FilePlus2 className="h-5 w-5 text-primary" />
                <span className="mt-2 font-semibold">Blank document</span>
                <span className="text-xs text-muted-foreground">Write or dictate from scratch</span>
              </button>
              {(platform.data?.templates ?? []).map((t) => (
                <button key={t.id} onClick={() => setTpl(t)} className="flex flex-col items-start rounded-2xl border p-4 text-left hover:border-primary/40" data-testid={`button-pick-template-${t.id}`}>
                  <LayoutTemplate className="h-5 w-5 text-primary" />
                  <span className="mt-2 font-semibold leading-tight">{t.name}</span>
                  <span className="line-clamp-2 text-xs text-muted-foreground">{t.description}</span>
                </button>
              ))}
            </div>
          )}
        </DialogContent>
      </Dialog>

      <AlertDialog open={!!toDelete} onOpenChange={(o) => !o && setToDelete(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle className="font-display">Delete this document?</AlertDialogTitle>
            <AlertDialogDescription>This cannot be undone.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Keep</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground"
              onClick={() => toDelete && del.mutate({ id: toDelete }, { onSuccess: () => { invalidate(); toast({ title: 'Deleted' }); }, onError: (e) => toast({ title: 'Could not delete', description: errMsg(e), variant: 'destructive' }) })}
              data-testid="button-confirm-delete"
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
