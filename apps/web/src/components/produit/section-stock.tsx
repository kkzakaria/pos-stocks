import { formaterMontant } from "@/lib/format"
import {
  Table,
  TableBody,
  TableCell,
  TableFooter,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { TableSkeleton } from "@/components/ui/table-skeleton"
import type { LigneStockProduit } from "./types"

type Props = {
  lignes: LigneStockProduit[]
  enChargement: boolean
  devise: string
  plusieursVariantes: boolean
}

/**
 * "Stock par entrepôt" table: warehouse · variant (only when several
 * variants are present) · quantity · average cost, with a total row.
 * Presentational: the page owns the query, and decides `plusieursVariantes`
 * from the product's active variants — stock rows may be an empty or
 * partial subset and can't be trusted to reflect variant count.
 */
export function SectionStock({
  lignes,
  enChargement,
  devise,
  plusieursVariantes,
}: Props) {
  const total = lignes.reduce((somme, l) => somme + l.quantity, 0)
  const colonnes = plusieursVariantes ? 4 : 3

  return (
    <section>
      <h2 className="mb-3 text-base font-semibold">Stock par entrepôt</h2>
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Entrepôt</TableHead>
            {plusieursVariantes && <TableHead>Variante</TableHead>}
            <TableHead numeric>Quantité</TableHead>
            <TableHead numeric>CMP</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {enChargement ? (
            <TableSkeleton colonnes={colonnes} />
          ) : lignes.length === 0 ? (
            <TableRow>
              <TableCell colSpan={colonnes} className="text-muted-foreground">
                Aucun stock visible pour ce produit.
              </TableCell>
            </TableRow>
          ) : (
            lignes.map((l) => (
              <TableRow key={`${l.warehouseId}-${l.variantId}`}>
                <TableCell>{l.warehouseName}</TableCell>
                {plusieursVariantes && <TableCell>{l.variantName}</TableCell>}
                <TableCell numeric>{l.quantity}</TableCell>
                <TableCell numeric>
                  {formaterMontant(l.avgCost, devise)}
                </TableCell>
              </TableRow>
            ))
          )}
        </TableBody>
        {lignes.length > 0 && (
          <TableFooter>
            <TableRow>
              <TableCell colSpan={colonnes - 2}>Total</TableCell>
              <TableCell numeric>{total}</TableCell>
              <TableCell />
            </TableRow>
          </TableFooter>
        )}
      </Table>
    </section>
  )
}
