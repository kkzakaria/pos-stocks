import { formaterMontant } from "@/lib/format"
import { useEstLarge } from "@/lib/use-media-query"
import { cn } from "@/lib/utils"
import { Skeleton } from "@/components/ui/skeleton"
import {
  Table,
  TableBody,
  TableCell,
  TableFooter,
  TableHead,
  TableHeader,
  TableRow,
  TEXTE_LIBRE,
} from "@/components/ui/table"
import { TableSkeleton } from "@/components/ui/table-skeleton"
import type { ReactNode } from "react"
import type { LigneStockProduit } from "./types"

type Props = {
  lignes: LigneStockProduit[]
  enChargement: boolean
  devise: string
  plusieursVariantes: boolean
}

const ETAT_VIDE =
  "Aucun stock visible pour ce produit. Les entrées se font par réception ou transfert."

/**
 * The table always ends with the same three numeric columns (quantity,
 * average cost, value); only the leading text columns vary — warehouse
 * alone, or warehouse and variant. Naming that count lets the header's column
 * total and the footer's label span both be derived from it, rather than
 * restating a bare "3" inside a `colSpan={colonnes - 3}` subtraction.
 *
 * The gain is readability, not safety: the header and the footer are still
 * hand-written JSX, so adding a column without updating this constant
 * mis-spans the total row exactly as the former shape did. What actually
 * guards the alignment is the test asserting that the footer's spans add up
 * to the header's column count.
 */
const COLONNES_NUMERIQUES = 3

function cle(l: LigneStockProduit): string {
  return `${l.warehouseId}-${l.variantId}`
}

function valeurLigne(l: LigneStockProduit): number {
  return l.quantity * l.avgCost
}

/**
 * "Stock par entrepôt": warehouse · variant (only when several variants are
 * present) · quantity · average cost · value (qty × avg cost), with a total
 * summing quantities and values.
 *
 * Dense table from the `md` tier up, hierarchical cards below it — only one
 * of the two trees is ever mounted, so no row is announced twice by a screen
 * reader. The card layout deliberately mirrors `ListeAdaptative` (title,
 * headline figure opposite it, remaining columns as label/value pairs)
 * without importing it: this table carries a `TableFooter` of totals and a
 * conditional column, two notions `ColonneAdaptative` does not have.
 *
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
  const estLarge = useEstLarge()
  const total = lignes.reduce((somme, l) => somme + l.quantity, 0)
  const totalValeur = lignes.reduce((somme, l) => somme + valeurLigne(l), 0)

  return (
    <section>
      <h2 className="mb-3 text-base font-medium">Stock par entrepôt</h2>
      {estLarge ? (
        <TableStock
          lignes={lignes}
          enChargement={enChargement}
          devise={devise}
          plusieursVariantes={plusieursVariantes}
          total={total}
          totalValeur={totalValeur}
        />
      ) : (
        <CartesStock
          lignes={lignes}
          enChargement={enChargement}
          devise={devise}
          plusieursVariantes={plusieursVariantes}
          total={total}
          totalValeur={totalValeur}
        />
      )}
    </section>
  )
}

type PropsRendu = Props & { total: number; totalValeur: number }

/**
 * Table mode. Its narrowest tier is 1024 px of viewport, not 375 px. Crossing
 * `lg` does two opposite things at once: the shell's sidebar becomes
 * permanent (−240 px) and the product sheet's grid splits into three columns,
 * of which this section takes two. Measured in Chrome on the product sheet,
 * this section's container goes from 991 px at a 1023 px viewport to 480 px
 * at 1024 px, and only climbs back to 651 px at 1280 px. Below `md` the hook
 * mounts cards instead — so 480 px is the narrowest table there is, and the
 * usual 375 / 768 / 1280 checkpoints all miss it. `section-variantes.tsx`
 * sits in the same grid cell and inherits that tier.
 *
 * Those figures are for a page WITHOUT its own vertical scrollbar. This
 * column takes two thirds of the grid, so Chrome's 15 px classic scrollbar
 * costs it 10 px more: the very same container measures 470 px as soon as
 * the sheet is longer than the viewport. Same box, two states — the number
 * only means something with its scrollbar state attached.
 *
 * Warehouse and variant names are free user text, hence `TEXTE_LIBRE` on
 * those cells — see its own JSDoc in `components/ui/table.tsx` for why
 * `break-words` does not do the job. Here the naive fix is not merely
 * insufficient but strictly inert: measured on a 54-character unbreakable
 * warehouse name, 601 px of table untreated and 601 px again with
 * `break-words`. No column of this table carries a space or a hyphen, so
 * there is not one break opportunity to exploit — unlike the variants table
 * next door, where the same fix shaves 24 % and still overflows.
 */
