import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"

type NomElement = { un: string; plusieurs: string }

type PaginationProps = {
  page: number
  total: number
  pageSize: number
  onPageChange: (page: number) => void
  element: NomElement
  className?: string
}

/**
 * Shared table pagination: "Prev / Page X/Y — N items / Next", or the count
 * alone on a single page. Sober and accessible (nav + aria-label), no
 * page-number ellipsis. The component is the single source of the page count.
 */
export function Pagination({
  page,
  total,
  pageSize,
  onPageChange,
  element,
  className,
}: PaginationProps) {
  const pageCount = Math.max(1, Math.ceil(total / pageSize))
  const compteur = `${total} ${total > 1 ? element.plusieurs : element.un}`
  if (pageCount <= 1) {
    return (
      <nav
        aria-label="Pagination"
        className={cn("text-sm text-muted-foreground", className)}
      >
        {compteur}
      </nav>
    )
  }
  return (
    <nav
      aria-label="Pagination"
      className={cn("flex items-center justify-between text-sm", className)}
    >
      <Button
        variant="outline"
        size="sm"
        disabled={page <= 1}
        onClick={() => onPageChange(page - 1)}
      >
        Précédent
      </Button>
      <span className="text-muted-foreground">
        Page {page} / {pageCount} — {compteur}
      </span>
      <Button
        variant="outline"
        size="sm"
        disabled={page >= pageCount}
        onClick={() => onPageChange(page + 1)}
      >
        Suivant
      </Button>
    </nav>
  )
}
