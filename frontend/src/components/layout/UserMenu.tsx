import { LogOut, User } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '@/auth/AuthProvider';
import { useMe } from '@/auth/useMe';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';

function initials(name?: string | null, email?: string | null): string {
  const source = name || email || 'U';
  return source
    .split(/[\s@.]+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? '')
    .join('');
}

export function UserMenu({ profilePath = '/perfil' }: { profilePath?: string }) {
  const { data: me } = useMe();
  const { signOut } = useAuth();
  const navigate = useNavigate();
  const name = me?.full_name || me?.name || me?.email;

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          aria-label="Abrir menú de usuario"
          className="flex items-center gap-2 rounded-full outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <Avatar className="h-9 w-9">
            <AvatarFallback>{initials(me?.full_name || me?.name, me?.email)}</AvatarFallback>
          </Avatar>
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-56">
        <DropdownMenuLabel>
          <div className="flex flex-col">
            <span className="truncate">{name ?? 'Usuario'}</span>
            <span className="truncate text-xs font-normal text-muted-foreground">{me?.email}</span>
          </div>
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        <DropdownMenuItem onClick={() => navigate(profilePath)}>
          <User className="h-4 w-4" /> Perfil
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem
          onClick={() => void signOut()}
          className="text-destructive focus:text-destructive"
        >
          <LogOut className="h-4 w-4" /> Cerrar sesión
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
