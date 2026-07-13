import { Link } from "@tanstack/react-router"
import {
  ChevronsUpDown,
  UserRound,
  LogOut,
  Sun,
  Monitor,
  Moon,
} from "lucide-react"

import type { Me } from "@/lib/me"
import type { CompanyRole } from "shared"
import { useTheme } from "@/lib/theme"
import type { Theme } from "@/lib/theme"
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuGroup,
  DropdownMenuGroupLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
} from "@/components/ui/dropdown-menu"

const ROLE_LABELS: Record<CompanyRole, string> = {
  owner: "Propriétaire",
  admin: "Administrateur",
  auditor: "Auditeur",
  stock_manager: "Gestionnaire de stock",
  staff: "Personnel",
}

function initiales(name: string, email: string): string {
  const source = name.trim() || email
  const parts = source.split(/\s+/).filter(Boolean)
  if (parts.length >= 2) {
    return (parts[0].charAt(0) + parts[1].charAt(0)).toUpperCase()
  }
  return source.slice(0, 2).toUpperCase()
}

/** Menu identité du pied de sidebar : compte, thème, déconnexion. */
export function UserMenu({ me, onSignOut }: { me: Me; onSignOut: () => void }) {
  const { theme, setTheme } = useTheme()
  const nom = me.user.name.trim() || me.user.email
  const roleLabel = me.membership ? ROLE_LABELS[me.membership.role] : null

  return (
    <DropdownMenu>
      <DropdownMenuTrigger className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left outline-none hover:bg-sidebar-accent hover:text-sidebar-accent-foreground focus-visible:ring-2 focus-visible:ring-ring/30 aria-expanded:bg-sidebar-accent pointer-coarse:min-h-11">
        <span className="flex size-7 shrink-0 items-center justify-center rounded-md bg-secondary text-[0.625rem] font-medium text-secondary-foreground">
          {initiales(me.user.name, me.user.email)}
        </span>
        <span className="min-w-0 flex-1">
          <span className="block truncate text-xs font-medium">{nom}</span>
          {roleLabel && (
            <span className="block truncate text-[0.625rem] text-muted-foreground">
              {roleLabel}
            </span>
          )}
        </span>
        <ChevronsUpDown className="size-3.5 shrink-0 text-muted-foreground" />
      </DropdownMenuTrigger>
      <DropdownMenuContent side="top" align="start" className="min-w-56">
        <div className="px-2 py-1.5">
          <p className="truncate text-xs font-medium">{nom}</p>
          <p className="truncate text-[0.625rem] text-muted-foreground">
            {me.user.email}
          </p>
        </div>
        <DropdownMenuSeparator />
        <DropdownMenuItem
          render={<Link to="/mon-compte" />}
          className="cursor-pointer"
        >
          <UserRound />
          Mon compte
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuGroup>
          <DropdownMenuGroupLabel>Thème</DropdownMenuGroupLabel>
          <DropdownMenuRadioGroup
            value={theme}
            onValueChange={(valeur) => setTheme(valeur as Theme)}
          >
            <DropdownMenuRadioItem value="light">
              <Sun />
              Clair
            </DropdownMenuRadioItem>
            <DropdownMenuRadioItem value="system">
              <Monitor />
              Système
            </DropdownMenuRadioItem>
            <DropdownMenuRadioItem value="dark">
              <Moon />
              Sombre
            </DropdownMenuRadioItem>
          </DropdownMenuRadioGroup>
        </DropdownMenuGroup>
        <DropdownMenuSeparator />
        <DropdownMenuItem
          variant="destructive"
          onClick={onSignOut}
          className="cursor-pointer"
        >
          <LogOut />
          Se déconnecter
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
