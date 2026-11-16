import { test } from "node:test";
import assert from "node:assert/strict";
import { callFailureDetails } from "../call-diagnostics";

test("Twilio failures expose only numeric codes and an opaque reference", () => {
  const result = callFailureDetails({
    status: 401, code: 20003, message: "private credential",
    details: { token: "private credential" }, moreInfo: "https://private.example",
  }, "create-room", "test-reference");
  assert.equal(result.log.providerCode, 20003);
  assert.equal(result.log.providerStatus, 401);
  assert.match(result.message, /Twilio error code: 20003/);
  assert.match(result.message, /test-reference/);
  assert.doesNotMatch(JSON.stringify(result), /private/);
});

test("database errors are not labeled Twilio errors", () => {
  const result = callFailureDetails({ code: 23505, message: "private row" }, "save-consent", "reference");
  assert.equal(result.log.providerCode, undefined);
  assert.match(result.message, /save-consent/);
  assert.doesNotMatch(result.message, /Twilio/);
});

test("unknown errors and untrusted strings cannot leak into diagnostics", () => {
  for (const error of [null, undefined, "private credential", { code: "private", status: "private" }, { code: NaN, status: 900 }]) {
    const result = callFailureDetails(error, "fetch-room", "reference");
    assert.equal(result.log.providerCode, undefined);
    assert.equal(result.log.providerStatus, undefined);
    assert.doesNotMatch(JSON.stringify(result), /private/);
  }
});
