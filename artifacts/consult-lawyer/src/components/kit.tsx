import type { ReactNode } from 'react';
import { Link } from 'wouter';
import { AlertTriangle, RotateCw, FlaskConical } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Skeleton } from '@/components/ui/skeleton';
import { cn } from '@/lib/utils';
import { errMsg, initials } from '@/lib/format';
import type { ConsultationStatus } from '@workspace/api-client-react';

export function LogoMark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 64 64" className={cn('h-9 w-9', className)} aria-hidden>
      <rect width="64" height="64" rx="16" fill="hsl(232 58% 26%)" />
      <circle cx="32" cy="32" r="21" fill="none" stroke="hsl(41 92% 56%)" strokeWidth="2" />
      <path
        d="M32 16v30M20 24h24M20 24l-5 11a6 6 0 0 0 10 0zM44 24l-5 11a6 6 0 0 0 10 0zM24 46h16"
        fill="none"
        stroke="hsl(40 60% 96%)"
        strokeWidth="2.6"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

export function PageHeader({ eyebrow, title, sub, actions }: { eyebrow?: string; title: ReactNode; sub?: ReactNode; actions?: ReactNode }) {
  return (
    <div className="mb-8 flex flex-col gap-4 md:flex-row md:items-end md:justify-between rise">
      <div className="max-w-2xl">
        {eyebrow && <p className="mb-2 font-mono text-[11px] uppercase tracking-[0.2em] text-primary/70">{eyebrow}</p>}
        <h1 className="text-3xl font-semibold leading-[1.05] md:text-[2.6rem]">{title}</h1>
        {sub && <p className="mt-3 text-[15px] leading-relaxed text-muted-foreground">{sub}</p>}
      </div>
      {actions && <div className="flex flex-wrap gap-2">{actions}</div>}
    </div>
  );
}

export function ErrorState({ error, onRetry, title = 'We could not load this' }: { error?: unknown; onRetry?: () => void; title?: string }) {
  return (
    <div className="rounded-2xl border border-destructive/25 bg-destructive/5 p-8 text-center" data-testid="state-error">
      <AlertTriangle className="mx-auto mb-3 h-7 w-7 text-destructive" />
      <h3 className="text-lg font-semibold">{title}</h3>
      <p className="mx-auto mt-1 max-w-md text-sm text-muted-foreground">{errMsg(error)}</p>
      {onRetry && (
        <Button variant="outline" className="mt-4" onClick={onRetry} data-testid="button-retry">
          <RotateCw /> Try again
        </Button>
      )}
    </div>
  );
}

export function EmptyState({ icon, title, body, action }: { icon: ReactNode; title: string; body: ReactNode; action?: ReactNode }) {
  return (
    <div className="relative overflow-hidden rounded-2xl border border-dashed border-primary/25 bg-card/60 px-6 py-14 text-center" data-testid="state-empty">
      <div className="mx-auto mb-4 grid h-14 w-14 place-items-center rounded-2xl bg-haldi/25 text-primary [&_svg]:h-6 [&_svg]:w-6">{icon}</div>
      <h3 className="text-xl font-semibold">{title}</h3>
      <p className="mx-auto mt-2 max-w-md text-sm leading-relaxed text-muted-foreground">{body}</p>
      {action && <div className="mt-5 flex justify-center gap-2">{action}</div>}
    </div>
  );
}

export function Notice({ tone = 'haldi', icon, children, className }: { tone?: 'haldi' | 'ink' | 'danger'; icon?: ReactNode; children: ReactNode; className?: string }) {
  const tones = {
    haldi: 'border-haldi/50 bg-haldi/15 text-foreground',
    ink: 'border-primary/20 bg-primary/5 text-foreground',
    danger: 'border-destructive/30 bg-destructive/5 text-foreground',
  };
  return (
    <div className={cn('flex gap-3 rounded-xl border px-4 py-3 text-[13px] leading-relaxed', tones[tone], className)}>
      {icon && <span className="mt-0.5 shrink-0 text-primary [&_svg]:h-4 [&_svg]:w-4">{icon}</span>}
      <div>{children}</div>
    </div>
  );
}

