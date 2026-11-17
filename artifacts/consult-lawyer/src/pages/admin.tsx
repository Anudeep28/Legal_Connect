import { useEffect, useState } from 'react';
import { Link } from 'wouter';
import { useQueryClient } from '@tanstack/react-query';
import { Loader2, Users, Scale, Hourglass, MessagesSquare, CheckCheck, FileText, Eye, EyeOff, ShieldCheck, Info } from 'lucide-react';
import {
  useGetAdminOverview, getGetAdminOverviewQueryKey,
  useListAdminUsers, getListAdminUsersQueryKey, useModerateUser,
  useListAdminLawyers, getListAdminLawyersQueryKey, useModerateLawyer,
  useListAdminReviews, getListAdminReviewsQueryKey, useModerateReview,
  useGetAdminLegalReview, getGetAdminLegalReviewQueryKey, useRecordAdminLegalReview,
  getGetPlatformQueryKey,
  getListLawyersQueryKey, getListLawyerReviewsQueryKey,
  type UserModerationStatus, type LawyerModerationApprovalStatus, type LegalCounselApprovalInput,
} from '@workspace/api-client-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { Checkbox } from '@/components/ui/checkbox';
import { Skeleton } from '@/components/ui/skeleton';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Guard } from '@/components/guard';
import { AppPage } from '@/components/shell';
import { DemoTag, EmptyState, ErrorState, ListSkeleton, Notice, PageHeader, PersonAvatar, Stars } from '@/components/kit';
import { useToast } from '@/hooks/use-toast';
import { cn } from '@/lib/utils';
import { errMsg, fmtDate, inr } from '@/lib/format';
import { AdminTwilioUsage } from '@/components/admin-twilio-usage';

export default function Admin() {
  return (
    <AppPage wide>
      <Guard roles={['admin']}>
        {() => (
          <>
            <PageHeader eyebrow="Administration" title="Platform oversight" sub="Owner-controlled changes are recorded and enforced on the server." />
            <Tabs defaultValue="overview">
              <TabsList className="mb-6 h-auto flex-wrap rounded-full bg-secondary p-1">
                {['overview', 'lawyers', 'users', 'reviews', 'legal-review', 'call-usage'].map((t) => (
                  <TabsTrigger key={t} value={t} className="rounded-full px-4 capitalize data-[state=active]:bg-card" data-testid={`tab-admin-${t}`}>{t === 'lawyers' ? 'Lawyer approvals' : t === 'legal-review' ? 'Legal approval' : t === 'call-usage' ? 'Call usage' : t}</TabsTrigger>
                ))}
              </TabsList>
              <TabsContent value="overview"><Overview /></TabsContent>
              <TabsContent value="lawyers"><LawyersTab /></TabsContent>
              <TabsContent value="users"><UsersTab /></TabsContent>
              <TabsContent value="reviews"><ReviewsTab /></TabsContent>
              <TabsContent value="legal-review"><LegalReviewTab /></TabsContent>
              <TabsContent value="call-usage"><AdminTwilioUsage /></TabsContent>
            </Tabs>
          </>
        )}
      </Guard>
    </AppPage>
  );
}

type CounselForm = Omit<LegalCounselApprovalInput, 'confirmApproval'>;
const initialCounselForm: CounselForm = {
  counselName: '',
  barCouncil: '',
  enrollmentNumber: '',
  counselEmail: '',
  supportContactEmail: 'support@consultwithlawyer.in',
  privacyContactEmail: 'privacy@consultwithlawyer.in',
  privacyContactAddress: 'Amanora Park Town, Amanora Gold Tower, Tower 42, Flat 1012, Hadapsar, Pune 411028',
  grievanceOfficerName: 'Bhagyashree Patil',
  grievanceOfficerEmail: 'privacy@consultwithlawyer.in',
};
const counselFields: { key: keyof CounselForm; label: string; type?: string; wide?: boolean }[] = [
  { key: 'counselName', label: 'Qualified counsel name' },
  { key: 'barCouncil', label: 'Bar Council' },
  { key: 'enrollmentNumber', label: 'Enrolment number' },
  { key: 'counselEmail', label: 'Counsel email', type: 'email' },
  { key: 'supportContactEmail', label: 'Public support email', type: 'email' },
  { key: 'privacyContactEmail', label: 'Privacy contact email', type: 'email' },
  { key: 'grievanceOfficerName', label: 'Grievance officer name' },
  { key: 'grievanceOfficerEmail', label: 'Grievance officer email', type: 'email' },
  { key: 'privacyContactAddress', label: 'Business contact address', wide: true },
];

