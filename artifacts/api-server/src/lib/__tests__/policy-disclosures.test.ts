import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { communicationServices } from "../communication-config";

const policySource = readFileSync(
  new URL("../../../../consult-lawyer/src/data/policies.ts", import.meta.url),
  "utf8",
);
const appSource = readFileSync(
  new URL("../../../../consult-lawyer/src/App.tsx", import.meta.url),
  "utf8",
);
const simplePagesSource = readFileSync(
  new URL("../../../../consult-lawyer/src/pages/simple.tsx", import.meta.url),
  "utf8",
);
const shellSource = readFileSync(
  new URL("../../../../consult-lawyer/src/components/shell.tsx", import.meta.url),
  "utf8",
);
const policiesSource = readFileSync(
  new URL("../../../../consult-lawyer/src/data/policies.ts", import.meta.url),
  "utf8",
);
const viteConfigSource = readFileSync(
  new URL("../../../../consult-lawyer/vite.config.ts", import.meta.url),
  "utf8",
);

function readPolicy(name: "terms" | "privacy" | "disclaimer", nextField?: string): string {
  const boundary = nextField
    ? `,\\n\\n  ${nextField}:`
    : `,\\n};`;
  const pattern = new RegExp(`\\b${name}: \\x60([\\s\\S]*?)\\x60(?=${boundary})`);
  const match = policySource.match(pattern);
  assert.ok(match, `Could not find the ${name} policy template`);
  return match[1];
}

const privacy = readPolicy("privacy", "refunds");
const terms = readPolicy("terms", "privacy");
const disclaimer = readPolicy("disclaimer");

test("public privacy and disclaimer disclosures match configured providers", () => {
  for (const text of [privacy, disclaimer]) {
    assert.match(text, /\bClerk\b/, "account sign-in must name Clerk");
    assert.match(text, /\bDeepSeek\b/, "drafting and translation must name DeepSeek");
    assert.match(text, /\bElevenLabs\b/, "dictation transcription must name ElevenLabs");
    assert.doesNotMatch(
      text,
      /(?:password.{0,40}(?:hash|bcrypt|argon2|scrypt)|(?:hash|bcrypt|argon2|scrypt).{0,40}password)/i,
      "public copy must not claim that the Platform hashes or stores local passwords",
    );
  }

  assert.match(privacy, /Clerk handles sign-in credentials; this Platform does not store account passwords/i);
  assert.match(disclaimer, /MSG91 and Jitsi are not used by the current application/i);
  assert.doesNotMatch(disclaimer, /\b(?:uses?|using|powered by|handles?)\s+(?:MSG91|Jitsi)\b/i);

  assert.match(privacy, /If enabled, Twilio may process your phone number/i);
  assert.match(privacy, /Resend may process your email address/i);
  assert.match(privacy, /Browser push uses the applicable browser\/push service/i);
  assert.match(disclaimer, /Razorpay checkout, Twilio phone verification or audio calls, Resend email, and browser push are available only when their respective features are enabled/i);
});

test("call recording is disclosed as disabled and requires both participants' consent", () => {
  assert.match(terms, /both the Client and Lawyer give separate, affirmative consent/i);
  assert.match(terms, /If either participant declines, the call may proceed without recording/i);
  assert.match(privacy, /Call recording requires a separate affirmative choice from both the Client and Lawyer for each consultation/i);
  assert.match(privacy, /Call recording is disabled by default/i);
  assert.match(privacy, /Twilio may process your phone number for verification, carry audio-call traffic, and store call audio tracks/i);
  assert.match(privacy, /ElevenLabs may process those audio tracks to produce a transcript/i);
  assert.match(privacy, /must not be enabled until the configured provider terms and applicable legal requirements have been reviewed/i);
  assert.match(disclaimer, /Call recording is disabled by default/i);
  assert.match(disclaimer, /if either declines, the call may proceed unrecorded/i);
  assert.match(simplePagesSource, /Call recording is disabled by default; if enabled, it requires separate consent from both the client and lawyer/i);
  assert.doesNotMatch(
    `${terms}\n${privacy}\n${disclaimer}`,
    /Calls are not recorded by this Platform|this Platform does not record calls/i,
  );
});

