---
name: Lawyer presence rollout
description: Migration and display rules for the lawyer's manually selected Online, Offline, or In court presence.
---

Keep presence manually controlled. Profiles that predate presence fields default to Offline rather than being shown as Online based on an old availability flag; that avoids implying current availability without a fresh status selection. Preserve existing lawyer rows and the legacy boolean during additive schema rollout.

**Why:** The owner requested explicit statuses and a safe default for existing profiles, without inferring presence from location, calendars, or court records.

**How to apply:** When changing the presence data model or migrating older deployments, keep client-facing status explicit and preserve existing profile data; remove the legacy boolean only through a separately planned compatibility migration.
