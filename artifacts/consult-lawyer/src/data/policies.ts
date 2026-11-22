// NOTE: These policies are drafted for production use on the Consult with Lawyer platform.
// Have them reviewed by qualified legal counsel for your specific business entity
// before going live. Update the company name, address, and contact details below.

export type PolicyReviewStatus = 'approved' | 'pending-review';

export type PolicyRevision = {
  revisionId: string;
  effectiveDate: string;
  reviewStatus: PolicyReviewStatus;
  reviewedFingerprint?: string;
  content: string;
};

// Treat each entry as an immutable published revision. To change wording, append
// a new entry with a new revisionId and effectiveDate; never overwrite an older
// revision. New revisions must start as pending-review until counsel reviews them.
// A reviewed fingerprint prevents edited wording from inheriting an old approval.
export function policyTextFingerprint(content: string): string {
  let hash = 0xcbf29ce484222325n;
  for (const byte of new TextEncoder().encode(content)) {
    hash ^= BigInt(byte);
    hash = BigInt.asUintN(64, hash * 0x100000001b3n);
  }
  return hash.toString(16).padStart(16, '0');
}

export const policyRevisionHistory: Record<string, PolicyRevision[]> = {
  terms: [{
    revisionId: 'terms-2026-11-17',
    effectiveDate: '2026-11-17',
    reviewStatus: 'approved',
    reviewedFingerprint: 'b79d71163c4d7050',
    content: `TERMS OF SERVICE

Last updated: 17 November 2026

These Terms of Service ("Terms") govern your use of the Consult with Lawyer platform ("Platform"), operated by Eneru Technologies ("Company", "we", "us"). By creating an account or using any part of the Platform you agree to be bound by these Terms. If you do not agree, do not use the Platform.

1. DEFINITIONS

"Client" means an individual who registers on the Platform to consult lawyers or receive legal documents.
"Lawyer" means a legal practitioner enrolled with a State Bar Council under the Advocates Act, 1961, who registers on the Platform to offer consultations.
"Consultation" means a time-bound chat or video-call session booked through the Platform between a Client and a Lawyer.
"Document" means any legal draft, template, or file created, generated, or delivered through the Platform.

2. ELIGIBILITY

You must be at least 18 years of age and legally competent to enter into a contract under the Indian Contract Act, 1872. Lawyers must hold a valid enrolment with a State Bar Council and must not be under suspension or debarment.

3. ACCOUNTS AND VERIFICATION

3.1. You must provide accurate information during registration. We verify Lawyer credentials (Bar Council enrolment number) before publishing their profile.
3.2. You are responsible for maintaining the confidentiality of your login credentials. Notify us immediately if you suspect unauthorized access.
3.3. We may suspend or deactivate accounts that provide false information or violate these Terms.

4. PLATFORM SERVICES

4.1. Consult with Lawyer provides: (a) optional AI-powered speech-to-text transcription for legal document creation; (b) pre-built Indian legal document templates; (c) a marketplace connecting Clients with verified Lawyers for paid consultations; (d) AI-assisted document drafting from consultation transcripts; and (e) when enabled, an optional call-recording and transcription workflow subject to the separate consent requirements in these Terms and the Privacy Policy.
4.2. The Platform is a technology intermediary. We do not practise law and do not provide legal advice.
4.3. AI-generated content (transcriptions, drafts, translations) is assistive only. Lawyers are responsible for reviewing, editing, and verifying all documents before use.

5. CONSULTATIONS

5.1. Consultations are private sessions between a Client and a Lawyer. The Company is not a party to any professional engagement arising from a consultation.
5.2. Whether a consultation gives rise to an advocate-client relationship is determined solely by the applicable provisions of the Advocates Act, 1961, and Bar Council of India Rules. The Platform does not create such a relationship by itself.
5.3. Lawyers set their own fees. The total fee (including any document add-on) is displayed before booking and processed via Razorpay.
5.4. Saving a request does not charge you or confirm an appointment. Paid consultation checkout remains closed until Razorpay verification and qualified-counsel approval of the current policies and contact details are recorded. Once checkout is enabled, a real lawyer can accept only after payment is captured and verified by the server. Illustrative profiles cannot accept payments. Calling and recording features are available only when enabled by the Company.
5.5. Call recording is optional and is not a condition of booking or joining a consultation. If the recording feature is enabled, recording starts only after both the Client and Lawyer give separate, affirmative consent for that consultation. If either participant declines, the call may proceed without recording. A participant may withdraw consent during a call; the recording must then stop, and any unprocessed audio is not used to create a transcript. A transcript may be created from the recording and is initially private to the assigned Lawyer. The Client receives a document only if the Lawyer reviews and explicitly publishes it. Do not include information in a recorded call that you do not want processed for transcription.

6. PAYMENTS AND SUBSCRIPTION

6.1. Paid consultation checkout opens only after both Razorpay verification and qualified-counsel approval of the current policies and contact details are recorded. Lawyer document-plan checkout opens only after Razorpay verification. Payments are processed through Razorpay in Indian Rupees (INR). Adding credentials does not by itself enable checkout. Test-mode payments are labelled and do not transfer real funds.
6.2. Document plans for lawyer accounts: (a) a 2-day trial from account creation; (b) one document credit at ₹10; (c) ₹499 for 30 days of unlimited new documents. A duplicate counts as a new document. Editing and exporting existing documents does not consume credits and remains available after expiry. AI service availability and any separate usage charges are not a guarantee of unlimited AI use.
6.3. These are one-time purchases, not automatically recurring subscriptions. Payment does not replace lawyer acceptance or establish a professional engagement by itself.
6.4. All prices are inclusive of applicable taxes unless otherwise stated.
6.5. See the Refund & Cancellation Policy for cancellation and refund terms.

7. INTELLECTUAL PROPERTY

7.1. The Platform, its software, design, and branding are the intellectual property of the Company.
7.2. Clients retain rights to their legal content, including supplied facts, consultation content, call recordings and transcripts, and documents created for or delivered to them, subject to applicable law and third-party rights. The Company does not acquire ownership of client legal content. You grant a limited licence to store, process and transmit content solely to provide the requested service, including recording and transcription only when both consultation participants have opted in. Private consultation content is available only to the participants and authorized administrators as needed to administer the service; private lawyer workspace drafts remain accessible only to their account owner. Published templates and the Platform software remain separate from client content.
7.3. Templates provided on the Platform may be used for your legal practice but may not be redistributed or resold.

8. PROHIBITED CONDUCT

You shall not: (a) use the Platform for any unlawful purpose; (b) upload malicious code; (c) impersonate another person or entity; (d) scrape, harvest, or bulk-download Platform content; (e) circumvent payment mechanisms; (f) use AI-generated documents without professional review where court filing or regulatory compliance is involved.

9. LIMITATION OF LIABILITY

9.1. The Platform is provided "as is". To the maximum extent permitted by law, the Company disclaims all warranties, express or implied.
9.2. The Company shall not be liable for: (a) the quality, accuracy, or outcome of legal advice provided by Lawyers; (b) errors in AI-generated transcriptions, drafts, or translations; (c) any indirect, incidental, or consequential damages arising from use of the Platform.
9.3. Our aggregate liability for any claim shall not exceed the amount paid by you to the Company in the 12 months preceding the claim.

10. INDEMNIFICATION

You agree to indemnify the Company against claims, damages, and expenses arising from: (a) your violation of these Terms; (b) your use of documents generated through the Platform; (c) any dispute between a Client and a Lawyer.

11. TERMINATION

11.1. You may delete your account at any time by contacting support.
11.2. We may suspend or terminate accounts for violation of these Terms, with notice where practicable.
11.3. Upon termination, your right to access the Platform ceases. Documents already exported remain with you.

12. GOVERNING LAW AND DISPUTE RESOLUTION

12.1. These Terms are governed by the laws of India.
12.2. Any dispute shall first be attempted to be resolved through mediation. If mediation fails, disputes shall be subject to the exclusive jurisdiction of the courts at New Delhi, India.

13. CHANGES TO TERMS

We may update these Terms from time to time. Material changes will be notified via email or in-app notice. Continued use after the effective date constitutes acceptance.

14. CONTACT

For questions about these Terms, contact us at support@consultwithlawyer.in.`,
  }],

  privacy: [{
    revisionId: 'privacy-2026-11-17',
    effectiveDate: '2026-11-17',
    reviewStatus: 'approved',
    reviewedFingerprint: 'ca79c139cf7677a1',
    content: `PRIVACY POLICY

Last updated: 17 November 2026

This Privacy Policy explains how Eneru Technologies ("Company", "we", "us") collects, uses, stores, and protects your personal data when you use the Consult with Lawyer platform ("Platform"). This policy is drafted in accordance with the Digital Personal Data Protection Act, 2023 ("DPDP Act"), the Information Technology Act, 2000, and the Information Technology (Reasonable Security Practices and Procedures and Sensitive Personal Data or Information) Rules, 2011.

1. DATA FIDUCIARY

The Company acts as a Data Fiduciary under the DPDP Act. Our contact details:
Email: privacy@consultwithlawyer.in
Address: Amanora Park Town, Amanora Gold Tower, Tower 42, Flat 1012, Hadapsar, Pune 411028

2. PERSONAL DATA WE COLLECT

2.1. Information you provide:
- Account details: name, email address, and, if you choose optional phone verification when it is available, your verified mobile number. Clerk handles sign-in credentials; this Platform does not store account passwords.
- Lawyer credentials: Bar Council name, enrolment number, practice areas, experience, fee, professional biography
- Consultation content: topics, booking notes, chat messages, discussion summaries or transcripts entered by a user, and documents you create, edit, or receive
- Dictation audio: audio you choose to record in your browser is sent to the Platform for transcription. It is processed for that request and is not intentionally retained by the Platform as an audio recording. When audio conversion is needed, temporary server files are removed after conversion. The resulting transcript may be saved in a document if you choose to use or save it.
- Call recording and transcription data (only when that feature is enabled and both participants consent): audio tracks from the consultation call, the resulting transcript, and records of each participant's consent or withdrawal. Recording is disabled by default. Transcription is performed by ElevenLabs through a Replit-managed connector; the assigned Lawyer can edit the transcript, which remains private unless used in a document the Lawyer explicitly publishes.
- Documents: legal documents you create, edit, or receive
- Payment details: the Platform stores order and transaction references. If checkout is enabled, Razorpay handles payment credentials; the Platform does not intentionally store card or bank numbers.

2.2. Information collected automatically:
- Operational request information, such as request identifiers, methods, paths, and response status, used to operate and troubleshoot the service. Page-view and advertising analytics are not configured in the current application.

3. PURPOSE OF PROCESSING

We process your personal data for the following purposes under the DPDP Act:
- To provide, maintain, and improve the Platform
- To authenticate accounts through Clerk and maintain the corresponding Platform account
- To verify Lawyer credentials and manage account approvals
- To process payments through Razorpay if checkout is enabled
- To create in-app notifications and reminders 24 hours and 10 minutes before confirmed, paid consultations. A 24-hour reminder is created only when the booking is confirmed in time. Email and browser push are optional and require both user opt-in and service configuration; provider acceptance does not guarantee arrival. No SMS appointment reminders are sent.
- To provide optional Twilio phone verification or audio calls when those features are enabled
- If call recording is enabled, to record and transcribe a consultation only after both participants have separately consented for that call; if either declines or withdraws consent, recording will not start or will be stopped
- To generate AI-assisted document drafts and translations from text you submit, using DeepSeek when configured
- To transcribe dictation audio you submit, using ElevenLabs through a Replit-managed connector when configured
- To respond to support requests
- To comply with legal obligations

4. CONSENT

4.1. By creating an account, you provide consent for the processing described in this policy.
4.2. You may withdraw consent at any time by contacting us at privacy@consultwithlawyer.in. Withdrawal does not affect the lawfulness of processing done before withdrawal.
4.3. Certain processing is necessary for performing the contract (providing the service) and cannot be opted out of while using the Platform.
4.4. Call recording requires a separate affirmative choice from both the Client and Lawyer for each consultation. Consent to use the Platform or join an audio call is not consent to record it. If either participant declines, the call can continue without recording. Either participant may withdraw consent during the call; recording will be stopped and the call may continue without recording if technically available. The consent choice and its time may be retained to document the choice and operate the service.

5. DATA SHARING

5.1. With Lawyers/Clients: Consultation details, chat messages, and deliverables are shared between the parties to a consultation as necessary to provide the service.
5.2. Payment processor: Paid consultation checkout remains disabled until Razorpay verification and qualified-counsel approval of the current policies and contact details are recorded. If enabled, Razorpay processes payments; its public buyer privacy notice is at https://razorpay.com/buyer-privacy-notice. That notice describes sharing with affiliates and service providers but does not establish the region or a service-specific retention period for this Platform's payment flow. The Platform stores order and transaction references, not card or bank numbers. We will verify the applicable Razorpay terms and settings before enabling checkout.
5.3. AI services: When configured and used, text you submit for drafting or translation is sent to DeepSeek. DeepSeek's general Privacy Policy says it processes and stores personal data in the People's Republic of China, may use personal data to improve and train its technology, and retains information based on account status, purpose, and legal or business needs. Its Open Platform Terms say the submitter retains any rights in submitted Inputs and DeepSeek assigns rights in Outputs, but do not establish API-specific storage locations, retention periods, or a no-training commitment. It is not clear that the general Privacy Policy's statements apply in the same way to API requests; therefore, do not assume that API inputs are excluded from model improvement or promptly deleted. See https://cdn.deepseek.com/policies/en-US/deepseek-privacy-policy.html and https://cdn.deepseek.com/policies/en-US/deepseek-open-platform-terms-of-service.html.

Dictation audio you submit is sent to ElevenLabs through a Replit-managed connector for transcription. ElevenLabs says standard customer data is stored in the United States; Enterprise customers can use isolated storage locations in the United States, European Union, India, or Singapore, but processing may still occur outside a selected location. Its Speech-to-Text API enables logging by default; zero-retention mode is an Enterprise feature, and this Platform's request does not select it. ElevenLabs' Terms grant a broad license to use Content to provide and improve services and develop new services and products. They provide an account-level opt-out for future use after the request is processed; that does not undo earlier use. The connected account's applicable terms and opt-out setting have not been confirmed. Its Privacy Policy describes retention as necessary for service and legal purposes and says voice data it generates is not kept longer than three years after the last interaction, subject to exceptions. These published terms do not establish a specific deletion period for this Platform's audio requests. See https://elevenlabs.io/docs/overview/administration/data-residency, https://elevenlabs.io/docs/api-reference/speech-to-text/convert, https://elevenlabs.io/terms-of-use, and https://elevenlabs.io/privacy-policy.

The Platform does not send all consultation content to an AI service automatically. The Replit connector acts as an intermediary for ElevenLabs requests; the public connector information reviewed does not establish the request-content processing location or retention period. See https://docs.replit.com/features/integrations/overview. We do not promise that any AI provider uses submitted content only on our instructions, that provider logging or model improvement is disabled, or that a particular region or deletion period applies.
5.4. Authentication: Clerk provides account sign-in and manages sign-in credentials. The Platform receives account identifiers and verified account information needed to operate your Platform account; it does not store your account password. Clerk's published Data Processing Addendum says it processes Customer Personal Data to provide the services under the agreement, while it may process account information as a separate controller for account administration and permitted service operations. It allows processing wherever Clerk or its subprocessors maintain facilities and provides for deletion of remaining Customer Personal Data within 90 days after the applicable agreement ends. This is not a per-record retention schedule, and the region and specific agreement applicable to this Platform's Clerk tenant have not been confirmed. See https://clerk.com/legal/dpa.
5.5. Optional communications and call recording: If enabled, Twilio may process your phone number for verification, carry audio-call traffic, and store call audio tracks when both participants consent to recording. If call recording is enabled, ElevenLabs may process those audio tracks to produce a transcript. The transcript is not sent to DeepSeek automatically; a Lawyer must separately request AI drafting from consultation content. Resend may process your email address for opted-in email notifications. Browser push uses the applicable browser/push service. These services are not enabled merely because an account exists. Provider locations, terms, and retention depend on the actual configuration and must be checked before activation. No SMS appointment reminders are sent.
5.6. We do not sell your personal data. We do not share personal data for advertising purposes.
5.7. We may disclose data if required by law, court order, or regulatory authority.

6. DATA STORAGE AND SECURITY

6.1. Platform account and service records are stored in the Platform database. Clerk manages sign-in credentials; this Platform does not store account passwords.
6.2. We implement reasonable security practices as required under the IT Act, 2000, and the IT Rules, 2011.
6.3. We use role-based access controls. Admin actions are logged in an audit trail.
6.4. Despite our measures, no electronic transmission or storage is 100% secure. You use the Platform at your own risk.

7. DATA RETENTION

7.1. Account data: retained while your account is active, and for up to 3 years after deletion for legal compliance.
7.2. Consultation transcripts and chat messages: retained for 1 year after the consultation, or longer if required by any pending legal proceeding.
7.3. Call recordings, if the feature is enabled: the Platform requests deletion from Twilio after transcription succeeds. If transcription fails, it retries up to three times and then requests deletion; failed deletion requests are retried by the Platform. The Platform does not store the raw call audio in its database. Twilio may retain provider-side backups or records under its terms, so deletion from the active media resource does not guarantee immediate removal of every provider copy. Call recording is disabled by default and must not be enabled until the configured provider terms and applicable legal requirements have been reviewed.
For unprocessed call audio, the Platform also requests deletion once the recording session is 24 hours old. A background check reconciles completed rooms with Twilio to recover missed recording callbacks. These requests depend on the Platform and provider being available; failed requests are retried rather than treated as confirmed deletion.
7.4. Payment records: retained for 8 years as required under the Income Tax Act, 1961, and GST regulations.
7.5. Documents: retained while your account is active. Exported documents remain with you.

8. YOUR RIGHTS UNDER THE DPDP ACT

As a Data Principal, you have the right to:
- Access a summary of your personal data and processing activities
- Correct inaccurate or incomplete personal data
- Erase personal data that is no longer necessary (subject to legal retention requirements)
- Nominate another individual to exercise your rights in case of death or incapacity
- Grievance redressal (see Section 11 below)

To exercise these rights, email privacy@consultwithlawyer.in with your registered email address.

9. CHILDREN'S DATA

The Platform is intended for users aged 18 and above. We do not knowingly collect data from children. If we become aware that a minor has provided personal data, we will delete it promptly.

10. CROSS-BORDER DATA TRANSFER

The providers' published materials indicate that data may be processed outside India. DeepSeek's general Privacy Policy identifies the People's Republic of China for processing and storage; ElevenLabs identifies the United States as its standard storage location and offers separately configured Enterprise locations, with possible processing outside a selected location; Clerk's Data Processing Addendum permits processing wherever it or its subprocessors maintain facilities. These general statements do not confirm the region, account settings, agreement, or full processing path used for this Platform. ElevenLabs requests also pass through a Replit-managed connector, and the public connector information reviewed does not specify the processing region or request-content retention.

Razorpay checkout, Twilio communications and call recordings, Resend email, and browser push are conditional services. Their regions and retention terms must be checked against the actual configuration and applicable provider terms before they are enabled; this policy does not claim a particular region or provider retention period for them. Provider locations and terms can change. Where applicable, transfers will comply with requirements under the DPDP Act and rules notified under it. Qualified legal counsel must confirm the applicable transfer basis, notices, and safeguards before sensitive client matter data is sent to these providers or paid legal engagements are accepted.

11. GRIEVANCE OFFICER

In accordance with the IT Rules, 2011, and the DPDP Act, 2023, our Grievance Officer is:
Name: Bhagyashree Patil
Email: privacy@consultwithlawyer.in
Response time: We will acknowledge your grievance within 48 hours and resolve it within 30 days.

12. CHANGES TO THIS POLICY

We may update this Privacy Policy to reflect changes in law or our practices. Material changes will be notified via email or in-app notice at least 14 days before they take effect.

13. CONTACT

For privacy-related queries: privacy@consultwithlawyer.in`,
  }],

  refunds: [{
    revisionId: 'refunds-2026-10-08',
    effectiveDate: '2026-10-08',
    reviewStatus: 'approved',
    reviewedFingerprint: '4531531e3c8eaed6',
    content: `REFUND & CANCELLATION POLICY

Last updated: 8 October 2026

This Refund and Cancellation Policy applies to all paid services on the Consult with Lawyer platform operated by Eneru Technologies.

1. CONSULTATION CANCELLATIONS

1.1. Client-initiated cancellation: You may cancel a booked consultation at any time before the scheduled start time through the "Cancel" button on your bookings page.
1.2. Client-initiated cancellations do not qualify for a consultation refund, including cancellations before the session, except where mandatory applicable law requires otherwise.
1.3. No-show: If you do not join the consultation within the scheduled time window, no refund will be issued. The Lawyer's fee is considered earned.
1.4. Lawyer cancellation: If the assigned Lawyer cancels or declines a paid consultation, you may request a full refund from the payment history on your consultation page or the Plans page. A no-show or other dispute requires owner review and any remedy required by applicable law.

2. CONSULTATION REFUNDS

2.1. Ordinary consultation refunds are available for Lawyer cancellation only. A captured payment arriving after a request was cancelled or its scheduled start passed is treated as an unavailable-service payment and is eligible for a full refund. Mandatory statutory rights are not excluded.
2.2. We do not issue refunds for dissatisfaction with the legal advice received. Disputes regarding the quality of legal services are between you and the Lawyer.

3. DOCUMENT SUBSCRIPTION REFUNDS

3.1. Single document credit (₹10): Non-refundable once the credit has been consumed (a document has been created).
3.2. Unused document credits: Refundable within 7 days of purchase if no credit has been consumed. Contact support@consultwithlawyer.in.
3.3. 30-day document plan (₹499): Refundable within 7 days of purchase if no new or duplicated document has used that paid plan. Activation alone does not make an unused plan non-refundable. Once the paid plan is used to create a document it is not refundable, except as required by applicable law.
3.4. Free trial: No payment is involved; no refund applies.

4. HOW REFUNDS ARE PROCESSED

4.1. Request an eligible full refund from Payment history. Refunds are submitted through Razorpay to the original payment method. Associated unused credits or plan access are withdrawn while the request is processing; existing documents remain available for editing/export. An ambiguous provider response is reconciled rather than blindly submitting another refund.
4.2. Refund processing typically takes 5–10 business days depending on your bank or payment provider.
4.3. Payment history displays refund pending until Razorpay confirms processing, then refunded. Email delivery is not yet connected; do not rely on an email confirmation. Contact the platform owner with the order and payment references if a refund remains pending or fails.

5. DISPUTE RESOLUTION

5.1. For any payment dispute, first contact us at support@consultwithlawyer.in with your payment reference and a description of the issue.
5.2. We aim to resolve disputes within 7 business days.
5.3. If we are unable to resolve your concern, you may approach the appropriate Consumer Disputes Redressal Commission under the Consumer Protection Act, 2019.
5.4. For chargebacks initiated through your bank, we reserve the right to provide transaction records to Razorpay for dispute resolution.

6. CONTACT

Email: support@consultwithlawyer.in
Response time: We aim to respond within 2 business days.`,
  }],

  disclaimer: [{
    revisionId: 'disclaimer-2026-10-08',
    effectiveDate: '2026-10-08',
    reviewStatus: 'approved',
    reviewedFingerprint: 'ec45fc897af9196b',
    content: `DISCLAIMER

Last updated: 8 October 2026

PLEASE READ THIS DISCLAIMER CAREFULLY BEFORE USING THE LAW WRITER PLATFORM.

1. NO LEGAL ADVICE

The Consult with Lawyer platform ("Platform") is a technology tool that assists legal professionals in creating legal documents and connects clients with lawyers. The Platform itself does not provide legal advice, legal opinions, or legal representation.

2. NO ADVOCATE-CLIENT RELATIONSHIP

2.1. Creating an account, browsing lawyer profiles, or using document templates does not establish an advocate-client relationship.
2.2. A consultation booked through the Platform is a private engagement between the Client and the Lawyer. Whether it creates an advocate-client relationship is governed by the Advocates Act, 1961, and the Bar Council of India Rules. The Company is not a party to any such relationship.
2.3. The Company does not endorse, guarantee, or take responsibility for the legal advice, documents, or services provided by any Lawyer on the Platform.

3. AI-GENERATED CONTENT

3.1. When the relevant service is configured, the Platform can use AI for: (a) speech-to-text transcription of dictation audio submitted by a user; (b) transcription of a consultation call only when call recording is enabled and both participants separately consent; (c) document drafting from text a Lawyer submits, which may include consultation notes or a transcript; and (d) translation of submitted text into supported languages. Drafting and translation requests use DeepSeek; transcription uses ElevenLabs through a Replit-managed connector. Submitted text or audio is sent to the relevant provider for that request. Call transcripts are not sent to DeepSeek automatically; the Lawyer must review the transcript, select a template, acknowledge the provider disclosure, and request a draft. The draft is a preview only and is not delivered unless the Lawyer explicitly reviews and publishes it. Call recording is disabled by default. The Platform does not intentionally retain dictation audio as an account recording.
3.2. AI-generated content is assistive and may contain errors, omissions, or inaccuracies. It must be reviewed and verified by a qualified legal professional before use in any legal proceeding, court filing, regulatory submission, or contractual engagement.
3.3. The Company disclaims all liability for consequences arising from the use of AI-generated content without professional review.

4. TEMPLATES

4.1. Legal templates on the Platform are provided as starting points for common Indian legal documents. They are general in nature and may not address the specific requirements of your matter, jurisdiction, or court.
4.2. Templates reflect the law as understood at the time of creation. Laws and court rules change. Users must verify that templates are current and applicable to their case.
4.3. Criminal law templates offer references to both the Indian Penal Code / Code of Criminal Procedure (for cases registered before 1 July 2024) and the Bharatiya Nyaya Sanhita / Bharatiya Nagarik Suraksha Sanhita (for cases registered on or after 1 July 2024). Users must select the correct legal regime.

5. LAWYER VERIFICATION

5.1. We verify that Lawyers registered on the Platform hold a valid Bar Council enrolment number. This verification confirms enrolment; it does not constitute a character reference, competence assessment, or guarantee of the quality of services.
5.2. Ratings and reviews on the Platform are provided by users and reflect individual experiences. They are not professional evaluations.

6. LIMITATION OF LIABILITY

To the maximum extent permitted by law, the Company, its directors, employees, and affiliates shall not be liable for any direct, indirect, incidental, special, or consequential damages arising from: (a) use of or inability to use the Platform; (b) reliance on any content, document, or advice obtained through the Platform; (c) unauthorized access to your data; (d) errors or interruptions in AI services.

7. BAR COUNCIL COMPLIANCE

7.1. Lawyer profiles on the Platform are informational listings maintained by the Lawyers themselves, intended to help clients make informed choices. They are not advertisements within the meaning of Rule 36 of the Bar Council of India Rules.
7.2. Lawyers are responsible for ensuring their profile information complies with Bar Council of India Rules and their respective State Bar Council rules.

8. THIRD-PARTY SERVICES

The Platform uses Clerk for account sign-in and, when configured, DeepSeek for drafting and translation and ElevenLabs through a Replit-managed connector for transcription. Razorpay checkout, Twilio phone verification or audio calls, Resend email, and browser push are available only when their respective features are enabled. Call recording is disabled by default. If enabled, a consultation is recorded only after both participants separately consent; if either declines, the call may proceed unrecorded. Twilio processes the audio tracks and the Platform requests their deletion after transcription succeeds or after three failed attempts. ElevenLabs processes the tracks to create a transcript. No SMS appointment reminders are sent. MSG91 and Jitsi are not used by the current application. Third-party processing and availability are subject to each provider's current terms and privacy information; provider acceptance does not guarantee delivery or receipt.

9. GOVERNING LAW

This Disclaimer is governed by the laws of India. Any disputes arising from this Disclaimer shall be subject to the exclusive jurisdiction of the courts at New Delhi, India.

10. CONTACT

For questions about this Disclaimer: support@consultwithlawyer.in`,
  }],
};

export const policies: Record<string, string> = Object.fromEntries(
  Object.entries(policyRevisionHistory).map(([key, revisions]) => [
    key,
    revisions.at(-1)?.content ?? '',
  ]),
);

export function getCurrentPolicyRevision(key: string): PolicyRevision | undefined {
  return policyRevisionHistory[key]?.at(-1);
}

export function getPolicyReviewStatus(
  revision: PolicyRevision | undefined,
  platformCounselApprovalRecorded: boolean,
): PolicyReviewStatus {
  if (
    !revision
    || revision.reviewStatus !== 'approved'
    || revision.reviewedFingerprint !== policyTextFingerprint(revision.content)
    || !platformCounselApprovalRecorded
  ) {
    return 'pending-review';
  }
  return 'approved';
}

export const policyTitles: Record<string, string> = {
  terms: 'Terms of Service',
  privacy: 'Privacy Policy',
  refunds: 'Refund & Cancellation Policy',
  disclaimer: 'Disclaimer',
};
