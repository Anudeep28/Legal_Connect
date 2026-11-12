import { useEffect, useRef, type ReactNode } from 'react';
import { QueryClient, QueryClientProvider, useQueryClient } from '@tanstack/react-query';
import { ClerkProvider, Show, useClerk } from '@clerk/react';
import { publishableKeyFromHost } from '@clerk/react/internal';
import { shadcn } from '@clerk/themes';
import { Redirect, Route, Switch, useLocation, Router as WouterRouter } from 'wouter';
import { ErrorBoundary } from '@/components/error-boundary';
import { Toaster } from '@/components/ui/toaster';
import { TooltipProvider } from '@/components/ui/tooltip';
import NotFound from '@/pages/not-found';
import { SiteFooter, SiteHeader } from '@/components/shell';
import Home from '@/pages/home';
import Lawyers from '@/pages/lawyers';
import LawyerDetail from '@/pages/lawyer-detail';
import Dashboard from '@/pages/dashboard';
import Consultations from '@/pages/consultations';
import ConsultationDetail from '@/pages/consultation-detail';
import Documents from '@/pages/documents';
import DocumentEditor from '@/pages/document-editor';
import Templates from '@/pages/templates';
import LawyerProfilePage from '@/pages/lawyer-profile';
import Admin from '@/pages/admin';
import { ForLawyers, Notifications, Plans, Policy, Settings } from '@/pages/simple';
import { SignInPage, SignUpPage } from '@/pages/auth';

const queryClient = new QueryClient({ defaultOptions: { queries: { staleTime: 15000, refetchOnWindowFocus: false } } });

const clerkPubKey = publishableKeyFromHost(
  window.location.hostname,
  import.meta.env.VITE_CLERK_PUBLISHABLE_KEY,
);

const clerkProxyUrl = import.meta.env.VITE_CLERK_PROXY_URL;

const basePath = import.meta.env.BASE_URL.replace(/\/$/, '');

function stripBase(path: string): string {
  return basePath && path.startsWith(basePath)
    ? path.slice(basePath.length) || '/'
    : path;
}

if (!clerkPubKey) {
  throw new Error('Missing VITE_CLERK_PUBLISHABLE_KEY in .env file');
}

const clerkAppearance = {
  theme: shadcn,
  cssLayerName: 'clerk',
  options: {
    logoPlacement: 'inside' as const,
    logoLinkUrl: basePath || '/',
    logoImageUrl: `${window.location.origin}${basePath}/logo.svg`,
  },
  variables: {
    colorPrimary: 'hsl(232 58% 30%)',
    colorForeground: 'hsl(232 38% 14%)',
    colorMutedForeground: 'hsl(232 12% 38%)',
    colorDanger: 'hsl(4 70% 46%)',
    colorBackground: 'hsl(42 60% 98.5%)',
    colorInput: 'hsl(40 45% 96%)',
    colorInputForeground: 'hsl(232 38% 14%)',
    colorNeutral: 'hsl(232 38% 14%)',
    fontFamily: "'Bricolage Grotesque', ui-sans-serif, sans-serif",
    borderRadius: '0.85rem',
  },
  elements: {
    rootBox: 'w-full flex justify-center',
    cardBox: 'bg-[hsl(42_60%_98.5%)] rounded-[1.6rem] w-[440px] max-w-full overflow-hidden border border-[hsl(36_25%_84%)] shadow-[0_20px_50px_-12px_hsl(232_40%_20%/0.25)]',
    card: '!shadow-none !border-0 !bg-transparent !rounded-none',
    footer: '!shadow-none !border-0 !bg-transparent !rounded-none',
    headerTitle: "text-[hsl(232_38%_14%)] text-2xl font-semibold [font-family:'Fraunces',serif]",
    headerSubtitle: 'text-[hsl(232_12%_38%)]',
    socialButtonsBlockButtonText: 'text-[hsl(232_38%_14%)] font-medium',
    formFieldLabel: 'text-[hsl(232_38%_18%)] font-medium',
    footerActionLink: 'text-[hsl(232_58%_30%)] font-semibold',
    footerActionText: 'text-[hsl(232_12%_38%)]',
    dividerText: 'text-[hsl(232_12%_40%)]',
    identityPreviewEditButton: 'text-[hsl(232_58%_30%)]',
    formFieldSuccessText: 'text-[hsl(168_45%_26%)]',
    alertText: 'text-[hsl(232_38%_14%)]',
    logoBox: 'h-12 justify-center',
    logoImage: 'h-12 w-12',
    socialButtonsBlockButton: 'border border-[hsl(36_22%_78%)] bg-[hsl(40_45%_96%)] rounded-xl',
    formButtonPrimary: 'bg-[hsl(232_58%_30%)] text-[hsl(40_60%_97%)] rounded-full h-11 font-medium shadow-none',
    formFieldInput: 'bg-[hsl(40_45%_96%)] text-[hsl(232_38%_14%)] border border-[hsl(36_22%_78%)] rounded-xl h-11',
    footerAction: 'justify-center',
    dividerLine: 'bg-[hsl(36_25%_84%)]',
    alert: 'bg-[hsl(41_92%_56%/0.15)] border border-[hsl(41_92%_56%/0.5)] rounded-xl',
    otpCodeFieldInput: 'border border-[hsl(36_22%_78%)] text-[hsl(232_38%_14%)]',
    formFieldRow: 'gap-3',
    main: 'gap-5',
  },
};

