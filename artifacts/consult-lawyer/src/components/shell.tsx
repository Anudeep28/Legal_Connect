import { useState, type ReactNode } from 'react';
import { Link, useLocation } from 'wouter';
import { useClerk } from '@clerk/react';
import { Bell, Menu, LogOut, Settings, Scale, ShieldCheck, LayoutDashboard, FileText, MessagesSquare, UserRound } from 'lucide-react';
import { useListNotifications, getListNotificationsQueryKey } from '@workspace/api-client-react';
import { Button } from '@/components/ui/button';
import { Sheet, SheetContent, SheetTitle } from '@/components/ui/sheet';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { cn } from '@/lib/utils';
import { useAccount } from '@/lib/account';
import { LogoMark, PersonAvatar } from '@/components/kit';

const basePath = import.meta.env.BASE_URL.replace(/\/$/, '');

const publicLinks = [
  { href: '/lawyers', label: 'Find a lawyer' },
  { href: '/templates', label: 'Templates' },
  { href: '/plans', label: 'Plans' },
  { href: '/for-lawyers', label: 'For lawyers' },
];

function NavLink({ href, children, onClick }: { href: string; children: ReactNode; onClick?: () => void }) {
  const [loc] = useLocation();
  const active = loc === href || (href !== '/' && loc.startsWith(href + '/'));
  return (
    <Link
      href={href}
      onClick={onClick}
      className={cn(
        'relative rounded-full px-3.5 py-2 text-[14px] font-medium transition-colors',
        active ? 'bg-primary/8 text-primary' : 'text-foreground/70 hover:text-foreground',
      )}
      data-testid={`link-nav-${href.replace(/\//g, '') || 'home'}`}
    >
      {children}
      {active && <span className="absolute inset-x-4 -bottom-0.5 h-[2px] rounded-full bg-haldi" />}
    </Link>
  );
}

export function SiteHeader() {
  const { signedIn, me, user } = useAccount();
  const { signOut } = useClerk();
  const [open, setOpen] = useState(false);
  const notifs = useListNotifications({ query: { enabled: signedIn, queryKey: getListNotificationsQueryKey(), refetchInterval: 30000 } });
  const unread = (notifs.data ?? []).filter((n) => !n.read).length;
  const name = me?.name || user?.fullName || 'Account';

  const appLinks = signedIn
    ? [
        { href: '/dashboard', label: 'Dashboard', icon: LayoutDashboard },
        { href: '/consultations', label: 'Consultations', icon: MessagesSquare },
        ...(me && me.role !== 'client' ? [{ href: '/documents', label: 'Documents', icon: FileText }] : []),
      ]
    : [];

  return (
    <header className="sticky top-0 z-40 border-b border-border/70 bg-background/85 backdrop-blur-md">
      <div className="mx-auto flex h-16 max-w-7xl items-center gap-3 px-4 md:px-6">
        <Link href={signedIn ? '/dashboard' : '/'} className="flex items-center gap-2.5" data-testid="link-logo">
          <LogoMark />
          <span className="leading-none">
            <span className="block font-display text-[17px] font-semibold">Consult with Lawyer</span>
            <span className="block font-mono text-[9.5px] uppercase tracking-[0.22em] text-muted-foreground">Advocates, on call</span>
          </span>
        </Link>
        <nav className="ml-6 hidden items-center gap-0.5 lg:flex">
          {appLinks.map((l) => (
            <NavLink key={l.href} href={l.href}>
              {l.label}
            </NavLink>
          ))}
          {publicLinks.map((l) => (
            <NavLink key={l.href} href={l.href}>
              {l.label}
            </NavLink>
          ))}
        </nav>
        <div className="ml-auto flex items-center gap-2">
          {signedIn ? (
            <>
              <Link href="/notifications" className="relative grid h-10 w-10 place-items-center rounded-full hover:bg-muted" data-testid="link-notifications">
                <Bell className="h-[18px] w-[18px]" />
                {unread > 0 && (
                  <span className="absolute right-1 top-1 grid h-[18px] min-w-[18px] place-items-center rounded-full bg-haldi px-1 font-mono text-[10px] font-semibold text-ink" data-testid="text-unread-count">
                    {unread}
                  </span>
                )}
              </Link>
              <DropdownMenu>
                <DropdownMenuTrigger className="rounded-full outline-none ring-ring focus-visible:ring-2" data-testid="button-account-menu">
                  <PersonAvatar name={name} src={user?.imageUrl} className="h-9 w-9 rounded-full" />
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="w-60">
                  <DropdownMenuLabel>
                    <div className="truncate">{name}</div>
                    <div className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground">{me?.role ?? '...'}</div>
                  </DropdownMenuLabel>
                  <DropdownMenuSeparator />
                  <MenuLink href="/dashboard" icon={<LayoutDashboard />} label="Dashboard" />
                  <MenuLink href="/consultations" icon={<MessagesSquare />} label="Consultations" />
                  {me?.role !== 'client' && <MenuLink href="/documents" icon={<FileText />} label="Documents" />}
                  <MenuLink href="/lawyer/profile" icon={me?.role === 'client' ? <Scale /> : <UserRound />} label={me?.role === 'client' ? 'Apply as a lawyer' : 'Professional profile'} />
                  {me?.role === 'admin' && <MenuLink href="/admin" icon={<ShieldCheck />} label="Admin" />}
                  <MenuLink href="/settings" icon={<Settings />} label="Settings" />
                  <DropdownMenuSeparator />
                  <DropdownMenuItem onClick={() => signOut({ redirectUrl: basePath || '/' })} data-testid="button-signout">
                    <LogOut className="h-4 w-4" /> Sign out
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </>
          ) : (
            <>
              <Button asChild variant="ghost" className="hidden sm:inline-flex rounded-full" data-testid="button-signin">
                <Link href="/sign-in">Sign in</Link>
              </Button>
              <Button asChild className="rounded-full" data-testid="button-signup">
                <Link href="/sign-up">Get started</Link>
              </Button>
            </>
          )}
          <Button variant="ghost" size="icon" className="lg:hidden" onClick={() => setOpen(true)} data-testid="button-mobile-menu">
            <Menu />
          </Button>
        </div>
      </div>
      <Sheet open={open} onOpenChange={setOpen}>
        <SheetContent side="right" className="w-[300px] bg-background">
          <SheetTitle className="font-display">Menu</SheetTitle>
          <div className="mt-6 flex flex-col gap-1">
            {[...appLinks, ...publicLinks].map((l) => (
              <NavLink key={l.href} href={l.href} onClick={() => setOpen(false)}>
                {l.label}
              </NavLink>
            ))}
            {signedIn && (
              <>
                <NavLink href="/notifications" onClick={() => setOpen(false)}>Notifications</NavLink>
                <NavLink href="/lawyer/profile" onClick={() => setOpen(false)}>{me?.role === 'client' ? 'Apply as a lawyer' : 'Professional profile'}</NavLink>
                {me?.role === 'admin' && <NavLink href="/admin" onClick={() => setOpen(false)}>Admin</NavLink>}
                <NavLink href="/settings" onClick={() => setOpen(false)}>Settings</NavLink>
              </>
            )}
          </div>
        </SheetContent>
      </Sheet>
    </header>
  );
}

