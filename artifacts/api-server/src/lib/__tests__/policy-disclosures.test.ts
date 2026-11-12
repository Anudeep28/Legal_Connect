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

function readPolicy(name: "privacy" | "disclaimer", nextField?: string): string {
  const boundary = nextField
    ? `,\\n\\n  ${nextField}:`
    : `,\\n};`;
  const pattern = new RegExp(`\\b${name}: \\x60([\\s\\S]*?)\\x60(?=${boundary})`);
  const match = policySource.match(pattern);
  assert.ok(match, `Could not find the ${name} policy template`);
  return match[1];
}

const privacy = readPolicy("privacy", "refunds");
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

test("the public disclaimer route renders the disclaimer policy", () => {
  assert.ok(
    appSource.includes('<Route path="/disclaimer">{() => <Policy path="/disclaimer" />}</Route>'),
  );
  assert.match(
    simplePagesSource,
    /'\/disclaimer': \{ key: 'disclaimer', title: 'Disclaimer'/,
  );
  assert.match(simplePagesSource, /const text = policies\[p\.key\]/);
});

test("conditional communication disclosures track the actual feature gates", () => {
  const envKeys = [
    "TWILIO_CALLS_ENABLED",
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
  const originalValues = new Map(envKeys.map((key) => [key, process.env[key]]));

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
    for (const [key, value] of originalValues) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
});
