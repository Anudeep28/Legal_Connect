import assert from "node:assert/strict";
import { test } from "node:test";
import { resolvePresenceChange } from "../presence";

test("presence timestamp advances when a lawyer changes status", () => {
  const previous = new Date("2026-11-21T10:00:00.000Z");
  const now = new Date("2026-11-22T10:00:00.000Z");
  const updated = resolvePresenceChange("offline", "in_court", previous, now);

  assert.equal(updated.presenceStatus, "in_court");
  assert.equal(updated.presenceChangedAt, now);
});

test("presence timestamp stays stable when a lawyer saves without changing status", () => {
  const previous = new Date("2026-11-21T10:00:00.000Z");
  const now = new Date("2026-11-22T10:00:00.000Z");
  const updated = resolvePresenceChange("offline", "offline", previous, now);

  assert.equal(updated.presenceChangedAt, previous);
});

test("new and legacy profiles receive a server timestamp", () => {
  const now = new Date("2026-11-22T10:00:00.000Z");

  assert.equal(resolvePresenceChange(null, "offline", null, now).presenceChangedAt, now);
  assert.equal(resolvePresenceChange("online", "online", null, now).presenceChangedAt, now);
});
