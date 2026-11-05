import { useEffect, useMemo, useState } from 'react';
import { useLocation, useSearch } from 'wouter';
import { Search, SlidersHorizontal, X, UsersRound } from 'lucide-react';
import { useGetPlatform, useListLawyers, getListLawyersQueryKey, type ListLawyersParams, type ListLawyersSort } from '@workspace/api-client-react';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Switch } from '@/components/ui/switch';
import { Label } from '@/components/ui/label';
import { Skeleton } from '@/components/ui/skeleton';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { LawyerCard } from '@/components/lawyer-card';
import { EmptyState, ErrorState, PageHeader } from '@/components/kit';
import { AppPage } from '@/components/shell';

const sorts: { v: ListLawyersSort; l: string }[] = [
  { v: 'recommended', l: 'Recommended' },
  { v: 'rating', l: 'Highest rated' },
  { v: 'experience', l: 'Most experienced' },
  { v: 'fee_asc', l: 'Fee: low to high' },
  { v: 'fee_desc', l: 'Fee: high to low' },
];

export default function Lawyers() {
  const searchStr = useSearch();
  const [, setLocation] = useLocation();
  const sp = useMemo(() => new URLSearchParams(searchStr), [searchStr]);
  const [text, setText] = useState(sp.get('search') ?? '');
  const area = sp.get('area') ?? 'all';
  const language = sp.get('language') ?? 'all';
  const online = sp.get('online') === 'true';
  const sort = (sp.get('sort') as ListLawyersSort) || 'recommended';
  const search = sp.get('search') ?? '';

  const update = (patch: Record<string, string | null>) => {
    const next = new URLSearchParams(searchStr);
    Object.entries(patch).forEach(([k, v]) => (v === null || v === '' || v === 'all' ? next.delete(k) : next.set(k, v)));
    const s = next.toString();
    setLocation(s ? `/lawyers?${s}` : '/lawyers', { replace: true });
  };

  useEffect(() => {
    const t = setTimeout(() => {
      if (text.trim() !== search) update({ search: text.trim() || null });
    }, 350);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [text]);

  const params: ListLawyersParams = {
    ...(search ? { search } : {}),
    ...(area !== 'all' ? { practiceArea: area } : {}),
    ...(language !== 'all' ? { language } : {}),
    ...(online ? { online: 'true' as const } : {}),
    sort,
  };
  const platform = useGetPlatform();
  const lawyers = useListLawyers(params, { query: { queryKey: getListLawyersQueryKey(params), placeholderData: (prev) => prev } });
  const active = search || area !== 'all' || language !== 'all' || online;

  return (
    <AppPage wide>
      <PageHeader
        eyebrow="Directory"
        title={<>Find the advocate for <span className="italic text-primary">your</span> situation</>}
        sub="Every fee is for one 30-minute consultation in INR. Profiles marked Illustrative are examples only."
      />
      <div className="sticky top-16 z-30 -mx-4 mb-8 border-y bg-background/90 px-4 py-3 backdrop-blur md:mx-0 md:rounded-2xl md:border md:px-4">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-center">
          <div className="relative flex-1">
            <Search className="absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input value={text} onChange={(e) => setText(e.target.value)} placeholder="Name, city, or problem" className="h-11 rounded-full pl-10" data-testid="input-search" />
          </div>
          <div className="grid grid-cols-2 gap-2 sm:flex sm:flex-wrap sm:items-center">
            <Select value={area} onValueChange={(v) => update({ area: v })}>
              <SelectTrigger className="h-11 rounded-full sm:w-[190px]" data-testid="select-area"><SelectValue placeholder="Legal area" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All legal areas</SelectItem>
                {(platform.data?.categories ?? []).map((c) => <SelectItem key={c.id} value={c.name}>{c.name}</SelectItem>)}
              </SelectContent>
            </Select>
            <Select value={language} onValueChange={(v) => update({ language: v })}>
              <SelectTrigger className="h-11 rounded-full sm:w-[160px]" data-testid="select-language"><SelectValue placeholder="Language" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Any language</SelectItem>
                {(platform.data?.languages ?? []).map((l) => <SelectItem key={l} value={l}>{l}</SelectItem>)}
              </SelectContent>
            </Select>
            <Select value={sort} onValueChange={(v) => update({ sort: v === 'recommended' ? null : v })}>
              <SelectTrigger className="h-11 rounded-full sm:w-[180px]" data-testid="select-sort"><SlidersHorizontal className="h-4 w-4" /><SelectValue /></SelectTrigger>
              <SelectContent>{sorts.map((s) => <SelectItem key={s.v} value={s.v}>{s.l}</SelectItem>)}</SelectContent>
            </Select>
            <Label className="flex h-11 cursor-pointer items-center gap-2 rounded-full border px-4 text-sm font-normal">
              <Switch checked={online} onCheckedChange={(c) => update({ online: c ? 'true' : null })} data-testid="switch-online" />
              Available now
            </Label>
          </div>
        </div>
        {active && (
          <div className="mt-3 flex items-center gap-2 text-sm">
            <span className="text-muted-foreground" data-testid="text-result-count">{lawyers.data?.length ?? 0} results</span>
            <Button variant="ghost" size="sm" onClick={() => { setText(''); setLocation('/lawyers', { replace: true }); }} data-testid="button-clear-filters">
              <X /> Clear filters
            </Button>
          </div>
        )}
      </div>

      {lawyers.isLoading ? (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">{Array.from({ length: 9 }).map((_, i) => <Skeleton key={i} className="h-72 rounded-[1.4rem]" />)}</div>
      ) : lawyers.isError ? (
        <ErrorState error={lawyers.error} onRetry={() => lawyers.refetch()} />
      ) : (lawyers.data ?? []).length === 0 ? (
        <EmptyState
          icon={<UsersRound />}
          title="No advocates match these filters"
          body="Try a broader legal area, a different language, or turn off Available now."
          action={<Button variant="outline" onClick={() => { setText(''); setLocation('/lawyers'); }}>Reset filters</Button>}
        />
      ) : (
        <div className={`grid gap-4 sm:grid-cols-2 lg:grid-cols-3 transition-opacity ${lawyers.isFetching ? 'opacity-60' : ''}`}>
          {(lawyers.data ?? []).map((l, i) => <LawyerCard key={l.id} lawyer={l} index={i} />)}
        </div>
      )}
    </AppPage>
  );
}
