import { useEffect, useState } from 'react';
import { ClerkFailed, ClerkLoaded, ClerkLoading, SignIn, SignUp } from '@clerk/react';
import { Link } from 'wouter';
import { Loader2 } from 'lucide-react';
import { LogoMark } from '@/components/kit';
import { Button } from '@/components/ui/button';

const basePath = import.meta.env.BASE_URL.replace(/\/$/, '');
const SLOW_AFTER_MS = 12000;

function AuthUnavailable({ slow }: { slow?: boolean }) {
  return (
    <div className="rounded-[1.6rem] border bg-card p-6 text-center shadow-sm" role="alert" data-testid="auth-unavailable">
      <h1 className="font-display text-2xl font-semibold">{slow ? 'Sign-in is taking longer than usual' : 'Sign-in could not load'}</h1>
      <p className="mt-3 text-sm leading-relaxed text-muted-foreground">
        Check your connection and reload. If you use Brave or a content blocker, turn off its shields for consultwithlawyer.in, or try Safari or Chrome.
      </p>
      <div className="mt-5 flex flex-col justify-center gap-2 sm:flex-row">
        <Button className="rounded-full" onClick={() => window.location.reload()} data-testid="button-auth-reload">Reload</Button>
        <Button asChild variant="outline" className="rounded-full"><Link href="/">Back to home</Link></Button>
      </div>
    </div>
  );
}

function AuthLoading() {
  const [slow, setSlow] = useState(false);
  useEffect(() => {
    const t = window.setTimeout(() => setSlow(true), SLOW_AFTER_MS);
    return () => window.clearTimeout(t);
  }, []);
  if (slow) return <AuthUnavailable slow />;
  return (
    <div className="flex flex-col items-center gap-3 py-16 text-sm text-muted-foreground" role="status" data-testid="auth-loading">
      <Loader2 className="h-6 w-6 animate-spin text-primary" aria-hidden />
      Loading secure sign-in…
    </div>
  );
}

function AuthWidget({ children }: { children: React.ReactNode }) {
  return (
    <>
      <ClerkLoading><AuthLoading /></ClerkLoading>
      <ClerkFailed><AuthUnavailable /></ClerkFailed>
      <ClerkLoaded>{children}</ClerkLoaded>
    </>
  );
}

function AuthLayout({ children, title, body }: { children: React.ReactNode; title: string; body: string }) {
  return (
    <div className="grid min-h-[100dvh] w-full min-w-0 lg:grid-cols-[1fr_1.1fr]">
      <aside className="ink-panel relative hidden flex-col justify-between overflow-hidden p-12 lg:flex">
        <Link href="/" className="flex items-center gap-3"><LogoMark /><span className="font-display text-xl text-white">Consult with Lawyer</span></Link>
        <div className="relative z-10">
          <h1 className="text-5xl font-semibold leading-[1.02] text-white">{title}</h1>
          <p className="mt-4 max-w-md text-white/70">{body}</p>
        </div>
        <p className="font-mono text-[11px] uppercase tracking-widest text-white/40">Fees per 30-minute consultation · Times in IST</p>
        <img src={`${basePath}/images/hero.png`} alt="" className="pointer-events-none absolute -bottom-20 -right-24 w-[70%] rotate-3 rounded-[2rem] opacity-25" />
      </aside>
      <main className="flex min-w-0 items-center justify-center bg-background px-4 py-12">
        <div className="w-full min-w-0 max-w-[460px]">
          <Link href="/" className="mb-8 flex items-center justify-center gap-2 lg:hidden"><LogoMark /><span className="font-display text-lg">Consult with Lawyer</span></Link>
          <AuthWidget>{children}</AuthWidget>
        </div>
      </main>
    </div>
  );
}

export function SignInPage() {
  return (
    <AuthLayout title="Welcome back." body="Pick up your consultation requests, messages and documents where you left them.">
      <SignIn routing="path" path={`${basePath}/sign-in`} signUpUrl={`${basePath}/sign-up`} />
    </AuthLayout>
  );
}

export function SignUpPage() {
  return (
    <AuthLayout title="A calmer way to get legal help." body="Create a free account to request time with advocates. Advocates can apply to list their practice after signing up.">
      <SignUp routing="path" path={`${basePath}/sign-up`} signInUrl={`${basePath}/sign-in`} />
    </AuthLayout>
  );
}
