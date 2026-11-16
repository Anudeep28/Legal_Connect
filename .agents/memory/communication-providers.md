---
name: Communication providers
description: Owner's provider selections and the condition for choosing the calling provider.
---

Use Resend for email and Twilio for optional SMS phone verification. For calls, first check which provider the original GitHub repository used; use Twilio if that provider is not good enough.

**Why:** The owner selected these services and explicitly asked to evaluate the original repository's calling provider before replacing it.

**How to apply:** Establish the original repository's provider and suitability before committing to the call integration. Provider selection is not evidence that credentials are connected or that live delivery works.

The original repository is https://github.com/Anudeep28/law_consultation. Inspection found randomly generated public `meet.jit.si` meeting links, not a participant-authenticated calling integration. Its Socket.IO code handles chat; ElevenLabs handles transcription, not calls.

**Why:** A hard-to-guess meeting link does not enforce this app's client/assigned-lawyer access rules. Twilio is the owner's authorized fallback for this gap; this is not a claim that Jitsi itself cannot support authenticated deployments.

**How to apply:** Do not carry over public meeting links as secure consultation calling or mistake transcription for a call provider.

The owner dismissed both the Twilio and Resend connection cards and said to
continue without each integration. Prepare the implementation without requesting
replacement credentials or pretending the services are active.

**Why:** The owner explicitly chose to proceed without connecting provider accounts.

**How to apply:** Leave activation gated, distinguish synthetic tests from live
verification, and offer connection again only when the owner is ready to activate.

For call-to-document work the owner chose “Opt-in post-call transcript” and “Build now, keep disabled,” and requested policies describing call recording with consent.

**Why:** Building the capability and revising disclosures are not permission to start recording real consultations.

**How to apply:** Preserve default-off recording until separately authorized. Keep transcript review and explicit lawyer-controlled document delivery; validate a controlled provider call before claiming live readiness.
