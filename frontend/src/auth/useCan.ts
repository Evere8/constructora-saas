import { useMe } from '@/auth/useMe';
import { useCompany } from '@/context/CompanyProvider';
import { can, type Capability } from '@/auth/permissions';

export function useCan(capability: Capability): boolean {
  const { data: me } = useMe();
  const { activeMembership } = useCompany();
  if (me?.is_platform_admin) return true;
  return can(activeMembership?.role, capability);
}