function LegalReviewTab() {
  const q = useGetAdminLegalReview();
  const save = useRecordAdminLegalReview();
  const qc = useQueryClient();
  const { toast } = useToast();
  const [form, setForm] = useState<CounselForm>(initialCounselForm);
  const [confirmed, setConfirmed] = useState(false);
  useEffect(() => {
    if (!q.data?.approval) return;
    const { approvedAt: _approvedAt, ...saved } = q.data.approval;
    setForm(saved);
  }, [q.data?.approval]);
  if (q.isLoading) return <ListSkeleton />;
  if (q.isError || !q.data) return <ErrorState error={q.error} onRetry={() => q.refetch()} />;
  const current = q.data.approval;
  const complete = Object.values(form).every((value) => value.trim().length > 0);
  return (
    <div className="max-w-4xl space-y-5">
      <Notice icon={<ShieldCheck />}>
        Paid consultations open only after both Razorpay verification and a recorded qualified-counsel approval. This does not change client-content rights or refund rules.
        <div className="mt-2 font-medium">
          Razorpay: {q.data.paymentVerificationComplete ? 'verified' : 'not verified'} · Counsel: {current ? 'approval recorded' : 'not approved'} · Paid consultations: {q.data.paidConsultationsEnabled ? 'enabled' : 'closed'}
        </div>
        {current && <p className="mt-2 text-sm">Current approval recorded {fmtDate(current.approvedAt)} for {current.counselName} ({current.barCouncil}, {current.enrollmentNumber}).</p>}
      </Notice>
      {!q.data.canRecord ? (
        <Notice icon={<Info />}>Only the owner-designated administrator can record or update this approval.</Notice>
      ) : (
        <form className="space-y-5 rounded-3xl border bg-card p-5 md:p-7" onSubmit={(event) => {
          event.preventDefault();
          save.mutate({ data: { ...form, confirmApproval: true } }, {
            onSuccess: (result) => {
              qc.setQueryData(getGetAdminLegalReviewQueryKey(), result);
              qc.invalidateQueries({ queryKey: getGetPlatformQueryKey() });
              setConfirmed(false);
              toast({ title: 'Counsel approval recorded', description: result.paidConsultationsEnabled ? 'Paid consultation checkout is now open.' : 'The payment-verification gate is still closed.' });
            },
            onError: (error) => toast({ title: 'Approval was not recorded', description: errMsg(error), variant: 'destructive' }),
          });
        }}>
          <div>
            <h2 className="font-display text-2xl font-semibold">Counsel approval and policy contacts</h2>
            <p className="mt-1 text-sm text-muted-foreground">Enter the qualified counsel who reviewed the current public policies. The approved contacts below are shown in those policies.</p>
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            {counselFields.map(({ key, label, type = 'text', wide }) => (
              <div key={key} className={wide ? 'sm:col-span-2' : ''}>
                <Label htmlFor={`legal-${key}`}>{label}</Label>
                <Input id={`legal-${key}`} className="mt-1.5" type={type} required maxLength={key === 'privacyContactAddress' ? 500 : 254} value={form[key]} onChange={(event) => setForm((old) => ({ ...old, [key]: event.target.value }))} />
              </div>
            ))}
          </div>
          <label className="flex cursor-pointer items-start gap-3 rounded-2xl border p-4 text-sm">
            <Checkbox checked={confirmed} onCheckedChange={(checked) => setConfirmed(checked === true)} className="mt-0.5" />
            <span>I confirm qualified counsel has reviewed and approved the current Terms, Privacy Policy, Disclaimer, Refund Policy, and all policy contact details entered above.</span>
          </label>
          <Button type="submit" disabled={!q.data.canRecord || !complete || !confirmed || save.isPending} className="rounded-full">
            {save.isPending && <Loader2 className="animate-spin" />}
            {current ? 'Update counsel approval' : 'Record counsel approval'}
          </Button>
        </form>
      )}
    </div>
  );
}

