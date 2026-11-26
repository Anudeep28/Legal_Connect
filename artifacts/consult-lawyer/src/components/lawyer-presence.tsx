import { useEffect, useState } from "react";
import type { Lawyer } from "@workspace/api-client-react";
import { presenceDuration } from "@/lib/presence";
import { cn } from "@/lib/utils";

type PresenceStatus = Lawyer["presenceStatus"];

const labels: Record<PresenceStatus, string> = {
  online: "Online",
  offline: "Offline",
  in_court: "In court",
};

const tones: Record<PresenceStatus, string> = {
  online: "bg-emerald-500",
  offline: "bg-slate-400",
  in_court: "bg-amber-500",
};

export function LawyerPresence({
  status,
  changedAt,
  dark = false,
  className,
}: {
  status: PresenceStatus;
  changedAt: string | Date;
  dark?: boolean;
  className?: string;
}) {
  const [, refresh] = useState(0);
  useEffect(() => {
    const timer = window.setInterval(() => refresh((value) => value + 1), 60_000);
    return () => window.clearInterval(timer);
  }, []);

  const duration = status === "online" ? null : presenceDuration(changedAt);
  const label = `${labels[status]}${duration ? ` · ${duration}` : ""}`;
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs",
        dark ? "bg-white/10 text-white/85" : "bg-muted text-foreground/80",
        className,
      )}
      title={label}
      data-testid={`lawyer-presence-${status}`}
    >
      <span className={cn("h-2 w-2 shrink-0 rounded-full", tones[status], status === "online" && "live-dot")} aria-hidden="true" />
      <span>{label}</span>
    </span>
  );
}