export function DemoTag({ className }: { className?: string }) {
  return (
    <span
      className={cn('inline-flex items-center gap-1 rounded-full border border-primary/25 bg-background/80 px-2 py-0.5 font-mono text-[10px] uppercase tracking-wider text-primary', className)}
      title="Illustrative example profile. Not a real advocate; not verified."
      data-testid="tag-demo"
    >
      <FlaskConical className="h-3 w-3" /> Illustrative
    </span>
  );
}

export function PersonAvatar({ name, src, className }: { name: string; src?: string; className?: string }) {
  return (
    <Avatar className={cn('h-12 w-12 rounded-2xl', className)}>
      {src ? <AvatarImage src={src} alt={name} className="object-cover" /> : null}
      <AvatarFallback className="rounded-[inherit] bg-primary font-display text-primary-foreground">{initials(name)}</AvatarFallback>
    </Avatar>
  );
}

const statusStyles: Record<ConsultationStatus, string> = {
  requested: 'bg-haldi/25 text-[hsl(36_80%_26%)] border-haldi/60',
  booked: 'bg-primary/10 text-primary border-primary/30',
  completed: 'bg-[hsl(168_40%_36%/0.12)] text-[hsl(168_45%_26%)] border-[hsl(168_40%_36%/0.35)]',
  cancelled: 'bg-muted text-muted-foreground border-border',
};
const statusLabel: Record<ConsultationStatus, string> = {
  requested: 'Requested · awaiting lawyer',
  booked: 'Accepted',
  completed: 'Completed',
  cancelled: 'Cancelled',
};
export function StatusPill({ status }: { status: ConsultationStatus }) {
  return (
    <span className={cn('inline-flex items-center rounded-full border px-2.5 py-0.5 text-[11px] font-medium', statusStyles[status])} data-testid={`status-${status}`}>
      {statusLabel[status]}
    </span>
  );
}

export function ListSkeleton({ rows = 4 }: { rows?: number }) {
  return (
    <div className="space-y-3">
      {Array.from({ length: rows }).map((_, i) => (
        <div key={i} className="flex items-center gap-4 rounded-2xl border bg-card p-4">
          <Skeleton className="h-12 w-12 rounded-2xl" />
          <div className="flex-1 space-y-2">
            <Skeleton className="h-4 w-1/3" />
            <Skeleton className="h-3 w-2/3" />
          </div>
        </div>
      ))}
    </div>
  );
}

export function Stars({ value, size = 'sm' }: { value: number; size?: 'sm' | 'lg' }) {
  return (
    <span className={cn('inline-flex', size === 'lg' ? 'gap-1' : 'gap-0.5')} aria-label={`${value} of 5`}>
      {[1, 2, 3, 4, 5].map((i) => (
        <svg key={i} viewBox="0 0 20 20" className={size === 'lg' ? 'h-5 w-5' : 'h-3.5 w-3.5'}>
          <path
            d="M10 1.5l2.6 5.4 5.9.8-4.3 4.1 1 5.8L10 14.8 4.8 17.6l1-5.8L1.5 7.7l5.9-.8z"
            fill={i <= Math.round(value) ? 'hsl(41 92% 52%)' : 'hsl(36 25% 84%)'}
          />
        </svg>
      ))}
    </span>
  );
}

export function SignInPrompt({ title, body }: { title: string; body: string }) {
  return (
    <div className="mx-auto max-w-lg rounded-3xl border bg-card p-10 text-center shadow-sm rise">
      <LogoMark className="mx-auto mb-5 h-12 w-12" />
      <h2 className="text-2xl font-semibold">{title}</h2>
      <p className="mt-2 text-sm text-muted-foreground">{body}</p>
      <div className="mt-6 flex justify-center gap-2">
        <Button asChild data-testid="button-signin-prompt">
          <Link href="/sign-in">Sign in</Link>
        </Button>
        <Button asChild variant="outline" data-testid="button-signup-prompt">
          <Link href="/sign-up">Create free account</Link>
        </Button>
      </div>
    </div>
  );
}