test("signed-out visitors can open every policy from the footer or directly", () => {
  const policyRoutes = [
    {
      path: "/privacy",
      footerLabel: "Privacy policy",
      key: "privacy",
      title: "Privacy Policy",
      contentHeading: "PRIVACY POLICY",
    },
    {
      path: "/disclaimer",
      footerLabel: "Disclaimer",
      key: "disclaimer",
      title: "Disclaimer",
      contentHeading: "DISCLAIMER",
    },
    {
      path: "/terms",
      footerLabel: "Terms of service",
      key: "terms",
      title: "Terms of Service",
      contentHeading: "TERMS OF SERVICE",
    },
    {
      path: "/refund-policy",
      footerLabel: "Refund policy",
      key: "refunds",
      title: "Refund & Cancellation Policy",
      contentHeading: "REFUND & CANCELLATION POLICY",
    },
  ];
  const routesStart = appSource.indexOf("function AppRoutes()");
  const routesEnd = appSource.indexOf("\nfunction ClerkProviderWithRoutes()", routesStart);
  const appRoutesSource = appSource.slice(routesStart, routesEnd);

  assert.ok(routesStart >= 0 && routesEnd > routesStart, "AppRoutes should be present");
  assert.doesNotMatch(
    appRoutesSource,
    /<Show when="signed-(?:in|out)">/,
    "policy routes should not be conditional on authentication state",
  );

  for (const policy of policyRoutes) {
    assert.ok(
      appRoutesSource.includes(
        `<Route path="${policy.path}">{() => <Policy path="${policy.path}" />}</Route>`,
      ),
      `${policy.path} should be directly routable`,
    );
    assert.ok(
      shellSource.includes(`['${policy.path}', '${policy.footerLabel}']`),
      `${policy.footerLabel} should link to ${policy.path}`,
    );
    assert.ok(
      simplePagesSource.includes(
        `'${policy.path}': { key: '${policy.key}', title: '${policy.title}'`,
      ),
      `${policy.path} should map to the matching page title and content key`,
    );
    assert.ok(
      policiesSource.includes(`${policy.key}: \`${policy.contentHeading}`),
      `${policy.key} should have policy content`,
    );
  }

  assert.match(simplePagesSource, /const text = policies\[p\.key\]/);
  assert.match(simplePagesSource, /<PageHeader eyebrow="Policies" title={p\.title}/);
});

test("policy routes respect the configured artifact base path", () => {
  assert.match(
    appSource,
    /const basePath = import\.meta\.env\.BASE_URL\.replace\(\/\\\/\$\/, ''\)/,
  );
  assert.match(appSource, /<WouterRouter base=\{basePath\}>/);
  assert.match(viteConfigSource, /base: basePath,/);
});

test("conditional communication disclosures track the actual feature gates", () => {
  const envKeys = [
    "TWILIO_CALLS_ENABLED",
    "TWILIO_CALL_RECORDING_ENABLED",
    "TWILIO_VERIFY_ENABLED",
    "TWILIO_ACCOUNT_SID",
    "TWILIO_AUTH_TOKEN",
    "TWILIO_API_KEY_SID",
    "TWILIO_API_KEY_SECRET",
    "TWILIO_VERIFY_SERVICE_SID",
    "EMAIL_DELIVERY_ENABLED",
    "RESEND_API_KEY",
    "EMAIL_FROM",
    "APP_PUBLIC_URL",
    "PUSH_DELIVERY_ENABLED",
    "VAPID_PUBLIC_KEY",
    "VAPID_PRIVATE_KEY",
    "VAPID_SUBJECT",
  ] as const;
  try {
    for (const key of envKeys) delete process.env[key];
    assert.deepEqual(communicationServices(), {
      callsEnabled: false,
      phoneVerificationEnabled: false,
      emailEnabled: false,
      pushEnabled: false,
      pushPublicKey: null,
      recordingEnabled: false,
      remindersEnabled: true,
    });

    Object.assign(process.env, {
      TWILIO_CALLS_ENABLED: "true",
      TWILIO_VERIFY_ENABLED: "true",
      TWILIO_ACCOUNT_SID: "ACsynthetic",
      TWILIO_AUTH_TOKEN: "synthetic-auth",
      TWILIO_API_KEY_SID: "SKsynthetic",
      TWILIO_API_KEY_SECRET: "synthetic-api-secret",
      TWILIO_VERIFY_SERVICE_SID: "VAsynthetic",
      EMAIL_DELIVERY_ENABLED: "true",
      RESEND_API_KEY: "synthetic-resend-key",
      EMAIL_FROM: "Test <test@example.com>",
      APP_PUBLIC_URL: "https://example.com",
      PUSH_DELIVERY_ENABLED: "true",
      VAPID_PUBLIC_KEY: "synthetic-public-key",
      VAPID_PRIVATE_KEY: "synthetic-private-key",
      VAPID_SUBJECT: "mailto:test@example.com",
    });

    assert.deepEqual(communicationServices(), {
      callsEnabled: true,
      phoneVerificationEnabled: true,
      emailEnabled: true,
      pushEnabled: true,
      pushPublicKey: "synthetic-public-key",
      recordingEnabled: false,
      remindersEnabled: true,
    });
  } finally {
    for (const key of envKeys) delete process.env[key];
  }
});
