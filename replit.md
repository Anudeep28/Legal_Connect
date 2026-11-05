# Consult with Lawyer

Indian lawyer discovery, consultation requests, messaging, document drafting, and role-specific client, lawyer, and admin workspaces.

## Product direction and boundaries

- Read `.agents/memory/product-scope.md` for the owner's direction on product provenance and the boundary with the existing live service before any import or migration.
- This is currently a pilot. Seeded profiles are fictional, marked illustrative, and have no practitioner attached. Do not imply real verification, ratings, presence, appointments, or advice.
- Booking saves an unpaid request; it does not collect payment. Real profile owners can accept pilot requests. Example profile requests cannot connect to a real lawyer.
- Calls, Razorpay checkout, SMS verification, outbound email, browser push, and automated reminders are **not connected**. The UI and API must not simulate success.
- Clerk handles sign-in and email verification. App roles and resource ownership are enforced by the API, never client-selected or granted to the first visitor.
- AI drafts/translations are preliminary and require advocate review. Original templates include historical legislation; statutory applicability must be checked before use.

## Run and check

- API workflow: `artifacts/api-server: API Server`
- Web workflow: `artifacts/consult-lawyer: web`
- Canvas remains a separate pre-existing mockup service; it is not the app.
- `pnpm run typecheck` — all packages.
- `pnpm --filter @workspace/api-spec run codegen` — regenerate clients and validators after contract changes.
- `pnpm --filter @workspace/db run push` — development schema only.
- `pnpm --filter @workspace/api-server run seed` — explicitly add example profiles, idempotently. Never seed automatically in production.
- `pnpm --filter @workspace/api-server run grant-admin -- <owner-designated-email>` — grant admin to an existing verified Clerk account in the current environment. Never infer the owner email or assign a default password. Development and production identities are separate.

## Structure and sources of truth

- `artifacts/consult-lawyer/` — React/Vite frontend, public marketplace, auth, consultation, editor, and admin routes.
- `artifacts/api-server/src/routes/` — domain routes: marketplace, account, consultations, documents, admin, writing.
- `artifacts/api-server/src/middlewares/access.ts` — Clerk/local-account bridge, role checks, same-origin write protection, sanitized error handler.
- `artifacts/api-server/src/lib/legal.ts` — shared consultation access, directory aggregation and IST slots.
- `artifacts/api-server/src/data/` — actual templates and language definitions reused from the owner's repository.
- `lib/api-spec/openapi.yaml` — API contract; `@workspace/api-client-react` and `@workspace/api-zod` are generated.
- `lib/db/src/schema/` — isolated pilot PostgreSQL schema via Drizzle. Do not replace or migrate the original app's Prisma database.
- `lib/integrations-openai-ai-server/` — managed OpenAI integration client and audio conversion utilities.

## Core behavior

- Public discovery: legal area, name/city, language, availability, fee/experience/rating sort, full profiles, visible reviews and IST half-hour slots.
- Booking: snapshot fee in INR for a 30-minute consultation, optional 50% document package, unique active lawyer/time slot, participant-only access and cancellation.
- Consultation: role-scoped requests, lawyer acceptance/completion, 4-second message polling, editable lawyer transcript, lawyer draft/delivered documents, client sees delivered documents only. Closed chats are read-only.
- Reviews: only the client of a completed **non-demo** consultation, one review per consultation; ratings aggregate visible reviews.
- Lawyer application: credentials submitted for manual review; credential edits revoke approval, weekday/online changes do not. Pending applicants may use document drafting.
- Documents: create, edit, duplicate, delete, templates with field filling, Markdown preview, PDF/DOCX/Markdown export, AI assistance and recorded-audio transcription.
- Trial: new-document creation and duplication are allowed for two days from account creation, then require document credits. Existing-document editing/export remains available. Paid plans cannot activate without a real verified payment integration.
- Notifications: persisted in-app events, read state and account email preference (preference is not email delivery).
- Admin: overview, lawyer approval/rejection, user suspension/reactivation, review moderation, required reasons and audit log. Suspending a lawyer unpublishes the profile.

## Integration details and gotchas

- Use managed artifact workflows, not root `pnpm dev` or duplicate service commands.
- Browser API calls use same-origin Clerk session cookies, not manually added bearer tokens.
- Clerk production proxy is `/api/__clerk`, mounted before body parsing. Keep canonical host-derived publishable-key wiring.
- Queries return values directly, not an envelope. Invalidate affected caches after mutations, and clear account caches when identity changes.
- All consultation times display in `Asia/Kolkata`. API slot dates use `YYYY-MM-DD`; stored instants use ISO timezone-aware timestamps.
- The slot endpoint puts date in the path to avoid conflicting generated parameter exports.
- AI requires managed OpenAI integration variables; usage is billed to Replit credits. Limit AI operations by authenticated account and do not log legal text or SQL parameter errors.
- Audio is processed transiently and deleted after conversion, not stored as base64 in PostgreSQL. Persistent future uploads require App Storage.
- No database DDL or seeding on server startup. Replit's publish flow handles managed production schema changes.

## Launch prerequisites

Before offering real paid legal services: designate the owner admin account, onboard and verify real lawyers, connect and verify Razorpay payments and subscription entitlements, connect calls and notification delivery, review legal/privacy/refund terms and professional advertising rules with qualified counsel, and exercise signed-in multi-role workflows end to end.
