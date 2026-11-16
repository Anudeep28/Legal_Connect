import { useQueryClient } from '@tanstack/react-query';
import {
  useListPayments, getListPaymentsQueryKey, useReconcilePayment, useRefundPayment,
  useListConsultations, getListConsultationsQueryKey,
} from '@workspace/api-client-react';
import { Button } from '@/components/ui/button';
import { ErrorState } from '@/components/kit';
import { useToast } from '@/hooks/use-toast';
import { useAccount } from '@/lib/account';
import { usePaymentCheckout } from '@/hooks/use-payment-checkout';
import { errMsg, fmtDate, inr } from '@/lib/format';

export function PaymentHistory({ consultationId }: { consultationId?: string }) {
  const { signedIn } = useAccount();
  const query = useListPayments({ query: {
    enabled: signedIn, queryKey: getListPaymentsQueryKey(), refetchInterval: 10000,
  } });
  const consultations = useListConsultations({ query: {
    enabled: signedIn, queryKey: getListConsultationsQueryKey(), refetchInterval: 10000,
  } });
  const reconcile = useReconcilePayment();
  const refund = useRefundPayment();
  const checkout = usePaymentCheckout();
  const qc = useQueryClient();
  const { toast } = useToast();
  if (!signedIn) return null;
  const rows = (query.data ?? []).filter((p) => !consultationId || p.consultationId === consultationId);
  const busy = reconcile.isPending || refund.isPending || checkout.pending;
  const actions = {
    onSuccess: () => {
      qc.invalidateQueries();
      toast({ title: 'Payment status updated', description: 'Razorpay confirms refund processing automatically; no manual client or lawyer confirmation is needed.' });
    },
    onError: (e: unknown) => toast({ title: 'Could not confirm payment status', description: errMsg(e), variant: 'destructive' as const }),
  };
  return (
    <section className="mt-8 rounded-3xl border bg-card p-5" data-testid="payment-history">
      <h2 className="text-xl font-semibold">Payment history</h2>
      <p className="mt-1 text-sm text-muted-foreground">Prices include the displayed service fee. Plans are one-time purchases, not automatic renewals. Refund requests remove the associated access while processing.</p>
      {query.isLoading ? <p className="mt-4 text-sm">Loading payments…</p> : query.isError
        ? <ErrorState error={query.error} onRetry={() => query.refetch()} />
        : !rows.length ? <p className="mt-4 text-sm text-muted-foreground">No payment orders yet.</p>
        : <div className="mt-4 divide-y">
          {rows.map((p) => (
            <div key={p.id} className="space-y-2 py-4" data-testid={`payment-${p.id}`}>
              <p className="font-medium">{p.kind === 'consultation' ? 'Consultation' : p.kind === 'monthly' ? '30-day document plan' : 'Single document credit'} · {inr(p.amount / 100)}</p>
              <p className="text-sm">{p.mode === 'test' && <strong>Test mode — no real funds · </strong>}Status: <strong>{p.status.replace('_', ' ')}</strong> · {fmtDate(p.createdAt)}</p>
              <p className="break-all text-xs text-muted-foreground">Order: {p.providerOrderId}{p.providerPaymentId && ` · Payment: ${p.providerPaymentId}`}</p>
              {p.entitlementEndsAt && <p className="text-sm">Plan ends: {fmtDate(p.entitlementEndsAt)} · Documents created: {p.usedCount}</p>}
              {p.status === 'refund_pending' && <p className="text-sm text-muted-foreground">The refund is not yet confirmed complete. The app checks Razorpay automatically; no approval from you or the lawyer is needed. Access has been withdrawn. Use Check status to refresh; if it remains pending, contact the platform owner to check whether Razorpay accepted and processed it. Do not submit a separate refund while its status is uncertain.</p>}
              <div className="flex flex-wrap gap-2">
                {p.status === 'pending' && (!p.consultationId || consultations.data?.some(c => c.id === p.consultationId && c.status === 'requested' && ['pending', 'unpaid'].includes(c.paymentStatus) && new Date(c.startsAt).getTime() > Date.now())) && <Button size="sm" disabled={busy} onClick={() => checkout.start({ plan: p.kind, ...(p.consultationId ? { consultationId: p.consultationId } : {}) })}>Resume checkout</Button>}
                {p.status === 'pending' && p.consultationId && consultations.data?.some(c => c.id === p.consultationId && (c.status === 'cancelled' || new Date(c.startsAt).getTime() <= Date.now())) && <p className="text-sm text-muted-foreground">This appointment is cancelled or its start time has passed. Do not pay this order. Check status for any earlier payment; request a new appointment for another date.</p>}
                {['pending', 'refund_pending'].includes(p.status) && <Button size="sm" variant="outline" disabled={busy} onClick={() => reconcile.mutate({ id: p.id }, actions)}>Check status</Button>}
                {p.refundable && <Button size="sm" variant="outline" disabled={busy} onClick={() => {
                  if (window.confirm('Request a full refund to the original payment method? Associated document access or credits will be withdrawn immediately.')) refund.mutate({ id: p.id }, actions);
                }}>Request full refund</Button>}
              </div>
            </div>
          ))}
        </div>}
    </section>
  );
}
