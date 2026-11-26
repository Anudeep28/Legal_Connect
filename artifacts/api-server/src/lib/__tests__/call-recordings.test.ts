import assert from "node:assert/strict";
import test from "node:test";
import {
  formatCallTranscript,
  transcribePersistThenDelete,
  validateTwilioVideoSignature,
} from "../call-recordings";

test("speaker-labelled transcript keeps language labels and timeline order", () => {
  const transcript = formatCallTranscript([
    { text: "English", startSeconds: 3, endSeconds: 3.4, speaker: "lawyer", languageCode: "en" },
    { text: "मराठी", startSeconds: 1, endSeconds: 1.8, speaker: "client", languageCode: "mr" },
  ]);
  assert.match(transcript, /\[00:01\] Client \(मराठी\): मराठी/);
  assert.match(transcript, /\[00:03\] Lawyer \(English\): English/);
});

test("raw audio deletion happens only after transcription has been saved", async () => {
  const steps: string[] = [];
  const result = await transcribePersistThenDelete(
    async () => { steps.push("transcribed"); return "reviewable text"; },
    async (text) => { assert.equal(text, "reviewable text"); steps.push("saved"); },
    async () => { steps.push("deleted"); },
  );
  assert.deepEqual(steps, ["transcribed", "saved", "deleted"]);
  assert.equal(result.deletePending, false);
});

test("failed deletion leaves a retry state without losing the saved transcript", async () => {
  const steps: string[] = [];
  const result = await transcribePersistThenDelete(
    async () => { steps.push("transcribed"); return "reviewable text"; },
    async () => { steps.push("saved"); },
    async () => { steps.push("delete-requested"); throw new Error("provider unavailable"); },
  );
  assert.deepEqual(steps, ["transcribed", "saved", "delete-requested"]);
  assert.equal(result.deletePending, true);
  assert.equal(result.result, "reviewable text");
});

test("transcription failures do not trigger deletion before retry or terminal cleanup", async () => {
  const steps: string[] = [];
  await assert.rejects(() => transcribePersistThenDelete(
    async () => { steps.push("transcribe-failed"); throw new Error("provider unavailable"); },
    async () => { steps.push("saved"); },
    async () => { steps.push("deleted"); },
  ));
  assert.deepEqual(steps, ["transcribe-failed"]);
});

test("unsigned Twilio recording callbacks are rejected", () => {
  assert.equal(validateTwilioVideoSignature({
    signature: undefined,
    url: "https://example.test/api/communications/twilio-video-recordings",
    params: { RoomSid: "RM00000000000000000000000000000000" },
    authToken: "test-auth-token",
  }), false);
});
