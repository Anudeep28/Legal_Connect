import { Link } from 'wouter';
import { MapPin, Languages, BadgeCheck, Clock } from 'lucide-react';
import type { Lawyer } from '@workspace/api-client-react';
import { inr } from '@/lib/format';
import { DemoTag, PersonAvatar, Stars } from '@/components/kit';

export function LawyerCard({ lawyer, index = 0 }: { lawyer: Lawyer; index?: number }) {
  return (
    <Link
      href={`/lawyers/${lawyer.id}`}
      className="group lift relative flex flex-col rounded-[1.4rem] border bg-card p-5 rise"
      style={{ animationDelay: `${Math.min(index, 10) * 50}ms` }}
      data-testid={`card-lawyer-${lawyer.id}`}
    >
      <div className="flex items-start gap-4">
        <div className="relative">
          <PersonAvatar name={lawyer.name} src={lawyer.avatarUrl} className="h-16 w-16" />
          <span
            className={`absolute -bottom-0.5 -right-0.5 h-3.5 w-3.5 rounded-full border-2 border-card ${lawyer.online ? 'live-dot bg-[hsl(152_55%_40%)]' : 'bg-muted-foreground/40'}`}
            title={lawyer.online ? 'Marked available now' : 'Offline'}
          />
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-1.5">
            <h3 className="truncate text-lg font-semibold leading-tight group-hover:text-primary">{lawyer.name}</h3>
            {lawyer.verified && !lawyer.demo && <BadgeCheck className="h-4 w-4 text-primary" aria-label="Credentials reviewed" />}
          </div>
          <p className="truncate text-[13px] text-muted-foreground">{lawyer.title}</p>
          <div className="mt-1.5 flex items-center gap-2 text-xs text-muted-foreground">
            {lawyer.reviewCount > 0 ? (
              <>
                <Stars value={lawyer.rating} />
                <span className="font-mono">
                  {lawyer.rating.toFixed(1)} · {lawyer.reviewCount}
                </span>
              </>
            ) : (
              <span className="font-mono">No reviews yet</span>
            )}
          </div>
        </div>
      </div>
      <div className="mt-4 flex flex-wrap gap-1.5">
        {lawyer.practiceAreas.slice(0, 3).map((a) => (
          <span key={a} className="rounded-full bg-secondary px-2.5 py-1 text-[11.5px] text-secondary-foreground">
            {a}
          </span>
        ))}
        {lawyer.practiceAreas.length > 3 && <span className="px-1 py-1 text-[11.5px] text-muted-foreground">+{lawyer.practiceAreas.length - 3}</span>}
      </div>
      <div className="mt-4 grid grid-cols-3 gap-2 text-[12px] text-muted-foreground">
        <span className="flex items-center gap-1 truncate"><Clock className="h-3.5 w-3.5 shrink-0" />{lawyer.experienceYears} yrs</span>
        <span className="flex items-center gap-1 truncate"><MapPin className="h-3.5 w-3.5 shrink-0" />{lawyer.city}</span>
        <span className="flex items-center gap-1 truncate"><Languages className="h-3.5 w-3.5 shrink-0" />{lawyer.languages.slice(0, 2).join(', ')}</span>
      </div>
      <div className="mt-5 flex items-end justify-between border-t border-dashed pt-4">
        <div>
          <div className="font-display text-2xl font-semibold leading-none" data-testid={`text-fee-${lawyer.id}`}>{inr(lawyer.fee)}</div>
          <div className="mt-1 font-mono text-[10px] uppercase tracking-widest text-muted-foreground">per 30-min consult</div>
        </div>
        <div className="flex flex-col items-end gap-1.5">
          {lawyer.demo && <DemoTag />}
          <span className="rounded-full bg-primary px-3.5 py-1.5 text-[12.5px] font-medium text-primary-foreground transition-transform group-hover:translate-x-0.5">
            View profile
          </span>
        </div>
      </div>
    </Link>
  );
}
