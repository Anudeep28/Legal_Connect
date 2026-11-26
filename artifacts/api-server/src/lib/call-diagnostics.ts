export type CallPreparationStage =
  | "initialize-client" | "fetch-room" | "create-room" | "save-room"
  | "close-recording-room" | "sign-token" | "save-consent";

// Never forward provider messages, URLs, payloads, identities, or credentials.
export function callFailureDetails(error: unknown, stage: CallPreparationStage, reference: string) {
  const fields = error && typeof error === "object" ? error as Record<string, unknown> : {};
  const status = typeof fields.status === "number" && Number.isInteger(fields.status)
    && fields.status >= 400 && fields.status <= 599 ? fields.status : undefined;
  const providerStage = stage === "fetch-room" || stage === "create-room" || stage === "close-recording-room";
  const code = providerStage && typeof fields.code === "number" && Number.isSafeInteger(fields.code)
    && fields.code > 0 ? fields.code : undefined;
  return {
    log: { event: "call_preparation_failed", stage, reference, providerStatus: status, providerCode: code },
    message: `Call preparation failed at ${stage}.${code ? ` Twilio error code: ${code}.` : ""} Reference: ${reference}. No connection was established. Please share this reference with support.`,
  };
}
