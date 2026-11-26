import { afterEach, expect, it } from 'vitest';
import { cleanup, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { PolicySectionIndex } from '@/components/policy-section-index';
import { getPolicySections } from '@/lib/policy-sections';
import { policies } from '@/data/policies';

afterEach(cleanup);

it('indexes the numbered sections in each long policy without including subsections', () => {
  for (const key of ['terms', 'privacy', 'refunds', 'disclaimer']) {
    const sections = getPolicySections(policies[key].split(/\n\s*\n/).slice(1));
    expect(sections.length, key).toBeGreaterThanOrEqual(6);
    expect(sections[0].number, key).toBe('1');
    expect(sections.map((section) => section.number)).not.toContain('1.1');
  }
});

it('renders usable in-page links and focusable, offset section headings', async () => {
  const user = userEvent.setup();
  const sections = getPolicySections(policies.terms.split(/\n\s*\n/).slice(1));
  const { container } = render(
    <>
      <PolicySectionIndex sections={sections} />
      {sections.map((section) => (
        <h2 key={section.id} id={section.id} tabIndex={-1} className="scroll-mt-24">
          {section.title}
        </h2>
      ))}
    </>,
  );

  await user.tab();
  expect(document.activeElement).toBe(screen.getByTestId('policy-section-index-toggle'));
  await user.keyboard('{Enter}');
  const nav = screen.getByRole('navigation', { name: 'Policy sections' });
  const links = within(nav).getAllByRole('link');
  expect(links).toHaveLength(sections.length);
  for (const section of sections) {
    const link = screen.getByTestId(`link-policy-section-${section.number}`);
    const heading = container.querySelector(`#${section.id}`);
    expect(link.getAttribute('href')).toBe(`#${section.id}`);
    expect(heading?.textContent).toBe(section.title);
    expect(heading?.getAttribute('tabindex')).toBe('-1');
    expect(heading?.classList.contains('scroll-mt-24')).toBe(true);
  }
});

it('does not add an index to short pages', () => {
  render(<PolicySectionIndex sections={getPolicySections(['1. OVERVIEW'])} />);
  expect(screen.queryByTestId('policy-section-index')).toBeNull();
});