function TableStock({
  lignes,
  enChargement,
  devise,
  plusieursVariantes,
  total,
  totalValeur,
}: PropsRendu) {
  const colonnesTexte = plusieursVariantes ? 2 : 1
  const colonnes = colonnesTexte + COLONNES_NUMERIQUES

  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Entrepôt</TableHead>
          {plusieursVariantes && <TableHead>Variante</TableHead>}
          <TableHead numeric>Quantité</TableHead>
          <TableHead numeric>CMP</TableHead>
          <TableHead numeric>Valeur</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {enChargement ? (
          <TableSkeleton colonnes={colonnes} />
        ) : lignes.length === 0 ? (
          <TableRow>
            {/*
              Longest string in the whole table (84 characters), and the same
              `whitespace-nowrap` applies: untreated it takes 484 px inside the
              480 px container, i.e. a horizontal scrollbar under an EMPTY
              state — the table scrolling for a sentence, not for data.
              `wrap-anywhere` would be pointless here: the text is static and
              full of spaces, so plain wrapping is enough.
            */}
            <TableCell
              colSpan={colonnes}
              className="whitespace-normal text-muted-foreground"
            >
              {ETAT_VIDE}
            </TableCell>
          </TableRow>
        ) : (
          lignes.map((l) => (
            <TableRow key={cle(l)}>
              <TableCell className={TEXTE_LIBRE}>{l.warehouseName}</TableCell>
              {plusieursVariantes && (
                <TableCell className={TEXTE_LIBRE}>{l.variantName}</TableCell>
              )}
              <TableCell numeric>{l.quantity}</TableCell>
              <TableCell numeric>
                {formaterMontant(l.avgCost, devise)}
              </TableCell>
              <TableCell numeric>
                {formaterMontant(valeurLigne(l), devise)}
              </TableCell>
            </TableRow>
          ))
        )}
      </TableBody>
      {lignes.length > 0 && (
        <TableFooter>
          <TableRow>
            <TableCell colSpan={colonnesTexte}>Total</TableCell>
            <TableCell numeric>{total}</TableCell>
            <TableCell />
            <TableCell numeric>
              {formaterMontant(totalValeur, devise)}
            </TableCell>
          </TableRow>
        </TableFooter>
      )}
    </Table>
  )
}

/**
 * Card mode. The total leaves the list and becomes a distinct summary block:
 * a `<tfoot>` has no meaning outside a table, and folding it into the list
 * would make it read as one more warehouse. That block carries
 * `data-slot="stock-total"`, the DS convention already used across
 * `table.tsx`, so it can be targeted without depending on its classes.
 *
 * The list carries an explicit `role="list"`, redundant in plain HTML but not
 * here: Tailwind's Preflight sets `list-style: none` on every `<ul>`, which
 * makes VoiceOver on Safari/iOS drop the list role — the reader then hears a
 * run of unrelated groups instead of "list, 3 items", losing the count and
 * the position that table mode conveys for free. Same reason, same attribute
 * in `ListeAdaptative`.
 */
function CartesStock({
  lignes,
  enChargement,
  devise,
  plusieursVariantes,
  total,
  totalValeur,
}: PropsRendu) {
  if (enChargement) {
    return (
      <div className="flex flex-col gap-2">
        {Array.from({ length: 3 }, (_, i) => (
          <div key={i} className="rounded-md border p-3">
            <Skeleton className="h-4 w-2/3" />
            <Skeleton className="mt-2 h-3 w-1/3" />
          </div>
        ))}
      </div>
    )
  }

  if (lignes.length === 0) {
    return <p className="text-muted-foreground">{ETAT_VIDE}</p>
  }

  return (
    <div className="flex flex-col gap-2">
      <ul role="list" className="flex flex-col gap-2">
        {lignes.map((l) => (
          <li key={cle(l)} className="rounded-md border bg-card p-3">
            <EnteteCarte
              titre={l.warehouseName}
              valeur={formaterMontant(valeurLigne(l), devise)}
            />
            <dl className="mt-2 flex flex-col gap-1">
              {plusieursVariantes && (
                <PaireCarte libelle="Variante">{l.variantName}</PaireCarte>
              )}
              <PaireCarte libelle="Quantité" numeric>
                {l.quantity}
              </PaireCarte>
              <PaireCarte libelle="CMP" numeric>
                {formaterMontant(l.avgCost, devise)}
              </PaireCarte>
            </dl>
          </li>
        ))}
      </ul>
      <div
        data-slot="stock-total"
        className="rounded-md border bg-muted/50 p-3 font-medium"
      >
        <EnteteCarte
          titre="Total"
          valeur={formaterMontant(totalValeur, devise)}
        />
        <dl className="mt-2 flex flex-col gap-1">
          <PaireCarte libelle="Quantité" numeric>
            {total}
          </PaireCarte>
        </dl>
      </div>
    </div>
  )
}

/** Card title line: identity on the left, headline figure opposite it. */
function EnteteCarte({ titre, valeur }: { titre: string; valeur: string }) {
  return (
    <div className="flex items-start justify-between gap-3">
      <p className="min-w-0 flex-1 font-medium break-words">{titre}</p>
      <span className="shrink-0 font-medium tabular-nums">{valeur}</span>
    </div>
  )
}

/**
 * One label/value pair of a card. In a ROW flex container an item's
 * `min-width: auto` resolves to min-content, so `min-w-0` is what lets
 * `break-words` actually break a long token instead of pushing the card.
 */
function PaireCarte({
  libelle,
  numeric = false,
  children,
}: {
  libelle: string
  numeric?: boolean
  children: ReactNode
}) {
  return (
    <div className="flex justify-between gap-3">
      <dt className="min-w-0 shrink-0 font-normal break-words text-muted-foreground">
        {libelle}
      </dt>
      <dd
        className={cn(
          "min-w-0 text-right break-words",
          numeric && "tabular-nums"
        )}
      >
        {children}
      </dd>
    </div>
  )
}
