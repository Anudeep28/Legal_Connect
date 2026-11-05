export const IST = 'Asia/Kolkata';

export function inr(n: number | undefined | null): string {
  return `₹${Math.round(n ?? 0).toLocaleString('en-IN')}`;
}

export function fmtDateTime(iso: string): string {
  if (!iso) return '';
  return new Intl.DateTimeFormat('en-IN', {
    timeZone: IST,
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    hour: 'numeric',
    minute: '2-digit',
  }).format(new Date(iso));
}

export function fmtDate(iso: string): string {
  if (!iso) return '';
  return new Intl.DateTimeFormat('en-IN', { timeZone: IST, day: 'numeric', month: 'short', year: 'numeric' }).format(new Date(iso));
}

export function fmtTime(iso: string): string {
  return new Intl.DateTimeFormat('en-IN', { timeZone: IST, hour: 'numeric', minute: '2-digit' }).format(new Date(iso));
}

export function relTime(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const m = Math.round(diff / 60000);
  if (m < 1) return 'just now';
  if (m < 60) return `${m} min ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h} h ago`;
  const d = Math.round(h / 24);
  if (d < 8) return `${d} d ago`;
  return fmtDate(iso);
}

/** YYYY-MM-DD in IST, offset by n days from now */
export function istDateKey(offsetDays = 0): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: IST, year: 'numeric', month: '2-digit', day: '2-digit' }).format(
    new Date(Date.now() + offsetDays * 86400000),
  );
}

export function weekdayOfKey(key: string): number {
  return new Date(`${key}T12:00:00+05:30`).getUTCDay();
}

export function labelOfKey(key: string) {
  const d = new Date(`${key}T12:00:00+05:30`);
  return {
    wd: new Intl.DateTimeFormat('en-IN', { timeZone: IST, weekday: 'short' }).format(d),
    day: new Intl.DateTimeFormat('en-IN', { timeZone: IST, day: 'numeric' }).format(d),
    mon: new Intl.DateTimeFormat('en-IN', { timeZone: IST, month: 'short' }).format(d),
  };
}

export const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

export function initials(name: string): string {
  return (name || '?')
    .replace(/^(Adv\.?|Advocate)\s+/i, '')
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => p[0]?.toUpperCase())
    .join('');
}

export function errMsg(e: unknown): string {
  if (!e) return 'Something went wrong.';
  const anyE = e as { data?: { error?: string }; message?: string };
  return anyE?.data?.error || anyE?.message || 'Something went wrong.';
}

export function fillTemplate(content: string, values: Record<string, string>): string {
  return content.replace(/\{\{\s*([\w-]+)\s*\}\}/g, (m, id: string) => (values[id]?.trim() ? values[id] : m));
}
