import { api } from '@/lib/http';
import type {
  Company,
  CompanyOnboardingResult,
  Paginated,
  Plan,
  PlatformMembership,
  Role,
} from '@/types/api';

type MaybePaginated<T> = Paginated<T> | T[];

export const platformApi = {
  listPlans: (signal?: AbortSignal) => api.get<MaybePaginated<Plan>>('/v1/platform/plans', undefined, signal),
  createPlan: (input: Pick<Plan, 'code' | 'name' | 'limits_json' | 'is_active'>) =>
    api.post<Plan>('/v1/platform/plans', input),
  updatePlan: (
    planId: string,
    input: Partial<Pick<Plan, 'name' | 'limits_json' | 'is_active'>>,
  ) =>
    api.patch<Plan>(`/v1/platform/plans/${planId}`, input),

  listCompanies: (signal?: AbortSignal) =>
    api.get<MaybePaginated<Company>>('/v1/platform/companies', undefined, signal),
  createCompany: (input: { name: string; slug?: string; plan_id?: string; status?: string }) =>
    api.post<Company>('/v1/platform/companies', input),
  onboardCompany: (input: {
    name: string;
    slug: string;
    plan_id?: string;
    status: string;
    owner_email: string;
    owner_full_name: string;
  }) => api.post<CompanyOnboardingResult>('/v1/platform/companies/onboard', input),
  getCompany: (companyId: string, signal?: AbortSignal) =>
    api.get<Company>(`/v1/platform/companies/${companyId}`, undefined, signal),
  updateCompany: (companyId: string, input: Partial<Company>) =>
    api.patch<Company>(`/v1/platform/companies/${companyId}`, input),

  listMemberships: (companyId: string, signal?: AbortSignal) =>
    api.get<MaybePaginated<PlatformMembership>>(
      `/v1/platform/companies/${companyId}/memberships`,
      undefined,
      signal,
    ),
  createMembership: (
    companyId: string,
    input: { email: string; full_name?: string; role: Role; status?: string },
  ) =>
    api.post<PlatformMembership>(`/v1/platform/companies/${companyId}/memberships`, input),
  updateMembership: (membershipId: string, input: { role?: Role; status?: string }) =>
    api.patch<PlatformMembership>(`/v1/platform/memberships/${membershipId}`, input),
};
