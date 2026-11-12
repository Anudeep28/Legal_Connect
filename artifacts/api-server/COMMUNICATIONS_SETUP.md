# Communication services

## Current state

The owner selected Twilio and Resend, then dismissed both connection cards and
asked to continue without the integrations. This implementation is deliberately
**not live**: no real call, SMS, email or browser-push receipt has been verified.
Do not enable service flags based only on synthetic tests.

The original repository used randomly generated public Jitsi Meet links. These
did not enforce the new app's participant access rules. This app instead prepares
**Twilio Programmable Video audio-only rooms**, not TwiML/PSTN telephone calls.
The browser SDK does not request camera access. Optional SMS verification uses
Twilio Verify. Resend sends email. Standard Web Push sends generic browser alerts.
These services can incur charges.

## Activation

Reconnect the approved API integrations when the owner is ready. Use the
workspace's secure secret/integration flow, never chat, source files, client
bundles, logs or committed environment files.

### Twilio audio calling

Configure server-only `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`,
`TWILIO_API_KEY_SID`, and `TWILIO_API_KEY_SECRET` for the same Twilio account.
Enable Programmable Video group rooms in that account. Review pricing, supported
regions, data processing and network/firewall requirements with the owner.
Only after a real two-participant check, set `TWILIO_CALLS_ENABLED=true`.

Joining requires:

- An active signed-in client or the assigned approved lawyer. Administrators
  have no call-listening privilege.
- A non-demo, paid appointment accepted by the lawyer.
- The time window from 10 minutes before start until the stored end instant.
- Explicit microphone consent and acknowledgement that recording is disabled.

Tokens last at most five minutes and are restricted to one provider room and
one account identity. The frontend distinguishes waiting, connected,
reconnecting and failed states from provider events; token issuance alone is
not a connected call. Leaving/unmounting stops microphone tracks.

No call-recording feature or durable audio storage is implemented. Rooms are
created with recording off; joining is rejected if the provider reports recording
enabled, and the browser disconnects on a recording-start event. Do not change
Twilio recording settings during a session. The app cannot technically prevent a
participant from recording outside the app. Stored consent records contain only
account, consultation, policy version and consent time, not audio.

The worker closes rooms after completion, cancellation, the scheduled end,
participant suspension, or lawyer-approval withdrawal, retrying closure on
failure. The browser polls eligibility every five seconds and stops at the
scheduled end. Provider-side maximum participant duration is also set. Revocation
depends on worker/API/provider availability; it is not instantaneous token
revocation. Test cancellation and reconnection in a real provider room.

### Optional phone verification

Configure `TWILIO_VERIFY_SERVICE_SID` and the account credentials above. Set
`TWILIO_VERIFY_ENABLED=true` only after a real verification check. Configure
Twilio Verify fraud prevention, allowed destination countries and any Indian
telecom/sender registration requirements before permitting public traffic.

The user must enter an E.164 number and explicitly request an SMS. The database
stores a pending challenge, not a verified phone. Only an approved, valid Twilio
check for the exact challenged number writes the verified phone and timestamp.
Codes are never stored. Challenges expire after 10 minutes, allow five check
attempts, and sending is limited to once a minute and five requests per hour per
account and destination. Replacing a verified phone requires verifying the new
number. SMS is **not** used for appointment reminders.

### Resend

Configure `RESEND_API_KEY`, a verified `EMAIL_FROM` sender, and `APP_PUBLIC_URL`
as the actual HTTPS origin where this app is published (no path/query/fragment).
Do not use a development URL as the production origin. Set
`EMAIL_DELIVERY_ENABLED=true` only after sender verification and a real
recipient check. Users must opt in through Settings.

Emails contain a generic update and a sign-in link, not legal message content.
“Accepted” records a real Resend API message ID, **not** inbox delivery/read
confirmation. Provider bounce/complaint webhooks and an email marketing system
are not implemented.

### Browser push

Generate a stable VAPID key pair securely; store the private key only as
`VAPID_PRIVATE_KEY`, with `VAPID_PUBLIC_KEY` and `VAPID_SUBJECT` (an approved
`mailto:` or HTTPS contact). Do not rotate keys without replacing browser
subscriptions. Set `PUSH_DELIVERY_ENABLED=true` after a real browser check.

Settings asks for browser permission only on a user action, registers
`notifications-sw.js`, saves the browser subscription and enables the account
preference. Account opt-out suppresses queued work. Expired 404/410 endpoints
are removed. Push is generic, so a shared device's lock screen does not expose
case details. Push subscriptions are durable metadata, not uploaded files.
No private pages/API responses are cached by the service worker.

Permission and availability vary by browser/platform; test the intended
browser outside an embedded preview. iOS/iPadOS push generally requires a
supported Home Screen web app. Unsupported/denied states do not claim success.

## Reliable reminder scheduling

The API runs a 15-second worker while the process is alive. For unattended
production reminders, keep the process running continuously **or configure an
external scheduler** to POST to `/api/communications/dispatch` every minute.
For that endpoint, configure a random server-only
`COMMUNICATION_WORKER_SECRET` of at least 32 characters and have the scheduler
send it as an Authorization Bearer value over HTTPS. Never put this secret in
the frontend. The machine-only endpoint rejects missing/incorrect credentials
and is independent of browser sign-in/CSRF. No external scheduler is connected
by this change.

An API process that sleeps when idle cannot, by itself, guarantee reminders.
Confirm the production scheduler is running and alert on non-2xx responses.
The dispatch acknowledgement is not proof of outbound delivery.

- Only confirmed, paid, non-demo consultations produce reminders for the client
  and the assigned lawyer.
- Durable event keys include consultation, scheduled start, lead time and
  recipient. Multiple workers do not create duplicate reminder events.
- 24-hour reminders have a one-hour catch-up window. 10-minute reminders expire
  at session start. Missed windows are not replayed as misleading current alerts.
  A consultation booked too late will not receive an old 24-hour reminder.
- Every persisted in-app notification is processed into per-channel,
  per-destination jobs if the account opted in at queue time. Opting in later
  does not replay historical notifications.
- Delivery rechecks account activity, current preference and reminder appointment
  state before contacting a provider. Cancellation or an expired/changed
  appointment suppresses pending reminders.
- Unconfigured channels are `blocked`, not accepted; they are checked again
  every five minutes until the message expires.
- Jobs use database leases and unique destination keys. Crashed leases are
  reclaimable after two minutes. Retryable provider/network errors use bounded
  exponential backoff, at most ten attempts. Generic jobs expire after 24 hours.
- Resend payloads and idempotency keys are frozen before external requests.
  Retry is stopped after 20 hours from the first attempt, safely within Resend's
  24-hour key-retention period.
- Web Push cannot provide exactly-once delivery after a crash following provider
  acceptance. Durable per-subscription status avoids ordinary duplicate sends,
  and the notification ID is used as the browser tag to replace duplicate
  alerts. Push acceptance is not proof that a device displayed/read it.
- Settings exposes recent user-owned attempt states. Failed messages are not
  blindly replayed.

## Verification

`pnpm --filter @workspace/api-server run test:communications` uses disposable
development fixtures, synthetic provider responses and blocked real network
access. It is not proof of live calling, delivery or verification.

Before activation, verify two real participant browsers (audio, mute, leave,
reconnect, permission denial and closure), actual SMS approval/rejection, email
receipt, browser push permission/background receipt, and the unattended scheduler
with 24-hour/10-minute appointments and cancellation. Review retention and privacy
terms before launch. Persistent recordings require a separate explicit decision
on consent, storage and retention, and must use App Storage for durable files.
