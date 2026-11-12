import assert from "node:assert/strict";
import { test } from "node:test";
import type { Connection, ProxyOptions } from "@replit/connectors-sdk";
import {
  hasDeepSeekKey,
  isElevenLabsConnectionReady,
  ProviderConfigurationError,
  ProviderRequestError,
  requestDeepSeek,
  transcribeWithElevenLabs,
  type ConnectorClient,
} from "../ai-providers";

const connection: Connection = {
  id: "test-elevenlabs-connection",
  connector_name: "elevenlabs",
  customer_id: "test-customer",
};

function fakeConnector(options: {
  connections?: Connection[];
  proxyResponse?: Response;
  proxyError?: Error;
  onProxy?: (path: string, options?: ProxyOptions) => void;
} = {}): ConnectorClient {
  return {
    listConnections: async () => options.connections ?? [connection],
    proxy: async (_name, path, proxyOptions) => {
      options.onProxy?.(path, proxyOptions);
      if (options.proxyError) throw options.proxyError;
      return options.proxyResponse ?? Response.json({ text: "Transcribed dictation" });
    },
  };
}

test("DeepSeek drafting calls the configured server-side API and returns its completion", async () => {
  let authorization = "";
  let body: Record<string, unknown> | undefined;
  const text = await requestDeepSeek([
    { role: "system", content: "Only draft." },
    { role: "user", content: "provided case facts" },
  ], {
    apiKey: "test-only-secret",
    fetcher: async (_url, init) => {
      authorization = new Headers(init?.headers).get("authorization") ?? "";
      body = JSON.parse(String(init?.body));
      return Response.json({ choices: [{ message: { content: "  Draft for review  " } }] });
    },
  });
  assert.equal(text, "Draft for review");
  assert.equal(authorization, "Bearer test-only-secret");
  assert.equal(body?.model, "deepseek-flash");
  assert.equal(body?.stream, false);
});

test("DeepSeek reports missing configuration without making a request", async () => {
  assert.equal(hasDeepSeekKey(""), false);
  assert.equal(hasDeepSeekKey("   "), false);
  let called = false;
  await assert.rejects(
    requestDeepSeek([{ role: "user", content: "text" }], {
      apiKey: "",
      fetcher: async () => { called = true; return Response.json({}); },
    }),
    ProviderConfigurationError,
  );
  assert.equal(called, false);
});

test("DeepSeek rejects invalid and empty completions", async () => {
  for (const json of [null, {}, { choices: [{ message: { content: "  " } }] }]) {
    await assert.rejects(
      requestDeepSeek([{ role: "user", content: "text" }], {
        apiKey: "test-key",
        fetcher: async () => Response.json(json),
      }),
      ProviderRequestError,
    );
  }
});

test("DeepSeek handles provider, network, and malformed JSON failures", async () => {
  const failures: Array<() => Promise<Response>> = [
    async () => new Response(null, { status: 429 }),
    async () => { throw new Error("simulated network failure"); },
    async () => new Response("invalid-json", { status: 200 }),
  ];
  for (const fetcher of failures) {
    await assert.rejects(
      requestDeepSeek([{ role: "user", content: "text" }], { apiKey: "test-key", fetcher }),
      ProviderRequestError,
    );
  }
});

test("ElevenLabs receives transient audio in multipart form through the connected proxy", async () => {
  let calledPath = "";
  let model = "";
  let language = "";
  let fileText = "";
  let chosenConnection = "";
  const text = await transcribeWithElevenLabs(
    Buffer.from("wav-audio-bytes"),
    "wav",
    "hi",
    fakeConnector({
      onProxy: (path, options) => {
        calledPath = path;
        chosenConnection = options?.connectionId ?? "";
        const form = options?.body as FormData;
        model = String(form.get("model_id"));
        language = String(form.get("language_code"));
        const file = form.get("file") as File;
        void file.text().then((value) => { fileText = value; });
      },
      proxyResponse: Response.json({ text: "  हिन्दी प्रतिलेख  " }),
    }),
  );
  assert.equal(text, "हिन्दी प्रतिलेख");
  assert.equal(calledPath, "/v1/speech-to-text");
  assert.equal(chosenConnection, connection.id);
  assert.equal(model, "scribe_v2");
  assert.equal(language, "hi");
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.equal(fileText, "wav-audio-bytes");
});

test("ElevenLabs missing connection is reported before a provider request", async () => {
  let called = false;
  const client = fakeConnector({
    connections: [],
    onProxy: () => { called = true; },
  });
  await assert.rejects(
    transcribeWithElevenLabs(Buffer.from("audio"), "wav", undefined, client),
    ProviderConfigurationError,
  );
  assert.equal(called, false);
});

test("ElevenLabs rejects non-success, invalid, and empty provider responses", async () => {
  const responses = [
    new Response(null, { status: 403 }),
    new Response("invalid-json", { status: 200 }),
    Response.json({ text: "  " }),
    Response.json({}),
  ];
  for (const proxyResponse of responses) {
    await assert.rejects(
      transcribeWithElevenLabs(
        Buffer.from("audio"),
        "mp3",
        undefined,
        fakeConnector({ proxyResponse }),
      ),
      ProviderRequestError,
    );
  }
});

test("ElevenLabs network failures are normalized without exposing provider details", async () => {
  await assert.rejects(
    transcribeWithElevenLabs(
      Buffer.from("audio"),
      "wav",
      undefined,
      fakeConnector({ proxyError: new Error("sensitive provider response") }),
    ),
    ProviderRequestError,
  );
});

test("ElevenLabs readiness ignores disabled and disconnected connections", () => {
  assert.equal(isElevenLabsConnectionReady(connection), true);
  assert.equal(isElevenLabsConnectionReady({ ...connection, disabled: true }), false);
  assert.equal(isElevenLabsConnectionReady({ ...connection, status: "disconnected" }), false);
});
