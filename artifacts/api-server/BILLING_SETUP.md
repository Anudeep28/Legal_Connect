# Razorpay setup for the separate legal app

## Current state

Dedicated Razorpay credentials and a webhook signing secret have been added.
General checkout remains disabled; `RAZORPAY_CHECKOUT_VERIFIED_MODE` is unset.

### Published endpoint

On 2026-11-14 the owner published the app at
`https://legal-connect-hub.replit.app`. Deployment metadata confirmed a successful
public build. `/api/healthz` returned HTTP 200 with `{"status":"ok"}`, and an
unsigned POST to `/api/billing/webhook` returned HTTP 400 with
`Invalid webhook signature.` This proves public routing and signature rejection,
not successful provider delivery. `/api/platform` reported checkout disabled.
A read-only production query found the existing new-account Test payment order,
but no accepted payment events. Update the matching Razorpay Test webhook to the
published endpoint without a Preview bypass token, then verify actual delivery.
No Live checkout has been enabled or verified.

### Owner access after first publish

Preview and Production Clerk identities differ, even for the same verified
email. An imported Preview admin row does not authorize the production identity.
The owner reported the admin verification panel was missing, and production
contained both an admin and a client record for the designated email.

`OWNER_ADMIN_BOOTSTRAP_EMAIL` is configured in production only. On startup,
the server resolves that email against its current Clerk instance, requires
one matching verified primary email, and grants the target active client
identity admin access with an audit record. It preserves existing credits,
orders, and other identities. It refuses suspended and lawyer accounts.
The audit marker makes the grant one-time per target identity: restarts do not
restore deliberately revoked privileges. Remove the configuration after the
production grant is confirmed. No HTTP endpoint accepts an admin role override.

This change requires a republish. Until the new startup code has run in
production and the designated owner has refreshed their account, do not
claim production administrator access is fixed.

Verification on 2026-11-14, against the separate app's development environment:

- After the owner replaced the credentials with the webhook account's Test keys,
  provider authentication succeeded. A new ₹10 validation order created at
  09:27 UTC was paid: browser signature verification returned HTTP 200, and an
  independent provider lookup confirmed capture, matching order, INR currency,
  and 1000-paise amount. Existing payment records were preserved.
- The owner reported that the protected health URL returned JSON in a private
  browser after adding Development access. Nevertheless, after the new purchase,
  no webhook POST appeared in application logs and no accepted payment event
  was recorded. Inspect the provider's latest delivery attempt and response;
  do not request another purchase merely to diagnose missing delivery.
- The owner subsequently found delivery logs: both `payment.captured` and
  `order.paid` retries returned HTTP 403. No corresponding webhook requests
  appeared in API logs. The webhook is mounted before Clerk and CSRF middleware;
  invalid signatures return 400, not 403. The evidence points to rejection
  before the application. Inspect the failed delivery's response body to
  identify the rejecting access layer before changing payment credentials.
- The actual Razorpay API confirmed the administrator's ₹10 Test Mode purchase
  was captured for the matching stored order, amount, and currency.
- The unused validation purchase was fully refunded through the app's normal
  refund logic. Razorpay returned a processed refund, the app recorded
  `refunded`, and its test document credit was withdrawn. No real funds moved.
- All 14 isolated billing tests passed. They use synthetic provider responses;
  they are not evidence of Razorpay-originated webhook delivery.
- An in-workspace request reaches the webhook route and receives HTTP 400 for
  an unsigned payload, as intended. However, an independent external request
  reaches Replit's "Log in to access a private app" page instead of the API.
  This earlier check established that the private development access gate can
  block provider delivery before the application can log or validate it.
  See "Private Preview access" below.
- The owner-provided webhook screenshot shows the expected endpoint, enabled
  status, and required event subscriptions. Its Test/Live mode is not visible.
  No accepted Razorpay event has yet been recorded in this app's development
  database. Keep checkout disabled until a provider-originated signed event
  reaches the app after external access is configured.

Do not mark verification complete or enable checkout based only on a captured
payment, processed refund, dashboard settlement status, or a locally fabricated
webhook. A real Razorpay-sent signed event must reach this app successfully.
Production and Live Mode have not been verified.

Do not connect this app to the original live app's credentials, webhook, or
database. Nothing here requires changes to the original service.

## Private Preview access

Do not assume an in-workspace health check proves that Razorpay can reach a
private development URL. Test from an independent unauthenticated client.

To keep Preview private, the owner can create a short-lived external access
token in Publishing settings, under Security, scoped to **Development**.
These controls require a first publish with deployment access set to Private,
according to Replit's development-URL documentation. They were unavailable
during the earlier unpublished phase. The owner has since published publicly;
the published webhook endpoint does not need a Replit access token.
Temporarily disabling Private preview still requires the owner's informed
approval; keep Preview private when using the published endpoint.
Prefer an `Authorization: Bearer` header where the sending service supports
custom headers. For a URL-only webhook configuration, Replit also supports
appending `?project-protection-bypass=<development-token>` to the webhook URL.
Configure that token-bearing URL privately in Razorpay; never store its actual
value in source, documentation, chat, screenshots, or logs.

