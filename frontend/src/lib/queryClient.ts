import { QueryClient } from '@tanstack/react-query';
import { ApiError } from '@/lib/http';

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: (failureCount, error) => {
        // Never retry auth/permission/validation errors.
        if (error instanceof ApiError && [401, 403, 404, 422].includes(error.status)) {
          return false;
        }
        return failureCount < 1;
      },
      staleTime: 30_000,
      refetchOnWindowFocus: false,
    },
  },
});
