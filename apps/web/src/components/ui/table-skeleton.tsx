import { Skeleton } from "@/components/ui/skeleton"
import { TableRow, TableCell } from "@/components/ui/table"

/**
 * Lignes de squelette à poser dans un `<TableBody>` pendant le chargement,
 * à la densité de la table (pas de spinner central).
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
