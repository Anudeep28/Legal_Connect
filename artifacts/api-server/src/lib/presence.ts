export type LawyerPresenceStatus = "online" | "offline" | "in_court";

/**
 * Keep the status-change time server-owned and stable unless the selected status changes.
 * A missing legacy timestamp is initialized at the moment this server processes the update.
 */
export function resolvePresenceChange(
  currentStatus: LawyerPresenceStatus | null,
  nextStatus: LawyerPresenceStatus,
  currentChangedAt: Date | null,
  now = new Date(),
) {
  return {
    presenceStatus: nextStatus,
    presenceChangedAt:
      currentStatus === nextStatus && currentChangedAt ? currentChangedAt : now,
  };
}
