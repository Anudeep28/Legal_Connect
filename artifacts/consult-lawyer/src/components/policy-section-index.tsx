import type { PolicySection } from '@/lib/policy-sections';

export function PolicySectionIndex({ sections }: { sections: PolicySection[] }) {
  if (sections.length < 6) return null;

  return (
    <details className="policy-section-index mb-5 rounded-2xl border bg-card px-4 py-3 print:hidden">
      <summary
        className="cursor-pointer rounded-md font-medium text-primary underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
        data-testid="policy-section-index-toggle"
      >
        Jump to a section
      </summary>
      <nav aria-label="Policy sections" data-testid="policy-section-index">
        <ul className="mt-3 flex flex-wrap gap-2">
          {sections.map((section) => (
            <li key={section.id}>
              <a
                href={`#${section.id}`}
                className="inline-flex min-h-10 items-center rounded-full border px-3 py-2 text-sm text-foreground underline-offset-4 hover:bg-muted hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
                data-testid={`link-policy-section-${section.number}`}
              >
                {section.title}
              </a>
            </li>
          ))}
        </ul>
      </nav>
    </details>
  );
}
