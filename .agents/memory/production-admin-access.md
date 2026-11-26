---
name: Production administrator identities
description: Provision owner admin access using the current environment's verified identity, without restoring revoked grants.
---

Resolve the designated owner through the target environment's verified primary
email. Never infer production privileges from an imported Preview admin record
or assume one email identifies the same Clerk user across environments.

**Why:** After publishing, the owner saw no admin verification panel even though
an old admin record existed. A separate client identity for the same email was
present in production, so checking the historical payment owner gave a
misleading confirmation of current access.

**How to apply:** Use the existing application role store and a target-environment
owner bootstrap, not copied Clerk IDs, metadata-only roles, or direct production
database mutations from the workspace. Require verified ownership, preserve
unrelated data, and audit one-time grants so restarts cannot restore a revoked
role. Production changes require republishing and confirmation against the
actual signed-in production identity.
