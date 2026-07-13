import { Skeleton } from "@/components/ui/skeleton"
import { TableRow, TableCell } from "@/components/ui/table"

/**
 * Skeleton rows to place inside a `<TableBody>` while loading, at the
 * table's density (no central spinner).
 */
export function TableSkeleton({
  colonnes,
  lignes = 6,
}: {
  colonnes: number
  lignes?: number
}) {
  return (
    <>
      {Array.from({ length: lignes }).map((_ligne, i) => (
        <TableRow key={i}>
          {Array.from({ length: colonnes }).map((_cellule, j) => (
            <TableCell key={j}>
              <Skeleton className="h-3.5 w-full max-w-32" />
            </TableCell>
          ))}
        </TableRow>
      ))}
    </>
  )
}
