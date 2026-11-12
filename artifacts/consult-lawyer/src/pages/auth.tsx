import { SignIn, SignUp } from '@clerk/react';
import { Link } from 'wouter';
import { LogoMark } from '@/components/kit';

const basePath = import.meta.env.BASE_URL.replace(/\/$/, '');

function AuthLayout({ children, title, body }: { children: React.ReactNode; title: string; body: string }) {
  return (
    <div className="grid min-h-[100dvh] lg:grid-cols-[1fr_1.1fr]">
      <aside className="ink-panel relative hidden flex-col justify-between overflow-hidden p-12 lg:flex">
        <Link href="/" className="flex items-center gap-3"><LogoMark /><span className="font-display text-xl text-white">Consult with Lawyer</span></Link>
        <div className="relative z-10">
          <h1 className="text-5xl font-semibold leading-[1.02] text-white">{title}</h1>
          <p className="mt-4 max-w-md text-white/70">{body}</p>
        </div>
        <p className="font-mono text-[11px] uppercase tracking-widest text-white/40">Fees per 30-minute consultation · Times in IST</p>
        <img src={`${basePath}/images/hero.png`} alt="" className="pointer-events-none absolute -bottom-20 -right-24 w-[70%] rotate-3 rounded-[2rem] opacity-25" />
      </aside>
      <main className="flex items-center justify-center bg-background px-4 py-12">
        <div className="w-full max-w-[460px]">
          <Link href="/" className="mb-8 flex items-center justify-center gap-2 lg:hidden"><LogoMark /><span className="font-display text-lg">Consult with Lawyer</span></Link>
          {children}
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
