# Razorpay setup for the separate legal app

## Current state

The owner has deferred adding Razorpay credentials. General checkout must remain
disabled. Automated tests use synthetic provider responses; they are not evidence
of a real Razorpay payment, capture, refund, or webhook.

Do not connect this app to the original live app's credentials, webhook, or
database. Nothing here requires changes to the original service.

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
   the environment-variable tools. Restart the managed API workflow. A mode
   mismatch or missing credentials/webhook secret keeps checkout disabled.
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