The token allows its holder to reach the private project's development
endpoints, not only the webhook route. App authentication and Razorpay signature
validation still apply. Use the shortest practical expiry, revoke after testing,
and remember that webhook access stops when it expires. This access token is
separate from `RAZORPAY_WEBHOOK_SECRET`; do not replace the signing secret with it.
Do not make the project public without the owner's informed approval.

After access is configured, replay an existing Test Mode event or use an
existing unused test purchase for a controlled refund. No additional payment is
needed just to diagnose this access restriction.

Official instructions:
https://docs.replit.com/features/deployment-customization/external-access-tokens

## Secure configuration, when the owner is ready

1. Use secure secret collection to add dedicated `RAZORPAY_KEY_ID`,
   `RAZORPAY_KEY_SECRET`, and `RAZORPAY_WEBHOOK_SECRET`. Start with test-mode keys.
   Do not put secrets in chat, source files, client bundles or logs.
2. Configure a dedicated Razorpay webhook for this app at
   `https://<this-app-host>/api/billing/webhook`, using the matching signing secret.
   For deployment, obtain the actual published URL through the deployment tools;
   do not copy the original app's URL or assume the preview URL is production.
3. Subscribe to `payment.captured`, `order.paid`, `refund.created`,
   `refund.processed`, and `refund.failed`. Configure automatic payment capture
   in Razorpay. Authorized-only payments never grant entitlements.
4. Keep `RAZORPAY_CHECKOUT_VERIFIED_MODE` unset. Add an owner-designated admin
   using the existing grant-admin procedure, not a client-selected role.
5. Signed in as admin, open Plans and explicitly approve **Verify Razorpay
   (admin)**. This is a dedicated ₹10 single-credit validation purchase and
   bypasses the general-checkout gate only for administrators. With live keys,
   this charges real money; obtain the owner's approval before doing so.
6. Verify the real provider flow, not just the browser success message:
   - Razorpay created the order in the correct dedicated account and mode.
   - Payment is captured for the exact INR amount and stored order reference.
   - Browser signature validation succeeds; altered signatures are rejected.
   - Signed webhook delivery succeeds against the raw-body endpoint.
   - Repeated verification and webhook delivery grant only one credit.
   - Payment history survives refresh and Check status recovers a closed browser.
   - Refund the unused validation credit; confirm provider processing, webhook
     delivery and the final refunded state without duplicate refunds.
   - Confirm owner-approved real-lawyer consultation payment/acceptance and
     document entitlements with controlled accounts before wider availability.
7. Only after these checks pass, set the non-secret
   `RAZORPAY_CHECKOUT_VERIFIED_MODE` to the verified mode (`test` or `live`) using
    the environment-variable tools. Preview Test Mode verification belongs in
    the development environment only; keep production unset until its own
    verification passes. Restart the managed API workflow. A mode mismatch or
    missing credentials/webhook secret keeps checkout disabled.
8. Live mode needs its own verification. Test payments and test entitlements
   must not be mistaken for real revenue. Use isolated test accounts/data and
   explicitly review outstanding test entitlements before switching environments;
   do not delete or migrate user data without approval.

## Implemented rules

- ₹10 buys one new/duplicated document. ₹499 buys 30 days of unlimited new
  documents, without automatic renewal. Trial lasts exactly two days from account
  creation. Editing and exporting existing documents remains available.
- Real consultations are saved unpaid, become pending when an order exists, and
  become paid only after a verified capture. Payment does not accept the booking
  on the lawyer's behalf. Demo profiles cannot collect payments.
- Owner's ordinary consultation refund rule: lawyer cancellation only. A late
  capture for a cancelled/expired request is treated as unavailable service and
  refundable, not fulfilled. Mandatory statutory remedies are not excluded.
- Unused document purchases, including an unused activated 30-day plan, are
  refundable within seven days. Usage and refunds lock the account so both cannot
  consume the same entitlement.
- Clients retain rights to their legal content. Platform/template ownership is
  distinct. Have legal counsel review the published policy drafts and business
  contact details before accepting paid engagements.

## Recovery and limitations

- Pending payments can be resumed or checked in Payment history. Failed or
  authorized attempts do not grant access; a captured payment is required.
- Refund access is reserved/revoked before the external request. On a timeout,
  subsequent checks look for the original refund rather than submitting another.
  If no definitive result is found, the record stays refund pending and needs
  owner reconciliation in Razorpay. A definitive failed refund restores access.
- Full-refund webhooks are supported. Partial refunds are explicitly rejected
  for owner reconciliation rather than silently applying an incorrect entitlement.
  Avoid manual partial refunds in the provider dashboard until their entitlement
  effect has been reviewed.
- Suspended users cannot access account endpoints; the owner must handle their
  statutory refund requests directly. Financial records are not deleted with
  documents. Do not log legal content, card details, signatures or raw webhooks.
- Automated local verification:
  `pnpm --filter @workspace/api-server run test:billing` against the isolated
  development database. It uses disposable fixture accounts and mocked network
  responses. Never run this against the original live database or production.
