---
name: GitHub sync instructions
description: The owner's branch preference and the separate-app boundary when syncing this project.
---

The user instructed: "after that always sync the changes to main. do not create any branch".

**Why:** The user asked after reviewing the separate backup branch.

The target repository is `Anudeep28/Legal_Connect`; do not use `Anudeep28/law_consultation` for this successor.

**Why:** The user corrected the repository URL after an initial comparison against the wrong repository.

**How to apply:** Sync future completed changes directly to `Legal_Connect`'s `main` branch without creating branches. Do not force-push or discard concurrent remote work.

The user chose MIT for `Legal_Connect` when syncing this version.
The selected MIT copyright-holder line is `Eneru OPC`.

**Why:** The user selected MIT after being shown that the current repository declares Apache-2.0 while the Replit snapshot declares MIT.

**How to apply:** Keep the repository metadata and root `LICENSE` consistently MIT, using the confirmed holder name.

The original app remains a separate product and its live data must not be reused without renewed approval.

**Why:** The user chose a separate version rather than sharing existing live data.

**How to apply:** Keep `law_consultation` untouched unless the user explicitly asks for work there.
