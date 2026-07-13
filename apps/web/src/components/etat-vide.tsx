import type { ReactNode } from "react"
import type { LucideIcon } from "lucide-react"

import { cn } from "@/lib/utils"

/**
 * État vide qui oriente l'action, jamais un simple « rien ici ».
 * Bord tireté discret (affordance calme, pas une carte), voix « registre ».
 */
export function EtatVide({
  icon: Icon,
  titre,
  message,
  action,
  className,
}: {
  icon?: LucideIcon
  titre: string
  message?: string
  action?: ReactNode
  className?: string
}) {
  return (
    <div
      className={cn(
        "flex flex-col items-center justify-center gap-2 rounded-lg border border-dashed border-border px-6 py-10 text-center",
        className
      )}
    >
      {Icon && (
        <Icon className="size-6 text-muted-foreground" aria-hidden="true" />
      )}
      <p className="text-xs font-medium text-foreground">{titre}</p>
      {message && (
        <p className="max-w-sm text-xs text-muted-foreground">{message}</p>
      )}
      {action && <div className="mt-1">{action}</div>}
    </div>
  )
}
