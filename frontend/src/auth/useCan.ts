import { useCallback } from 'react';
import { useMe } from '@/auth/useMe';
import { useCompany } from '@/context/CompanyProvider';
import { can, canForAssignment, type Capability } from '@/auth/permissions';

export function useCan(capability: Capability): boolean {
  const { data: me } = useMe();
  const { activeMembership } = useCompany();
  if (me?.is_platform_admin) return true;
  return can(activeMembership?.role, capability);
}

export function useCanAssigned(
  capability: Capability,
): (assignedUserId?: string | null) => boolean {
  const { data: me } = useMe();
  const { activeMembership } = useCompany();
  const isPlatformAdmin = me?.is_platform_admin ?? false;
  const role = activeMembership?.role;
  const userId = me?.id;
  return useCallback(
    (assignedUserId) => {
      if (isPlatformAdmin) return true;
      return canForAssignment(role, capability, assignedUserId, userId);
    },
    [capability, isPlatformAdmin, role, userId],
  );
}