function ClerkQueryClientCacheInvalidator() {
  const { addListener } = useClerk();
  const qc = useQueryClient();
  const prevUserIdRef = useRef<string | null | undefined>(undefined);

  useEffect(() => {
    const unsubscribe = addListener(({ user }) => {
      const userId = user?.id ?? null;
      if (prevUserIdRef.current !== undefined && prevUserIdRef.current !== userId) {
        qc.clear();
      }
      prevUserIdRef.current = userId;
    });
    return unsubscribe;
  }, [addListener, qc]);

  return null;
}

function HomeRedirect() {
  return (
    <>
      <Show when="signed-in">
        <Redirect to="/dashboard" />
      </Show>
      <Show when="signed-out">
        <Home />
      </Show>
    </>
  );
}

function ScrollTop() {
  const [loc] = useLocation();
  useEffect(() => {
    window.scrollTo(0, 0);
  }, [loc]);
  return null;
}

function Shell({ children }: { children: ReactNode }) {
  return (
    <div className="flex min-h-[100dvh] flex-col">
      <SiteHeader />
      <div className="flex-1">{children}</div>
      <SiteFooter />
    </div>
  );
}

function RoutedErrorBoundary({ children }: { children: ReactNode }) {
  const [location] = useLocation();
  return <ErrorBoundary resetKey={location}>{children}</ErrorBoundary>;
}

function AppRoutes() {
  const [location] = useLocation();
  const isAuth = location.startsWith('/sign-in') || location.startsWith('/sign-up');
  if (isAuth)
    return (
      <Switch>
        <Route path="/sign-in/*?" component={SignInPage} />
        <Route path="/sign-up/*?" component={SignUpPage} />
      </Switch>
    );
  return (
    <Shell>
      <ScrollTop />
      <RoutedErrorBoundary>
        <Switch>
          <Route path="/" component={HomeRedirect} />
          <Route path="/sign-in/*?" component={SignInPage} />
          <Route path="/sign-up/*?" component={SignUpPage} />
          <Route path="/lawyers" component={Lawyers} />
          <Route path="/lawyers/:id" component={LawyerDetail} />
          <Route path="/dashboard" component={Dashboard} />
          <Route path="/consultations" component={Consultations} />
          <Route path="/consultations/:id" component={ConsultationDetail} />
          <Route path="/documents" component={Documents} />
          <Route path="/documents/:id" component={DocumentEditor} />
          <Route path="/templates" component={Templates} />
          <Route path="/for-lawyers" component={ForLawyers} />
          <Route path="/lawyer/profile" component={LawyerProfilePage} />
          <Route path="/plans" component={Plans} />
          <Route path="/settings" component={Settings} />
          <Route path="/notifications" component={Notifications} />
          <Route path="/admin" component={Admin} />
          <Route path="/privacy">{() => <Policy path="/privacy" />}</Route>
          <Route path="/disclaimer">{() => <Policy path="/disclaimer" />}</Route>
          <Route path="/terms">{() => <Policy path="/terms" />}</Route>
          <Route path="/refund-policy">{() => <Policy path="/refund-policy" />}</Route>
          <Route component={NotFound} />
        </Switch>
      </RoutedErrorBoundary>
    </Shell>
  );
}

function ClerkProviderWithRoutes() {
  const [, setLocation] = useLocation();

  return (
    <ClerkProvider
      publishableKey={clerkPubKey}
      proxyUrl={clerkProxyUrl}
      appearance={clerkAppearance}
      signInUrl={`${basePath}/sign-in`}
      signUpUrl={`${basePath}/sign-up`}
      localization={{
        signIn: { start: { title: 'Welcome back', subtitle: 'Sign in to your consultations and documents' } },
        signUp: { start: { title: 'Create your free account', subtitle: 'Find an advocate in minutes' } },
      }}
      routerPush={(to) => setLocation(stripBase(to))}
      routerReplace={(to) => setLocation(stripBase(to), { replace: true })}
    >
      <QueryClientProvider client={queryClient}>
        <ClerkQueryClientCacheInvalidator />
        <TooltipProvider>
          <AppRoutes />
          <Toaster />
        </TooltipProvider>
      </QueryClientProvider>
    </ClerkProvider>
  );
}

function App() {
  return (
    <WouterRouter base={basePath}>
      <ClerkProviderWithRoutes />
    </WouterRouter>
  );
}

export default App;
