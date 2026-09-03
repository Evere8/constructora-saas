import { Building2 } from 'lucide-react';
import { useCompany } from '@/context/CompanyProvider';
import { roleLabel } from '@/auth/permissions';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';

export function CompanySelector() {
  const { memberships, activeCompanyId, setActiveCompanyId } = useCompany();

  if (memberships.length === 0) {
    return (
      <div className="flex items-center gap-2 rounded-md border border-dashed px-3 py-2 text-xs text-muted-foreground">
        <Building2 className="h-4 w-4" />
        Sin constructoras activas
      </div>
    );
  }

  return (
    <Select value={activeCompanyId ?? undefined} onValueChange={setActiveCompanyId}>
      <SelectTrigger className="w-[220px] bg-background" aria-label="Seleccionar constructora">
        <div className="flex items-center gap-2 truncate">
          <Building2 className="h-4 w-4 text-primary" />
          <SelectValue placeholder="Selecciona constructora" />
        </div>
      </SelectTrigger>
      <SelectContent>
        {memberships.map((m) => (
          <SelectItem key={m.company_id} value={m.company_id}>
            <div className="flex flex-col">
              <span className="font-medium">{m.name}</span>
              <span className="text-xs text-muted-foreground">{roleLabel(m.role)}</span>
            </div>
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
