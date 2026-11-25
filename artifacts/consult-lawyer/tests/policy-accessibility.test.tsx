import { afterEach, expect, it, vi } from 'vitest';
import { cleanup, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Router } from 'wouter';
import { memoryLocation } from 'wouter/memory-location';
import { SiteFooter, SiteHeader } from '@/components/shell';
import { Policy } from '@/pages/simple';
import { policies } from '@/data/policies';
import { getPolicySections } from '@/lib/policy-sections';

vi.mock('@clerk/react', () => ({
  useClerk: () => ({ signOut: vi.fn() }),
}));

vi.mock('@/lib/account', () => ({
  useAccount: () => ({ signedIn: false, me: null, user: null }),
}));

vi.mock('@workspace/api-client-react', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@workspace/api-client-react')>();
  return {
    ...actual,
    useGetPlatform: () => ({ data: { legalReviewComplete: true } }),
    useListNotifications: () => ({ data: [] }),
  };
});

afterEach(cleanup);

const pageCases = [
  { path: '/privacy', title: 'Privacy Policy', key: 'privacy' },
  { path: '/disclaimer', title: 'Disclaimer', key: 'disclaimer' },
  { path: '/terms', title: 'Terms of Service', key: 'terms' },
  { path: '/refund-policy', title: 'Refund & Cancellation Policy', key: 'refunds' },
] as const;

function renderPolicy(path: string, title: string) {
  const { hook } = memoryLocation({ path });
  return render(
    <Router hook={hook}>
      <SiteHeader />
      <Policy path={path} />
      <SiteFooter />
    </Router>,
  );
}

it.each(pageCases)('$title exposes a clear landmark and ordered headings', ({ path, title, key }) => {
  const { container } = renderPolicy(path, title);
  const main = screen.getByRole('main');
  expect(within(main).getByRole('heading', { level: 1, name: title })).toBeTruthy();
  const article = within(main).getByRole('article', { name: title });
  expect(screen.getByRole('contentinfo')).toBeTruthy();

  const sections = getPolicySections(policies[key].split(/\n\s*\n/).slice(1));
  const articleHeadings = Array.from(article.querySelectorAll('h1, h2, h3, h4, h5, h6'));
  expect(articleHeadings.filter((heading) => heading.tagName === 'H2')).toHaveLength(sections.length);
  expect(articleHeadings.every((heading) => heading.tagName === 'H2')).toBe(true);
  for (const section of sections) {
    expect(main.querySelector(`#${section.id}`)?.textContent).toBe(section.title);
  }

  const policyNav = screen.getByRole('navigation', { name: 'Policies links' });
  for (const label of ['Terms of Service', 'Privacy Policy', 'Disclaimer', 'Refund and Cancellation Policy']) {
    expect(within(policyNav).getByRole('link', { name: label })).toBeTruthy();
  }
  expect(container.querySelector('main')).toBe(main);
});

it.each(pageCases)('$title keeps every policy block in the print layout', ({ path, title, key }) => {
  renderPolicy(path, title);
  const main = screen.getByRole('main');
  const article = within(main).getByRole('article', { name: title });
  const blocks = policies[key].split(/\n\s*\n/).slice(1).map((block) => block.trim());
  const renderedBlocks = Array.from(article.children).map((element) => element.textContent?.trim() ?? '');

  expect(renderedBlocks).toEqual(blocks);
  expect(main.querySelectorAll('.policy-print-hide')).toHaveLength(2);
  expect(main.querySelector('.policy-section-index')?.classList.contains('print:hidden')).toBe(true);
  expect(article.classList.contains('policy-print-article')).toBe(true);
});

it('supports keyboard access and visible focus styling on navigation and section links', async () => {
  const user = userEvent.setup();
  renderPolicy('/privacy', 'Privacy Policy');

  await user.tab();
  const skipLink = screen.getByTestId('link-skip-policy');
  expect(document.activeElement).toBe(skipLink);
  expect(skipLink.textContent).toBe('Skip to policy content');
  expect(skipLink.getAttribute('href')).toBe('#main-content');
  expect(screen.getByRole('main').getAttribute('tabindex')).toBe('-1');
  expect(skipLink.className).toContain('focus-visible:ring-2');
  await user.tab();
  const logo = screen.getByTestId('link-logo');
  expect(document.activeElement).toBe(logo);
  expect(logo.className).toContain('focus-visible:ring-2');

  const primary = screen.getByRole('navigation', { name: 'Primary navigation' });
  const primaryLink = within(primary).getByRole('link', { name: 'Find a lawyer' });
  expect(primaryLink.className).toContain('focus-visible:ring-2');

  const toggle = screen.getByTestId('policy-section-index-toggle');
  toggle.focus();
  expect(document.activeElement).toBe(toggle);
  await user.keyboard('{Enter}');
  const sectionNav = screen.getByRole('navigation', { name: 'Policy sections' });
  const sectionLinks = within(sectionNav).getAllByRole('link');
  await user.tab();
  expect(document.activeElement).toBe(sectionLinks[0]);
  expect(sectionLinks[0].className).toContain('focus-visible:ring-2');
  for (const link of sectionLinks.slice(1)) {
    await user.tab();
    expect(document.activeElement).toBe(link);
  }
  const footerNav = screen.getByRole('navigation', { name: 'Policies links' });
  const refundLink = within(footerNav).getByRole('link', { name: 'Refund and Cancellation Policy' });
  for (let index = 0; index < 10 && document.activeElement !== refundLink; index += 1) {
    await user.tab();
  }
  expect(document.activeElement).toBe(refundLink);
  expect(refundLink.className).toContain('focus-visible:ring-2');
});

it('gives the compact mobile menu an accessible name and labelled navigation', async () => {
  const user = userEvent.setup();
  renderPolicy('/privacy', 'Privacy Policy');
  const menuButton = screen.getByRole('button', { name: 'Open navigation menu' });
  await user.click(menuButton);
  expect(screen.getByRole('navigation', { name: 'Mobile navigation' })).toBeTruthy();
});
