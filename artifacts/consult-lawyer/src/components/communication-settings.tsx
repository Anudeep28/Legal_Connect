import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import {
  useGetPlatform, useRequestPhoneVerification, useConfirmPhoneVerification, useSavePushSubscription,
  useRemovePushSubscription, useUpdateMe, useListCommunicationDeliveries, getGetMeQueryKey,
  getListCommunicationDeliveriesQueryKey, type Account,
} from '@workspace/api-client-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { errMsg, fmtDateTime } from '@/lib/format';

function applicationServerKey(key: string): ArrayBuffer {
  const base64 = key.replace(/-/g, '+').replace(/_/g, '/');
  const decoded = atob(base64 + '='.repeat((4 - base64.length % 4) % 4));
  return Uint8Array.from(decoded, (c) => c.charCodeAt(0)).buffer;
}

export function CommunicationSettings({ me }: { me: Account }) {
  const platform = useGetPlatform();
  const qc = useQueryClient();
  const requestCode = useRequestPhoneVerification();
  const verifyCode = useConfirmPhoneVerification();
  const savePush = useSavePushSubscription();
  const removePush = useRemovePushSubscription();
  const update = useUpdateMe();
  const history = useListCommunicationDeliveries({
    query: { queryKey: getListCommunicationDeliveriesQueryKey(), refetchInterval: 15000 },
  });
  const [phone, setPhone] = useState('');
  const [code, setCode] = useState('');
  const [challenge, setChallenge] = useState<{ maskedPhone: string; expiresAt: string } | null>(null);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  const pushSupported = typeof window !== 'undefined' && 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;
  const run = async (work: () => Promise<void>) => {
    if (busy) return;
    setBusy(true); setError(''); setMessage('');
    try { await work(); await qc.invalidateQueries({ queryKey: getGetMeQueryKey() }); }
    catch (e) { setError(errMsg(e)); }
    finally { setBusy(false); }
  };
  const enablePush = () => run(async () => {
    if (!pushSupported || !platform.data?.pushPublicKey) throw new Error('Browser push is not available.');
    const permission = await Notification.requestPermission();
    if (permission !== 'granted') throw new Error('Notification permission was not granted. No subscription was enabled.');
    const registration = await navigator.serviceWorker.register(`${import.meta.env.BASE_URL}notifications-sw.js`, { scope: import.meta.env.BASE_URL });
    await navigator.serviceWorker.ready;
    const existing = await registration.pushManager.getSubscription();
    const subscription = existing || await registration.pushManager.subscribe({
      userVisibleOnly: true, applicationServerKey: applicationServerKey(platform.data.pushPublicKey),
    });
    const json = subscription.toJSON();
    if (!json.endpoint || !json.keys?.p256dh || !json.keys.auth) throw new Error('The browser returned an incomplete push subscription.');
    await savePush.mutateAsync({ data: { endpoint: json.endpoint, keys: { p256dh: json.keys.p256dh, auth: json.keys.auth } } });
    setMessage('Push subscription saved for this browser. This does not confirm receipt of a notification.');
  });
  const disablePush = () => run(async () => {
    // Persist opt-out first, even if browser cleanup fails.
    const account = await update.mutateAsync({ data: { pushNotifications: false } });
    qc.setQueryData(getGetMeQueryKey(), account);
    if (pushSupported) {
      const registration = await navigator.serviceWorker.getRegistration(import.meta.env.BASE_URL);
      const subscription = await registration?.pushManager.getSubscription();
      if (subscription) {
        await removePush.mutateAsync({ data: { endpoint: subscription.endpoint } });
        await subscription.unsubscribe();
      }
    }
    setMessage('Browser push is disabled for your account.');
  });
  return <section className="space-y-6 rounded-3xl border bg-card p-6 md:p-8" data-testid="communication-settings">
    <div>
      <h2 className="font-display text-xl font-semibold">Consultation reminders &amp; phone</h2>
      <p className="mt-2 text-sm text-muted-foreground">Confirmed, paid appointments get in-app reminders 24 hours and 10 minutes before the start. A 24-hour reminder is only sent if the booking was confirmed in time. Email and browser push also require your opt-in and configured services. No SMS appointment reminders are sent; SMS is used only for optional phone verification.</p>
    </div>
    <div className="space-y-3">
      <h3 className="font-semibold">Browser push</h3>
      <p className="text-sm">Account preference: <strong>{me.pushNotifications ? 'enabled' : 'disabled'}</strong>. {platform.data?.pushEnabled ? 'The push service is configured.' : 'The push service is not configured; no browser notifications can be sent.'}</p>
      {!pushSupported && <p className="text-sm text-muted-foreground">This browser does not support push here. On iPhone or iPad, a supported website generally needs to be added to the Home Screen first.</p>}
      <div className="flex flex-wrap gap-2">
        <Button variant="outline" disabled={!platform.data?.pushEnabled || !pushSupported || busy} onClick={enablePush} data-testid="button-enable-push">Enable on this browser</Button>
        <Button variant="outline" disabled={!me.pushNotifications || busy} onClick={disablePush} data-testid="button-disable-push">Disable account push</Button>
      </div>
      <p className="text-xs text-muted-foreground">Push content is generic and does not include legal messages or case details. Browser permission alone does not enable delivery.</p>
    </div>
    <div className="space-y-3 border-t pt-5">
      <h3 className="font-semibold">Optional phone verification</h3>
      <p className="text-sm" data-testid="phone-status">{me.phoneVerifiedAt && me.phone ? `Verified: ${me.phone} · ${fmtDateTime(me.phoneVerifiedAt)} IST` : 'No verified phone number.'}</p>
      {!platform.data?.phoneVerificationEnabled && <p className="text-sm">Twilio verification is not configured. No SMS can be sent or phone marked verified.</p>}
      <label className="block text-sm" htmlFor="verification-phone">Phone number with country code</label>
      <Input id="verification-phone" type="tel" autoComplete="tel" placeholder="+919876543210" value={phone} onChange={(e) => { setPhone(e.target.value); setChallenge(null); setCode(''); }} maxLength={16} data-testid="input-verification-phone" />
      <p className="text-xs text-muted-foreground">By requesting a code, you agree to receive a verification SMS from Twilio. Carrier charges may apply. Verification is not required to use chat or calls.</p>
      <Button variant="outline" disabled={!platform.data?.phoneVerificationEnabled || !/^\+[1-9]\d{7,14}$/.test(phone) || busy} onClick={() => run(async () => {
        const result = await requestCode.mutateAsync({ data: { phone } });
        setChallenge(result); setCode(''); setMessage(`Provider accepted a verification SMS request for ${result.maskedPhone}.`);
      })} data-testid="button-send-code">Request SMS code</Button>
      {challenge && <div className="space-y-2">
        <p className="text-sm">Code requested for {challenge.maskedPhone}. Expires {fmtDateTime(challenge.expiresAt)} IST.</p>
        <label className="block text-sm" htmlFor="verification-code">Verification code</label>
        <Input id="verification-code" autoComplete="one-time-code" inputMode="numeric" value={code} onChange={(e) => setCode(e.target.value)} maxLength={10} data-testid="input-verification-code" />
        <Button disabled={!/^\d{4,10}$/.test(code) || busy} onClick={() => run(async () => {
          const account = await verifyCode.mutateAsync({ data: { code } });
          qc.setQueryData(getGetMeQueryKey(), account);
          setChallenge(null); setCode(''); setPhone(''); setMessage('Twilio verified your phone number.');
        })} data-testid="button-verify-code">Verify code</Button>
      </div>}
    </div>
    {message && <p role="status" className="text-sm">{message}</p>}
    {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
    <div className="space-y-2 border-t pt-5">
      <h3 className="font-semibold">Recent outbound attempts</h3>
      <p className="text-xs text-muted-foreground">“Accepted” means the provider accepted the request, not that it arrived in your inbox or was read. Blocked deliveries need service configuration; failed deliveries are not replayed automatically.</p>
      {history.isLoading && <p className="text-sm">Loading delivery history…</p>}
      {history.isError && <p role="alert" className="text-sm text-destructive">{errMsg(history.error)}</p>}
      {history.data?.length === 0 && <p className="text-sm text-muted-foreground">No outbound delivery attempts yet.</p>}
      <ul className="space-y-2">{history.data?.map((d) => <li key={d.id} className="rounded-xl border p-3 text-sm">
        <strong className="capitalize">{d.channel} · {d.status}</strong> · {d.attempts} attempt(s) · {fmtDateTime(d.createdAt)} IST
        {d.lastError && <p className="text-xs text-muted-foreground">{d.lastError}</p>}
        {['retry', 'blocked'].includes(d.status) && <p className="text-xs text-muted-foreground">Next check: {fmtDateTime(d.nextAttemptAt)} IST</p>}
      </li>)}</ul>
    </div>
  </section>;
}
