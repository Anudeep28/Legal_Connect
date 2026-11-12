import { useUser } from '@clerk/react';
import { useGetMe, getGetMeQueryKey } from '@workspace/api-client-react';

export function useAccount() {
  const { isLoaded, isSignedIn, user } = useUser();
  const signedIn = isLoaded && !!isSignedIn;
  const me = useGetMe({ query: { enabled: signedIn, queryKey: getGetMeQueryKey() } });
  return {
    clerkLoaded: isLoaded,
    signedIn,
    user,
    me: me.data,
    loading: !isLoaded || (signedIn && me.isLoading),
    error: me.error,
    refetch: me.refetch,
  };
}
