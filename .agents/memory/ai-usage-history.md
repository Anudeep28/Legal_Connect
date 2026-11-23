---
name: AI usage history
description: Accurate plan attribution and privacy boundaries for lawyer-facing AI request history.
---

Historical plan attribution cannot be reconstructed from a lawyer's current subscription or credit balance. Record the plan applied with each daily request counter, show every plan used if it changes within a day, and mark older unsnapshotted counts as incomplete rather than guessing.

**Why:** The account record keeps current plan state, not a subscription history; showing today's plan as an old plan would be misleading.

**How to apply:** Any extension to AI usage reporting should remain account-scoped and contain only operational counts and plan metadata, never prompts, transcripts, or case facts.
