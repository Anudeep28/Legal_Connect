---
name: GitHub sync instructions
description: The owner's branch preference and the separate-app boundary when syncing this project.
---

The user instructed: "after that always sync the changes to main. do not create any branch".

**Why:** The user asked after reviewing the separate backup branch.

**How to apply:** Sync future completed changes directly to the chosen repository's main branch without creating branches. Do not force-push or discard concurrent remote work.

The linked original-app repository and this separate successor have unrelated Git histories. Connecting a remote did not make them versions of the same source tree.

**Why:** The original app must remain untouched under the user's separate-version decision; a normal merge does not safely combine these applications.

**How to apply:** Obtain explicit approval before replacing the original repository's main tree or moving the old app. Do not treat the request to sync as approval to replace a separate application.
