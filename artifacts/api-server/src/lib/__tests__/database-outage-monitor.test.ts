import assert from "node:assert/strict";
import { after, test } from "node:test";
import {
  createDatabaseOutageMonitor,
  DATABASE_OUTAGE_FAILURE_THRESHOLD,
  DATABASE_OUTAGE_MONITOR_TIMEOUT_MS,
  sendDatabaseOutageEmail,
} from "../database-outage-monitor";

const envKeys = [
  "EMAIL_DELIVERY_ENABLED",
  "RESEND_API_KEY",
  "EMAIL_FROM",
  "APP_PUBLIC_URL",
  "OWNER_ADMIN_BOOTSTRAP_EMAIL",
] as const;
const previousEnv = new Map(envKeys.map((key) => [key, process.env[key]]));

after(() => {
  for (const key of envKeys) {
    const value = previousEnv.get(key);
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
});

function configureEmail() {
  process.env.EMAIL_DELIVERY_ENABLED = "true";
  process.env.RESEND_API_KEY = "synthetic-resend-key";
  process.env.EMAIL_FROM = "Alerts <alerts@example.com>";
  delete process.env.APP_PUBLIC_URL;
  process.env.OWNER_ADMIN_BOOTSTRAP_EMAIL = "owner@example.com";
}

test("database outage notices wait for sustained failures and send one recovery notice", async () => {
  let healthy = false;
  const notices: { phase: string; key: string }[] = [];
  const monitor = createDatabaseOutageMonitor({
    checkDatabase: async () => {
      if (!healthy) throw new Error("private database URL and query");
    },
    sendNotice: async (phase, key) => {
      notices.push({ phase, key });
      return "sent";
    },
  });

  for (let count = 0; count < DATABASE_OUTAGE_FAILURE_THRESHOLD - 1; count++) {
    assert.equal(await monitor.checkNow(), false);
  }
  assert.equal(notices.length, 0);

  await monitor.checkNow();
  await monitor.checkNow();
  assert.equal(notices.length, 1);
  assert.equal(notices[0].phase, "outage");

  healthy = true;
  assert.equal(await monitor.checkNow(), true);
  assert.equal(await monitor.checkNow(), true);
  assert.deepEqual(notices.map(({ phase }) => phase), ["outage", "recovered"]);
  assert.notEqual(notices[0].key, notices[1].key);
  assert.ok(notices.every(({ key }) => !key.includes("private")));
});

test("brief database failures do not send an alert or resolution notice", async () => {
  let healthy = false;
  const notices: string[] = [];
  const monitor = createDatabaseOutageMonitor({
    checkDatabase: async () => {
      if (!healthy) throw new Error("database unavailable");
    },
    sendNotice: async (phase) => {
      notices.push(phase);
      return "sent";
    },
  });

  await monitor.checkNow();
  healthy = true;
  await monitor.checkNow();
  assert.deepEqual(notices, []);
});

test("undelivered outage notices retry with the same idempotency key", async () => {
  const keys: string[] = [];
  let attempts = 0;
  const monitor = createDatabaseOutageMonitor({
    checkDatabase: async () => { throw new Error("database unavailable"); },
    sendNotice: async (_phase, key) => {
      keys.push(key);
      attempts += 1;
      return attempts === 1 ? "failed" : "sent";
    },
  });

  for (let count = 0; count < DATABASE_OUTAGE_FAILURE_THRESHOLD; count++) await monitor.checkNow();
  await monitor.checkNow();
  await monitor.checkNow();
  assert.equal(keys.length, 2);
  assert.equal(keys[0], keys[1]);
});

test("a stalled readiness probe is classified as a bounded failure", async () => {
  let notices = 0;
  const monitor = createDatabaseOutageMonitor({
    checkDatabase: () => new Promise(() => {}),
    sendNotice: async () => {
      notices += 1;
      return "sent";
    },
    timeoutMs: 10,
  });

  const startedAt = Date.now();
  for (let count = 0; count < DATABASE_OUTAGE_FAILURE_THRESHOLD; count++) {
    await monitor.checkNow();
  }
  assert.ok(Date.now() - startedAt < 1_000);
  assert.equal(notices, 1);
  assert.ok(DATABASE_OUTAGE_MONITOR_TIMEOUT_MS > 0);
});

test("email notices contain no database details and use stable idempotency keys", async () => {
  configureEmail();
  const requests: { url: string; init: RequestInit; body: Record<string, unknown> }[] = [];
  const fetcher: typeof fetch = async (input, init = {}) => {
    requests.push({
      url: String(input),
      init,
      body: JSON.parse(String(init.body)) as Record<string, unknown>,
    });
    return new Response(JSON.stringify({ id: "email_fixture_1" }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  };

  assert.equal(await sendDatabaseOutageEmail("outage", "database-outage-test-outage", fetcher), "sent");
  assert.equal(await sendDatabaseOutageEmail("recovered", "database-outage-test-recovered", fetcher), "sent");
  assert.equal(requests.length, 2);
  for (const request of requests) {
    assert.equal(request.url, "https://api.resend.com/emails");
    assert.equal(request.init.redirect, "error");
    assert.ok(new Headers(request.init.headers).get("Idempotency-Key"));
    assert.deepEqual(request.body.to, ["owner@example.com"]);
    const message = `${request.body.subject} ${request.body.text}`;
    assert.doesNotMatch(message, /database_url|postgres:\/\/|select\s+1|connection string|credential/i);
  }
});

test("email notices remain disabled unless the owner and email delivery are configured", async () => {
  process.env.EMAIL_DELIVERY_ENABLED = "false";
  let requests = 0;
  const fetcher: typeof fetch = async () => {
    requests += 1;
    return new Response(JSON.stringify({ id: "should_not_send" }), { status: 200 });
  };

  assert.equal(await sendDatabaseOutageEmail("outage", "database-outage-disabled", fetcher), "disabled");
  assert.equal(requests, 0);
});
