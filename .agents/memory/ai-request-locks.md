---
name: Cross-instance AI request locks
description: The design constraints for serializing lawyer AI work across API instances.
---

Use short PostgreSQL row leases keyed by lawyer account, with an opaque token per acquisition and database-clock expiry. Release only the matching token. Fail closed if the shared lock store is unavailable, and keep the lease longer than the bounded provider request. Do not hold a pooled database session open during external provider calls.

**Why:** A session advisory lock would keep a database connection occupied for the full provider request and could starve normal application queries. Expiring rows recover after an API instance crashes, while token-conditional release prevents an old request from deleting a newer lease.

**How to apply:** Keep all AI-writing and transcription provider calls behind the shared lease, acquire it before usage reservation/provider invocation, and update its duration if provider timeouts change. Verify behavior with independent router instances using shared PostgreSQL and an expired-lease recovery test.