function Overview() {
  const q = useGetAdminOverview();
  if (q.isLoading) return <div className="grid gap-3 md:grid-cols-3">{Array.from({ length: 6 }).map((_, i) => <Skeleton key={i} className="h-32 rounded-2xl" />)}</div>;
  if (q.isError || !q.data) return <ErrorState error={q.error} onRetry={() => q.refetch()} />;
  const o = q.data;
  const stats = [
    ['Users', o.users, Users], ['Lawyers', o.lawyers, Scale], ['Pending approvals', o.pendingLawyers, Hourglass],
    ['Consultations', o.consultations, MessagesSquare], ['Completed', o.completedConsultations, CheckCheck], ['Documents', o.documents, FileText],
  ] as const;
  return (
    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
      {stats.map(([l, v, I], i) => (
        <div key={l} className={cn('rise rounded-2xl border p-6', l === 'Pending approvals' && v > 0 ? 'ink-panel' : 'bg-card')} style={{ animationDelay: `${i * 50}ms` }}>
          <I className={cn('h-5 w-5', l === 'Pending approvals' && v > 0 ? 'text-haldi' : 'text-primary')} />
          <div className="mt-4 font-display text-4xl font-semibold" data-testid={`stat-admin-${l.toLowerCase().replace(/\s/g, '-')}`}>{v}</div>
          <div className="font-mono text-[11px] uppercase tracking-widest opacity-70">{l}</div>
        </div>
      ))}
    </div>
  );
}

