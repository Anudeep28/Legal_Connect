import type { ReactNode } from 'react';
import { Link } from 'wouter';
import { ShieldAlert, Scale } from 'lucide-react';
import type { Account, AccountRole } from '@workspace/api-client-react';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { useAccount } from '@/lib/account';
import { ErrorState, SignInPrompt } from '@/components/kit';

export function Guard({
  roles,
  children,
  signInTitle = 'Sign in to continue',
  signInBody = 'Your consultations, documents and messages live behind your account.',
}: {
  roles?: AccountRole[];
  children: (me: Account) => ReactNode;
  signInTitle?: string;
  signInBody?: string;
}) {
  const { loading, signedIn, me, error, refetch } = useAccount();
  if (loading)
    return (
      <div className="space-y-4">
        <Skeleton className="h-10 w-1/3" />
        <Skeleton className="h-5 w-1/2" />
        <Skeleton className="h-64 w-full rounded-2xl" />
      </div>
    );
  if (!signedIn) return <SignInPrompt title={signInTitle} body={signInBody} />;
  if (error || !me) return <ErrorState error={error} onRetry={() => refetch()} title="We could not load your account" />;
  if (me.status !== 'active')
    return (
      <PermissionCard
        title={`Your account is ${me.status}`}
        body="Account actions are paused. If you believe this is a mistake, write to support@consultwithlawyer.in."
      />
    );
  if (roles && !roles.includes(me.role)) {
    const lawyerOnly = roles.includes('lawyer') && me.role === 'client';
    return (
      <PermissionCard
        title={lawyerOnly ? 'This workspace is for advocates' : 'You do not have access to this page'}
        body={
          lawyerOnly
            ? 'The document workspace opens once you apply with your Bar Council details. You can use it while your application is pending review.'
            : 'This area is restricted. Access is checked on the server for every request.'
        }
        action={
          lawyerOnly ? (
            <Button asChild data-testid="button-apply-lawyer">
              <Link href="/lawyer/profile">
                <Scale /> Apply as a lawyer
              </Link>
            </Button>
          ) : (
            <Button asChild variant="outline">
              <Link href="/dashboard">Back to dashboard</Link>
            </Button>
          )
        }
      />
    );
  }
  return <>{children(me)}</>;
}

function PermissionCard({ title, body, action }: { title: string; body: string; action?: ReactNode }) {
  return (
    <div className="mx-auto max-w-lg rounded-3xl border bg-card p-10 text-center shadow-sm rise" data-testid="notice-permission">
      <div className="mx-auto mb-4 grid h-12 w-12 place-items-center rounded-2xl bg-haldi/30 text-primary">
        <ShieldAlert className="h-6 w-6" />
      </div>
      <h2 className="text-2xl font-semibold">{title}</h2>
      <p className="mt-2 text-sm leading-relaxed text-muted-foreground">{body}</p>
      {action && <div className="mt-6 flex justify-center">{action}</div>}
    </div>
  );
}
