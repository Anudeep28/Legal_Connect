---
name: External webhook access
description: Avoid false-positive callback reachability checks against private Replit development URLs.
---

Verify callback reachability from an independent unauthenticated external client,
not only from a shell inside the workspace. Keep payment verification gates closed
until an actual signed provider event is accepted by the intended environment.

**Why:** This project's private Preview returned a successful health response to
in-workspace requests while an external fetch received Replit's private-app login
page. Razorpay payments could succeed through browser verification without any
webhook request reaching the API.

**How to apply:** For private Preview callbacks, use a short-lived
Development-scoped external access token configured privately with the provider.
First check whether token controls are available: Replit's development-URL
documentation says they appear only after the first publish with deployment
access set to Private. Do not send an unpublished-app owner repeatedly to
missing Publishing controls or assume a token was created from a confirmation.
If unavailable, explain the prerequisite and obtain informed consent before
publishing or temporarily making the running development preview public.
Consult current Replit documentation for the header or query-parameter syntax.
Never persist tokens or token-bearing URLs in chat, source, screenshots, memory,
or logs. Do not make the project public by default. The infrastructure access
token is separate from the provider's webhook signing secret; both restrictions
remain relevant. Token expiry ends external callback access, and production needs
its own endpoint and environment-specific verification.