function ReasonDialog({ open, title, desc, confirm, pending, onClose, onSubmit, danger }: { open: boolean; title: string; desc: string; confirm: string; pending: boolean; onClose: () => void; onSubmit: (reason: string) => void; danger?: boolean }) {
  const [reason, setReason] = useState('');
  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) { setReason(''); onClose(); } }}>
      <DialogContent>
        <DialogHeader><DialogTitle className="font-display text-2xl">{title}</DialogTitle><DialogDescription>{desc}</DialogDescription></DialogHeader>
        <Textarea value={reason} onChange={(e) => setReason(e.target.value)} rows={3} maxLength={1000} placeholder="Reason (at least 3 characters, recorded)" data-testid="input-moderation-reason" />
        <div className="flex justify-end gap-2">
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button variant={danger ? 'destructive' : 'default'} disabled={reason.trim().length < 3 || pending} onClick={() => { onSubmit(reason.trim()); setReason(''); }} data-testid="button-confirm-moderation">{pending && <Loader2 className="animate-spin" />}{confirm}</Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function LawyersTab() {
  const q = useListAdminLawyers();
  const m = useModerateLawyer();
  const qc = useQueryClient();
  const { toast } = useToast();
  const [action, setAction] = useState<{ id: string; name: string; status: LawyerModerationApprovalStatus } | null>(null);
  const [filter, setFilter] = useState<'pending' | 'approved' | 'rejected' | 'all'>('pending');
  const list = (q.data ?? []).filter((l) => filter === 'all' || l.approvalStatus === filter);
  return (
    <div>
      <div className="mb-4 flex flex-wrap gap-1.5">
        {(['pending', 'approved', 'rejected', 'all'] as const).map((f) => (
          <button key={f} onClick={() => setFilter(f)} className={cn('rounded-full border px-3.5 py-1.5 text-[13px] capitalize', filter === f ? 'border-primary bg-primary text-primary-foreground' : 'bg-card')}>{f}</button>
        ))}
      </div>
      {q.isLoading ? <ListSkeleton /> : q.isError ? <ErrorState error={q.error} onRetry={() => q.refetch()} /> : list.length === 0 ? (
        <EmptyState icon={<Scale />} title="Nothing here" body={filter === 'pending' ? 'No applications waiting for review.' : 'No lawyers in this state.'} />
      ) : (
        <div className="space-y-3">
          {list.map((l) => (
            <div key={l.id} className="rounded-2xl border bg-card p-5" data-testid={`row-admin-lawyer-${l.id}`}>
              <div className="flex flex-col gap-4 md:flex-row md:items-start">
                <PersonAvatar name={l.name} src={l.avatarUrl} />
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2"><span className="text-lg font-semibold">{l.name}</span>{l.demo && <DemoTag />}<span className="rounded-full bg-secondary px-2 py-0.5 text-[11px] capitalize">{l.approvalStatus}</span></div>
                  <p className="text-sm text-muted-foreground">{l.title} · {l.city} · {l.experienceYears} yrs · {inr(l.fee)} / 30 min</p>
                  <p className="mt-2 font-mono text-xs">{l.barCouncil} · {l.enrollmentNumber}</p>
                  <p className="mt-2 line-clamp-2 text-sm text-foreground/80">{l.bio}</p>
                  <p className="mt-1 text-xs text-muted-foreground">{l.practiceAreas.join(', ')} · {l.languages.join(', ')}</p>
                  {l.rejectionReason && <p className="mt-1 text-xs text-destructive">Last reason: {l.rejectionReason}</p>}
                </div>
                <div className="flex gap-2">
                  {l.approvalStatus === 'approved' && <Button asChild size="sm" variant="ghost"><Link href={`/lawyers/${l.id}`}>View</Link></Button>}
                  {l.approvalStatus !== 'approved' && <Button size="sm" onClick={() => setAction({ id: l.id, name: l.name, status: 'approved' })} data-testid={`button-approve-${l.id}`}>Approve</Button>}
                  {l.approvalStatus !== 'rejected' && <Button size="sm" variant="outline" onClick={() => setAction({ id: l.id, name: l.name, status: 'rejected' })} data-testid={`button-reject-${l.id}`}>Reject</Button>}
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
      <ReasonDialog
        open={!!action}
        title={action?.status === 'approved' ? `Approve ${action?.name}?` : `Reject ${action?.name}?`}
        desc={action?.status === 'approved' ? 'Confirm you checked the enrolment details. The profile becomes public.' : 'The lawyer will see this reason and can resubmit.'}
        confirm={action?.status === 'approved' ? 'Approve' : 'Reject'}
        danger={action?.status === 'rejected'}
        pending={m.isPending}
        onClose={() => setAction(null)}
        onSubmit={(reason) => action && m.mutate({ id: action.id, data: { approvalStatus: action.status, reason } }, {
          onSuccess: () => {
            qc.invalidateQueries({ queryKey: getListAdminLawyersQueryKey() });
            qc.invalidateQueries({ queryKey: getGetAdminOverviewQueryKey() });
            qc.invalidateQueries({ queryKey: getListLawyersQueryKey() });
            toast({ title: action.status === 'approved' ? 'Lawyer approved' : 'Application rejected' });
            setAction(null);
          },
          onError: (e) => toast({ title: 'Action failed', description: errMsg(e), variant: 'destructive' }),
        })}
      />
    </div>
  );
}

function UsersTab() {
  const q = useListAdminUsers();
  const m = useModerateUser();
  const qc = useQueryClient();
  const { toast } = useToast();
  const [action, setAction] = useState<{ id: string; name: string; status: UserModerationStatus } | null>(null);
  if (q.isLoading) return <ListSkeleton />;
  if (q.isError) return <ErrorState error={q.error} onRetry={() => q.refetch()} />;
  const users = q.data ?? [];
  if (!users.length) return <EmptyState icon={<Users />} title="No users yet" body="Accounts appear here after sign-up." />;
  return (
    <div className="overflow-x-auto rounded-2xl border bg-card">
      <table className="w-full min-w-[720px] text-sm">
        <thead className="border-b bg-secondary/50 text-left font-mono text-[11px] uppercase tracking-widest text-muted-foreground">
          <tr><th className="p-4">User</th><th className="p-4">Role</th><th className="p-4">Status</th><th className="p-4">Joined</th><th className="p-4 text-right">Action</th></tr>
        </thead>
        <tbody>
          {users.map((u) => (
            <tr key={u.id} className="border-b last:border-0" data-testid={`row-admin-user-${u.id}`}>
              <td className="p-4"><div className="font-medium">{u.name}</div><div className="text-xs text-muted-foreground">{u.email}</div></td>
              <td className="p-4 capitalize">{u.role}</td>
              <td className="p-4"><span className={cn('rounded-full px-2 py-0.5 text-xs capitalize', u.status === 'active' ? 'bg-[hsl(168_40%_36%/0.12)] text-[hsl(168_45%_26%)]' : 'bg-destructive/10 text-destructive')}>{u.status}</span></td>
              <td className="p-4 text-muted-foreground">{fmtDate(u.createdAt)}</td>
              <td className="p-4 text-right">
                {u.status === 'active' ? (
                  <Button size="sm" variant="outline" onClick={() => setAction({ id: u.id, name: u.name, status: 'suspended' })} data-testid={`button-suspend-${u.id}`}>Suspend</Button>
                ) : (
                  <Button size="sm" onClick={() => setAction({ id: u.id, name: u.name, status: 'active' })} data-testid={`button-reactivate-${u.id}`}>Reactivate</Button>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <ReasonDialog
        open={!!action}
        title={`${action?.status === 'active' ? 'Reactivate' : 'Suspend'} ${action?.name}?`}
        desc="This changes what the account can do. The reason is recorded."
        confirm={action?.status === 'active' ? 'Reactivate' : 'Suspend'}
        danger={action?.status !== 'active'}
        pending={m.isPending}
        onClose={() => setAction(null)}
        onSubmit={(reason) => action && m.mutate({ id: action.id, data: { status: action.status, reason } }, {
          onSuccess: () => { qc.invalidateQueries({ queryKey: getListAdminUsersQueryKey() }); qc.invalidateQueries({ queryKey: getGetAdminOverviewQueryKey() }); toast({ title: 'User updated' }); setAction(null); },
          onError: (e) => toast({ title: 'Action failed', description: errMsg(e), variant: 'destructive' }),
        })}
      />
    </div>
  );
}

function ReviewsTab() {
  const q = useListAdminReviews();
  const m = useModerateReview();
  const qc = useQueryClient();
  const { toast } = useToast();
  const [action, setAction] = useState<{ id: string; lawyerId: string; visible: boolean } | null>(null);
  if (q.isLoading) return <ListSkeleton />;
  if (q.isError) return <ErrorState error={q.error} onRetry={() => q.refetch()} />;
  const reviews = q.data ?? [];
  if (!reviews.length) return <EmptyState icon={<Eye />} title="No reviews to moderate" body="Client reviews appear here after completed consultations." />;
  return (
    <div className="space-y-3">
      {reviews.map((r) => (
        <div key={r.id} className={cn('flex flex-col gap-3 rounded-2xl border bg-card p-5 md:flex-row md:items-start', !r.visible && 'opacity-70')} data-testid={`row-admin-review-${r.id}`}>
          <div className="flex-1">
            <div className="flex flex-wrap items-center gap-2"><Stars value={r.rating} /><span className="font-medium">{r.clientName}</span><span className="font-mono text-[11px] text-muted-foreground">{fmtDate(r.createdAt)}</span>{!r.visible && <span className="rounded-full bg-destructive/10 px-2 py-0.5 text-[11px] text-destructive">Hidden</span>}</div>
            <p className="mt-2 text-sm">{r.comment || <em className="text-muted-foreground">No comment</em>}</p>
            {r.moderationReason && <p className="mt-1 text-xs text-muted-foreground">Moderation note: {r.moderationReason}</p>}
            <Link href={`/lawyers/${r.lawyerId}`} className="mt-1 inline-block text-xs text-primary">View lawyer</Link>
          </div>
          <Button size="sm" variant="outline" onClick={() => setAction({ id: r.id, lawyerId: r.lawyerId, visible: !r.visible })} data-testid={`button-toggle-review-${r.id}`}>
            {r.visible ? <><EyeOff /> Hide</> : <><Eye /> Show</>}
          </Button>
        </div>
      ))}
      <ReasonDialog
        open={!!action}
        title={action?.visible ? 'Show this review?' : 'Hide this review?'}
        desc="Hidden reviews no longer appear on the lawyer profile."
        confirm={action?.visible ? 'Show' : 'Hide'}
        danger={!action?.visible}
        pending={m.isPending}
        onClose={() => setAction(null)}
        onSubmit={(reason) => action && m.mutate({ id: action.id, data: { visible: action.visible, reason } }, {
          onSuccess: () => { qc.invalidateQueries({ queryKey: getListAdminReviewsQueryKey() }); qc.invalidateQueries({ queryKey: getListLawyerReviewsQueryKey(action.lawyerId) }); toast({ title: 'Review updated' }); setAction(null); },
          onError: (e) => toast({ title: 'Action failed', description: errMsg(e), variant: 'destructive' }),
        })}
      />
    </div>
  );
}
