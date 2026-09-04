import { createContext, useContext, useEffect, useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import { useMe } from '@/auth/useMe';
import type { Membership } from '@/types/api';

const STORAGE_KEY = 'obrixapy.activeCompany';

interface CompanyContextValue {
  memberships: Membership[];
  activeCompanyId: string | null;
  activeMembership: Membership | null;
  setActiveCompanyId: (id: string) => void;
}

const CompanyContext = createContext<CompanyContextValue | undefined>(undefined);

export function CompanyProvider({ children }: { children: ReactNode }) {
  const { data: me } = useMe();
  const [activeCompanyId, setActive] = useState<string | null>(() =>
    typeof window === 'undefined' ? null : window.localStorage.getItem(STORAGE_KEY),
  );

  const memberships = useMemo<Membership[]>(
    () =>
      (me?.memberships ?? []).filter(
        (m) => m.membership_status === 'active' && m.company_status === 'active',
      ),
    [me],
  );

  useEffect(() => {
    if (memberships.length === 0) {
      if (activeCompanyId !== null) {
        setActive(null);
        window.localStorage.removeItem(STORAGE_KEY);
      }
      return;
    }
    const exists = activeCompanyId && memberships.some((m) => m.company_id === activeCompanyId);
    if (!exists) {
      const first = memberships[0].company_id;
      setActive(first);
      window.localStorage.setItem(STORAGE_KEY, first);
    }
  }, [memberships, activeCompanyId]);

  const setActiveCompanyId = (id: string) => {
    setActive(id);
    window.localStorage.setItem(STORAGE_KEY, id);
  };

  const activeMembership = useMemo(
    () => memberships.find((m) => m.company_id === activeCompanyId) ?? null,
    [memberships, activeCompanyId],
  );

  const value = useMemo<CompanyContextValue>(
    () => ({ memberships, activeCompanyId, activeMembership, setActiveCompanyId }),
    [memberships, activeCompanyId, activeMembership],
  );

  return <CompanyContext.Provider value={value}>{children}</CompanyContext.Provider>;
}

// eslint-disable-next-line react-refresh/only-export-components
export function useCompany(): CompanyContextValue {
  const ctx = useContext(CompanyContext);
  if (!ctx) throw new Error('useCompany debe usarse dentro de CompanyProvider');
  return ctx;
}
