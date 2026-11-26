import type { PolicySection } from '@/lib/policy-sections';

export function PolicySectionIndex({
  sections,
  activeSectionId,
}: {
  sections: PolicySection[];
  activeSectionId?: string | null;
}) {
  if (sections.length < 6) return null;
  const activeSection = sections.find((section) => section.id === activeSectionId);

  return (
    <details className="policy-section-index mb-5 rounded-2xl border bg-card px-4 py-3 print:hidden">
      <summary
        className="cursor-pointer rounded-md font-medium text-primary underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
        data-testid="policy-section-index-toggle"
      >
        <span>Jump to a section</span>
        {activeSection && (
          <span className="mt-1 block text-xs font-semibold text-foreground" data-testid="policy-active-section">
            Currently reading: {activeSection.title}
          </span>
        )}
      </summary>
      <nav aria-label="Policy sections" data-testid="policy-section-index">
        <ul className="mt-3 flex flex-wrap gap-2">
          {sections.map((section) => (
            <li key={section.id}>
              <a
                href={`#${section.id}`}
                aria-current={section.id === activeSectionId ? 'location' : undefined}
                className={`inline-flex min-h-10 items-center gap-2 rounded-full border px-3 py-2 text-sm text-foreground underline-offset-4 hover:bg-muted hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 ${section.id === activeSectionId ? 'border-primary font-semibold ring-1 ring-inset ring-primary' : ''}`}
                data-testid={`link-policy-section-${section.number}`}
              >
                {section.title}
                {section.id === activeSectionId && <span className="rounded-full border border-current px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wide">Reading</span>}
              </a>
            </li>
          ))}
        </ul>
      </nav>
    </details>
  );
}
