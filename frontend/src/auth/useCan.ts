import { useCallback } from 'react';
import { useMe } from '@/auth/useMe';
import { useCompany } from '@/context/CompanyProvider';
import { can, canForAssignment, type Capability } from '@/auth/permissions';

export function useCan(capability: Capability): boolean {
  const { data: me } = useMe();
  const { activeMembership } = useCompany();
  if (me?.is_platform_admin) return true;
  if (capability === 'inventory.move') {
    return activeMembership?.role === 'platform_admin' || activeMembership?.role === 'owner' || activeMembership?.role === 'admin' || Boolean(activeMembership?.can_register_inventory_day);
  }
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
      if (capability === 'inventory.relocate') {
        const managesMovements = role === 'platform_admin' || role === 'owner' || role === 'admin' || Boolean(activeMembership?.can_register_inventory_day);
        return managesMovements || Boolean(can(role, capability) && userId && assignedUserId === userId);
      }
      return canForAssignment(role, capability, assignedUserId, userId);
    },
    [activeMembership?.can_register_inventory_day, capability, isPlatformAdmin, role, userId],
  );
}
