---
name: Object storage library version
description: Why the Google Cloud Storage client is pinned to v7 in the API server.
---

Keep @google-cloud/storage on v7 (with google-auth-library v9).

**Why:** v9 treats the empty projectId used by Replit's storage sidecar as missing and fails on metadata reads ("Unable to detect a Project Id"), even though signed-URL uploads still succeed — so the failure only shows up at the confirm step.

**How to apply:** Do not upgrade it as part of routine dependency bumps; if upgrading, re-test an upload + metadata read + delete round trip.