function MenuLink({ href, icon, label }: { href: string; icon: ReactNode; label: string }) {
  const [, setLocation] = useLocation();
  return (
    <DropdownMenuItem onClick={() => setLocation(href)} className="gap-2 [&_svg]:h-4 [&_svg]:w-4" data-testid={`menu-${href.replace(/\//g, '-')}`}>
      {icon} {label}
    </DropdownMenuItem>
  );
}

export function SiteFooter() {
  return (
    <footer className="mt-24 ink-panel">
      <div className="mx-auto grid max-w-7xl gap-10 px-6 py-14 md:grid-cols-[1.4fr_1fr_1fr_1fr]">
        <div>
          <div className="flex items-center gap-2.5">
            <LogoMark />
            <span className="font-display text-xl">Consult with Lawyer</span>
          </div>
          <p className="mt-4 max-w-sm text-sm leading-relaxed text-white/65">
            A technology platform that helps you find and request time with Indian advocates. We do not practise law. Information on this site is general and is not legal advice.
          </p>
        </div>
        <FooterCol title="Clients" links={[['/lawyers', 'Find a lawyer'], ['/templates', 'Legal templates'], ['/plans', 'Plans']]} />
        <FooterCol title="Advocates" links={[['/for-lawyers', 'Why join'], ['/lawyer/profile', 'Apply'], ['/documents', 'Document workspace']]} />
        <FooterCol title="Policies" links={[['/terms', 'Terms of service'], ['/privacy', 'Privacy policy'], ['/disclaimer', 'Disclaimer'], ['/refund-policy', 'Refund policy']]} />
      </div>
      <div className="border-t border-white/10">
        <div className="mx-auto flex max-w-7xl flex-col gap-2 px-6 py-5 font-mono text-[11px] uppercase tracking-widest text-white/45 md:flex-row md:justify-between">
          <span>Pilot service · checkout requires verification · calls not connected</span>
          <span>Times shown in IST</span>
        </div>
      </div>
    </footer>
  );
}

function FooterCol({ title, links }: { title: string; links: [string, string][] }) {
  return (
    <div>
      <h4 className="font-mono text-[11px] uppercase tracking-[0.2em] text-haldi">{title}</h4>
      <ul className="mt-4 space-y-2.5">
        {links.map(([href, label]) => (
          <li key={href}>
            <Link href={href} className="text-sm text-white/75 transition-colors hover:text-white">
              {label}
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}

export function AppPage({ children, wide }: { children: ReactNode; wide?: boolean }) {
  return <main className={cn('mx-auto w-full px-4 pb-10 pt-10 md:px-6', wide ? 'max-w-7xl' : 'max-w-6xl')}>{children}</main>;
}
