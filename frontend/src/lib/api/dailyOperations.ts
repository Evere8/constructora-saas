import { api } from '@/lib/http';

export interface InventoryDay {
  id: string;
  snapshot_date: string;
  revision: number;
  registered_at: string;
  registered_by_user_id: string;
  items: { item_id: string; name: string; code: string; project_id: string | null; quantity: string; status: string }[];
}

export interface RestockRequest {
  id: string;
  project_id: string | null;
  name: string;
  quantity: number;
  note: string | null;
  status: string;
  created_at: string;
}

export interface ActivityDefinition {
  id: string;
  title: string;
  is_active: boolean;
  requirements: { name: string; quantity: number }[];
}

export interface DailyActivityEntry {
  project_id: string;
  project_name: string;
  activity_definition_id: string | null;
  activity_title: string | null;
  assigned_user_id: string | null;
  assigned_user_name: string | null;
  task_id: string | null;
  task_status: string | null;
  custom_status_label: string | null;
  people_count: number;
  note: string | null;
  verification: 'ready' | 'missing' | 'incomplete';
  missing_tools: string[];
}

export interface DailyActivityPlan {
  id: string | null;
  revision: string | null;
  plan_date: string;
  registered_at: string | null;
  inventory_registered_at: string | null;
  total_people: number;
  entries: DailyActivityEntry[];
}

const base = (companyId: string) => `/v1/companies/${companyId}`;

export const dailyOperationsApi = {
  inventoryDays: (companyId: string, signal?: AbortSignal, offset = 0) => api.get<InventoryDay[]>(`${base(companyId)}/inventory/days`, { offset, limit: 30 }, signal),
  registerInventory: (companyId: string, snapshot_date: string, assignments: { item_id: string; expected_project_id: string | null; to_project_id: string | null }[]) =>
    api.post<InventoryDay>(`${base(companyId)}/inventory/days`, { snapshot_date, assignments }),
  restockRequests: (companyId: string, signal?: AbortSignal, offset = 0) => api.get<RestockRequest[]>(`${base(companyId)}/inventory/restock-requests`, { offset, limit: 30 }, signal),
  requestRestock: (companyId: string, project_id: string | null, name: string, quantity: number, note: string) =>
    api.post<RestockRequest>(`${base(companyId)}/inventory/restock-requests`, { project_id, name, quantity, note }),
  fulfillRestock: (companyId: string, id: string) => api.patch<RestockRequest>(`${base(companyId)}/inventory/restock-requests/${id}/fulfilled`, {}),
  definitions: (companyId: string, signal?: AbortSignal) => api.get<ActivityDefinition[]>(`${base(companyId)}/activity-definitions`, undefined, signal),
  createDefinition: (companyId: string, title: string, requirements: { name: string; quantity: number }[]) =>
    api.post<ActivityDefinition>(`${base(companyId)}/activity-definitions`, { title, requirements }),
  updateDefinition: (companyId: string, id: string, title: string, requirements: { name: string; quantity: number }[]) =>
    api.patch<ActivityDefinition>(`${base(companyId)}/activity-definitions/${id}`, { title, requirements }),
  plan: (companyId: string, date: string, signal?: AbortSignal) => api.get<DailyActivityPlan>(`${base(companyId)}/daily-activity-plans/${date}`, undefined, signal),
  plans: (companyId: string, signal?: AbortSignal, offset = 0) => api.get<DailyActivityPlan[]>(`${base(companyId)}/daily-activity-plans`, { offset, limit: 30 }, signal),
  savePlan: (companyId: string, date: string, entries: { project_id: string; activity_definition_id: string | null; assigned_user_id: string | null; task_id: string | null; people_count: number; note: string | null }[], expected_revision: string | null) =>
    api.put<DailyActivityPlan>(`${base(companyId)}/daily-activity-plans/${date}`, { plan_date: date, entries, expected_revision }),
  registerPlan: (companyId: string, date: string, expected_revision: string) => api.post<DailyActivityPlan>(`${base(companyId)}/daily-activity-plans/${date}/register`, { expected_revision }),
};

export function operationalToday(): string {
  // The day-close is defined in the construction company's operating timezone.
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Asuncion', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
}
