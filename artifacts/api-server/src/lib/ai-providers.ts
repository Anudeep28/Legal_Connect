import { ReplitConnectors, type Connection } from "@replit/connectors-sdk";
import { Buffer } from "node:buffer";

export class ProviderConfigurationError extends Error {
  constructor(message = "The required AI provider is not configured.") {
    super(message);
    this.name = "ProviderConfigurationError";
  }
}

export class ProviderRequestError extends Error {
  constructor() {
    super("The AI provider request failed.");
    this.name = "ProviderRequestError";
  }
}

export function hasDeepSeekKey(key: string | undefined = process.env.DEEPSEEK_API_KEY): boolean {
  return Boolean(key?.trim());
}

type ChatMessage = { role: "system" | "user"; content: string };
type Fetcher = typeof fetch;

export async function requestDeepSeek(
  messages: ChatMessage[],
  options: { apiKey?: string; fetcher?: Fetcher } = {},
): Promise<string> {
  const apiKey = options.apiKey ?? process.env.DEEPSEEK_API_KEY;
  if (!hasDeepSeekKey(apiKey)) throw new ProviderConfigurationError("DeepSeek drafting is not configured.");
  const fetcher = options.fetcher ?? fetch;

  let response: Response;
  try {
    response = await fetcher("https://api.deepseek.com/chat/completions", {
      method: "POST",
      headers: {
        authorization: `Bearer ${apiKey}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        model: "deepseek-flash",
        messages,
        max_tokens: 8192,
        stream: false,
      }),
      signal: AbortSignal.timeout(120_000),
    });
  } catch {
    throw new ProviderRequestError();
  }
  if (!response.ok) throw new ProviderRequestError();

  let payload: unknown;
  try {
    payload = await response.json();
  } catch {
    throw new ProviderRequestError();
  }
  const text = (payload as { choices?: Array<{ message?: { content?: unknown } }> } | null)
    ?.choices?.[0]?.message?.content;
  if (typeof text !== "string" || !text.trim()) throw new ProviderRequestError();
  return text.trim();
}

export type ConnectorClient = Pick<ReplitConnectors, "listConnections" | "proxy">;

export function isElevenLabsConnectionReady(connection: Connection): boolean {
  const normalized = connection as Connection & {
    connectorName?: string;
    disconnectedAt?: string | null;
  };
  const connectorName = normalized.connector_name ?? normalized.connectorName;
  return connectorName === "elevenlabs" &&
    connection.disabled !== true &&
    !normalized.disconnected_at &&
    !normalized.disconnectedAt &&
    !["disconnected", "disabled", "error"].includes((connection.status ?? "").toLowerCase());
}

let connectors: ConnectorClient | undefined;
function getConnectors(): ConnectorClient {
  connectors ??= new ReplitConnectors();
  return connectors;
}
let connectionCheck: { expiresAt: number; result: Promise<boolean> } | undefined;

export async function hasElevenLabsConnection(client?: ConnectorClient): Promise<boolean> {
  try {
    const currentClient = client ?? getConnectors();
    if (!client && connectionCheck && connectionCheck.expiresAt > Date.now()) {
      return await connectionCheck.result;
    }
    const result = currentClient.listConnections({
      connector_names: "elevenlabs",
      refresh_policy: "none",
    }).then((items) => items.some(isElevenLabsConnectionReady)).catch(() => false);
    if (!client) connectionCheck = { expiresAt: Date.now() + 30_000, result };
    return await result;
  } catch {
    return false;
  }
}

export async function aiCapabilities(): Promise<{
  draftingEnabled: boolean;
  dictationEnabled: boolean;
  aiEnabled: boolean;
}> {
  const [draftingEnabled, dictationEnabled] = await Promise.all([
    Promise.resolve(hasDeepSeekKey()),
    hasElevenLabsConnection(),
  ]);
  return { draftingEnabled, dictationEnabled, aiEnabled: draftingEnabled && dictationEnabled };
}

export async function isAiAvailable(): Promise<{
  draftingEnabled: boolean;
  dictationEnabled: boolean;
  aiEnabled: boolean;
}> {
  const [draftingEnabled, dictationEnabled] = await Promise.all([
    Promise.resolve(hasDeepSeekKey()),
    hasElevenLabsConnection(),
  ]);
  return { draftingEnabled, dictationEnabled, aiEnabled: draftingEnabled && dictationEnabled };
}

export async function transcribeWithElevenLabs(
  audioBuffer: Buffer,
  format: "wav" | "mp3",
  languageCode: string | undefined,
  client?: ConnectorClient,
): Promise<string> {
  let connection: Connection | undefined;
  let currentClient: ConnectorClient;
  try {
    currentClient = client ?? getConnectors();
    connection = (await currentClient.listConnections({
      connector_names: "elevenlabs",
      refresh_policy: "none",
    })).find(isElevenLabsConnectionReady);
  } catch {
    throw new ProviderConfigurationError("ElevenLabs dictation is not available.");
  }
  if (!connection) throw new ProviderConfigurationError("ElevenLabs dictation is not configured.");

  const form = new FormData();
  form.set("model_id", "scribe_v2");
  form.set("tag_audio_events", "false");
  if (languageCode && /^[a-z]{2,3}$/i.test(languageCode)) form.set("language_code", languageCode);
  form.set(
    "file",
    new Blob([new Uint8Array(audioBuffer)], { type: format === "mp3" ? "audio/mpeg" : "audio/wav" }),
    `dictation.${format}`,
  );

  let response: Response;
  try {
    response = await currentClient.proxy("elevenlabs", "/v1/speech-to-text", {
      connectionId: connection.id,
      method: "POST",
      body: form,
      signal: AbortSignal.timeout(120_000),
    });
  } catch {
    throw new ProviderRequestError();
  }
  if (!response.ok) throw new ProviderRequestError();

  let payload: unknown;
  try {
    payload = await response.json();
  } catch {
    throw new ProviderRequestError();
  }
  const text = (payload as { text?: unknown } | null)?.text;
  if (typeof text !== "string" || !text.trim()) throw new ProviderRequestError();
  return text.trim();
}
