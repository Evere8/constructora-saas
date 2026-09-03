import { useQuery } from '@tanstack/react-query';
import type { UseQueryResult } from '@tanstack/react-query';
import { authApi } from '@/lib/api/auth';
import { useAuth } from '@/auth/AuthProvider';
import type { AuthMe } from '@/types/api';

export function useMe(): UseQueryResult<AuthMe> {
  const { session } = useAuth();
  return useQuery<AuthMe>({
    queryKey: ['me', session?.user.id],
    queryFn: ({ signal }) => authApi.me(signal),
    enabled: Boolean(session),
    staleTime: 60_000,
  });
}
