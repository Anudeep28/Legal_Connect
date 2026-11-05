import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { createCheckout, createValidationCheckout, verifyPayment, type CheckoutInput, type CheckoutOrder } from '@workspace/api-client-react';
import { openCheckout } from '@/lib/razorpay-checkout';
import { errMsg } from '@/lib/format';
import { useToast } from '@/hooks/use-toast';

export function usePaymentCheckout() {
  const [pending, setPending] = useState(false);
  const qc = useQueryClient();
  const { toast } = useToast();
  async function perform(create: () => Promise<CheckoutOrder>) {
    if (pending) return;
    setPending(true);
    try {
      const order = await create();
      const paid = await openCheckout(order, async (result) => {
        const payment = await verifyPayment({
          id: order.id, paymentId: result.razorpay_payment_id, signature: result.razorpay_signature,
        });
        return payment.status === 'paid';
      });
      toast({
        title: paid ? (order.mode === 'test' ? 'Test payment verified' : 'Payment verified') : 'Payment not confirmed',
        description: paid ? 'Your account has been updated. Consultations still require lawyer acceptance.'
          : 'You can check or resume the order in payment history. No access has been granted without verification.',
      });
    } catch (e) {
      toast({ title: 'Payment not confirmed', description: errMsg(e), variant: 'destructive' });
    } finally {
      await qc.invalidateQueries();
      setPending(false);
    }
  }
  return {
    start: (data: CheckoutInput) => perform(() => createCheckout(data)),
    startValidation: () => perform(() => createValidationCheckout({ approveCharge: true })),
    pending,
  };
}
