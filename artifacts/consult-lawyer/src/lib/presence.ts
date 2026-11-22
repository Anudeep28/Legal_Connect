export function presenceDuration(changedAt: string | Date, now = Date.now()): string {
  const elapsed = Math.max(0, now - new Date(changedAt).getTime());
  const minutes = Math.floor(elapsed / 60_000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `for ${minutes} min`;

  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `for ${hours} ${hours === 1 ? "hour" : "hours"}`;

  const days = Math.floor(hours / 24);
  if (days < 7) return `for ${days} ${days === 1 ? "day" : "days"}`;

  const weeks = Math.floor(days / 7);
  if (weeks < 5) return `for ${weeks} ${weeks === 1 ? "week" : "weeks"}`;

  const months = Math.floor(days / 30);
  if (months < 12) return `for ${months} ${months === 1 ? "month" : "months"}`;

  const years = Math.floor(days / 365);
  return `for ${years} ${years === 1 ? "year" : "years"}`;
}
