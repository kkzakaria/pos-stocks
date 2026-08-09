import { Fragment, useState } from "react"
import { useMutation } from "@tanstack/react-query"
import { apiFetch } from "@/lib/api"
import { estDateExpiree, formatDateJour } from "@/lib/dates"
import { formaterMontant } from "@/lib/format"
import { useEstLarge } from "@/lib/use-media-query"
import { cn } from "@/lib/utils"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Badge } from "@/components/ui/badge"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
  TEXTE_LIBRE,
} from "@/components/ui/table"
import { lireAttributs } from "./types"
import type { ReactNode } from "react"
import type { Lot, Produit, Variante } from "./types"

type Props = {
  produit: Produit
  productId: string
  peutEcrire: boolean
  devise: string
  onModifie: () => Promise<unknown>
}

/**
 * Columns of the read-only table: name, SKU, attributes, price, status. The
 * toggle column exists only for a writer, and the lots row spans the whole
 * width — so its `colSpan` has to follow that composition. Naming the two
 * halves keeps the span derived from the header instead of restating a bare
 * `peutEcrire ? 6 : 5`, which silently mis-spans as soon as a column moves.
 *
 * The gain is readability, not safety: the header is still hand-written JSX.
 * What guards the alignment is the test comparing the lots row's `colSpan` to
 * the header's actual column count, in both permission configurations.
 */
const COLONNES_VARIANTES = 5
const COLONNE_ACTION_VARIANTES = 1

/** Attributes as one readable line, or an em dash when the map is empty. */
function texteAttributs(v: Variante): string {
  return (
    Object.entries(lireAttributs(v.attributes))
      .map(([cle, valeur]) => `${cle} : ${valeur}`)
      .join(", ") || "—"
  )
}

/** Effective price: the variant's override, else the product's own price. */
function prixEffectif(v: Variante, produit: Produit): number {
  return v.priceOverride ?? produit.price
}

/**
 * Lots are shown for an active variant of a lot-tracked product only.
 * Deliberately shared by both trees rather than re-inlined in each: the table
 * and the cards must never disagree on WHICH variants carry lots.
 */
function afficheLots(produit: Produit, v: Variante): boolean {
  return produit.trackLots && v.isActive
}

/**
 * Accessible names of the two list levels. A screen-reader user jumping from
 * list to list otherwise hears "list, 2 items" over and over with no way to
 * tell which list is which, and the visible "Lots :" label that precedes a
 * lots list has no programmatic tie to it. There is one lots list PER
 * VARIANT, so its name has to carry the variant it belongs to.
 *
 * They double as the tests' handle: `getAllByRole("listitem")` legitimately
 * returns the nested lot items too, and targeting by role AND name resolves
 * that ambiguity without a test-only `data-slot`.
 */
const NOM_LISTE_VARIANTES = "Variantes"

function nomListeLots(v: Variante): string {
  return `Lots de ${v.name}`
}

/**
 * The lots block's vocabulary, shared by both trees for the same reason as
 * `LigneLot`: a wording changed in one tree only would ship green — the suite
 * of the other mode never renders it, and a developer checks their fix on
 * their own screen, i.e. in a single mode.
 *
 * `<p>` in both trees on purpose: in the table's flex row it is just a flex
 * item, in the card it is the block it already was, so neither rendering
 * moves.
 */
function LibelleLots() {
  return (
    <p className="text-[0.625rem] font-medium text-muted-foreground">Lots :</p>
  )
}

/** Empty state of a lot-tracked variant. Shared for the same reason. */
function AucunLot() {
  return <p className="text-xs text-muted-foreground">aucun</p>
}

/**
 * Shown even when the list is empty: it is the ONLY way a first lot can be
 * created for a variant, so gating it on `lots.length` would make the feature
 * unreachable exactly where it is needed.
 */
function BoutonAjouterLot({
  className,
  onClick,
}: {
  className?: string
  onClick: () => void
}) {
  return (
    <Button variant="ghost" size="sm" className={className} onClick={onClick}>
      Ajouter un lot
    </Button>
  )
}

/**
 * "Variants" section: SKU, attributes, effective price and status per variant,
 * with creation (key/value attributes, overridable price and floor price) and
 * an active/inactive toggle; the displayed price falls back to the product's.
 * When the product tracks lots, each active variant also lists its lots
 * (number, expiry or "no expiry", an "Expired" badge) with an "add lot" dialog.
 *
 * Dense table from the `md` tier up, one card per variant below it — only one
 * of the two trees is ever mounted, so no variant is announced twice by a
 * screen reader. This is the one section of the sheet that does NOT go through
 * `ListeAdaptative`: it emits TWO rows per variant (the variant, then a
 * full-width row listing its lots), which is master-detail, not a table of
 * uniform rows. In card mode that second row folds inside the card, which is
 * where it belonged all along.
 */
export function SectionVariantes({
  produit,
  productId,
  peutEcrire,
  devise,
  onModifie,
}: Props) {
  const estLarge = useEstLarge()
  const [dialogVariante, setDialogVariante] = useState(false)
  const [nomVariante, setNomVariante] = useState("")
  const [attributs, setAttributs] = useState<
    Array<{ cle: string; valeur: string }>
  >([{ cle: "", valeur: "" }])
  const [prixVariante, setPrixVariante] = useState("")
  const [plancherVariante, setPlancherVariante] = useState("")
  const [codeBarresVariante, setCodeBarresVariante] = useState("")
  const [erreurVariante, setErreurVariante] = useState<string | null>(null)
  const [erreurBascule, setErreurBascule] = useState<string | null>(null)

  const ajouterVariante = useMutation({
    mutationFn: () => {
      const attributes: Record<string, string> = {}
      for (const { cle, valeur } of attributs) {
        if (cle.trim() && valeur.trim()) {
          attributes[cle.trim()] = valeur.trim()
        }
      }
      return apiFetch(`/api/v1/products/${productId}/variants`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          name: nomVariante,
          attributes,
          barcode: codeBarresVariante || undefined,
          priceOverride: prixVariante ? Number(prixVariante) : undefined,
          minPriceOverride: plancherVariante
            ? Number(plancherVariante)
            : undefined,
        }),
      })
    },
    onSuccess: async () => {
      await onModifie()
      setDialogVariante(false)
      setNomVariante("")
      setAttributs([{ cle: "", valeur: "" }])
      setPrixVariante("")
      setPlancherVariante("")
      setCodeBarresVariante("")
      setErreurVariante(null)
    },
    onError: (err) =>
      setErreurVariante(err instanceof Error ? err.message : "Erreur"),
  })

  const basculerVariante = useMutation({
    mutationFn: (v: Variante) =>
      apiFetch(`/api/v1/variants/${v.id}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ isActive: !v.isActive }),
      }),
    onSuccess: async () => {
      setErreurBascule(null)
      await onModifie()
    },
    onError: (err) =>
      setErreurBascule(err instanceof Error ? err.message : "Erreur"),
  })

  const [dialogLotPour, setDialogLotPour] = useState<string | null>(null)
  const [numeroLot, setNumeroLot] = useState("")
  const [datePeremption, setDatePeremption] = useState("")
  const [erreurLot, setErreurLot] = useState<string | null>(null)

  const ajouterLot = useMutation({
    mutationFn: (variantId: string) =>
      apiFetch(`/api/v1/variants/${variantId}/lots`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          lotNumber: numeroLot,
          expiryDate: datePeremption || undefined,
        }),
      }),
    onSuccess: async () => {
      await onModifie()
      setDialogLotPour(null)
      setNumeroLot("")
      setDatePeremption("")
      setErreurLot(null)
    },
    onError: (err) =>
      setErreurLot(err instanceof Error ? err.message : "Erreur"),
  })

  const rendu: PropsRendu = {
    produit,
    peutEcrire,
    devise,
    onBasculer: (v) => basculerVariante.mutate(v),
    onAjouterLot: (variantId) => setDialogLotPour(variantId),
  }

  return (
    <section>
      <div className="mb-3 flex items-center justify-between gap-3">
        <h2 className="text-base font-medium">Variantes</h2>
        {peutEcrire && (
          <Dialog open={dialogVariante} onOpenChange={setDialogVariante}>
            <DialogTrigger render={<Button variant="outline" size="sm" />}>
              Ajouter une variante
            </DialogTrigger>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>Nouvelle variante</DialogTitle>
              </DialogHeader>
              <form
                className="flex flex-col gap-4"
                onSubmit={(e) => {
                  e.preventDefault()
                  setErreurVariante(null)
                  ajouterVariante.mutate()
                }}
              >
                <div className="flex flex-col gap-1.5">
                  <Label htmlFor="v-nom">Nom (ex : M / Rouge)</Label>
                  <Input
                    id="v-nom"
                    required
                    value={nomVariante}
                    onChange={(e) => setNomVariante(e.target.value)}
                  />
                </div>
                <div className="flex flex-col gap-2">
                  <Label>Attributs</Label>
                  {/* Own wrapper so the gap BETWEEN pairs (12px) beats the gap
                      INSIDE a stacked pair (8px) below `sm`. Without it both
                      would be 8px and the pairs would visually merge into one
                      column of anonymous fields — a readability defect
                      CREATED by the responsive fix. Back to the parent's 8px
                      rhythm from `sm` on, where each pair is a row again, so
                      the desktop rendering is unchanged. */}
                  <div className="flex flex-col gap-3 sm:gap-2">
                    {attributs.map((a, index) => (
                      // Stacked below `sm`: side by side at 375px the pair
                      // sits at 144px per field, under the readable width for
                      // a free-text attribute.
                      <div
                        key={index}
                        className="flex flex-col gap-2 sm:flex-row"
                      >
                        <Input
                          aria-label={`Clé de l'attribut ${index + 1}`}
                          placeholder="taille"
                          value={a.cle}
                          onChange={(e) =>
                            setAttributs(
                              attributs.map((item, i) =>
                                i === index
                                  ? { ...item, cle: e.target.value }
                                  : item
                              )
                            )
                          }
                        />
                        <Input
                          aria-label={`Valeur de l'attribut ${index + 1}`}
                          placeholder="M"
                          value={a.valeur}
                          onChange={(e) =>
                            setAttributs(
                              attributs.map((item, i) =>
                                i === index
                                  ? { ...item, valeur: e.target.value }
                                  : item
                              )
                            )
                          }
                        />
                      </div>
                    ))}
                  </div>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() =>
                      setAttributs([...attributs, { cle: "", valeur: "" }])
                    }
                  >
                    Ajouter un attribut
                  </Button>
                </div>
                {/* Side by side from `sm` on. Below it the two amounts sit at
                    142px each — same call as the creation form, which stacks
                    its own price row at 165px. */}
                <div className="flex flex-col gap-3 sm:flex-row">
                  <div className="flex flex-1 flex-col gap-1.5">
                    <Label htmlFor="v-prix">Prix (optionnel)</Label>
                    <Input
                      id="v-prix"
                      type="number"
                      min={1}
                      step={1}
                      value={prixVariante}
                      onChange={(e) => setPrixVariante(e.target.value)}
                    />
                  </div>
                  <div className="flex flex-1 flex-col gap-1.5">
                    <Label htmlFor="v-plancher">Plancher (optionnel)</Label>
                    <Input
                      id="v-plancher"
                      type="number"
                      min={1}
                      step={1}
                      value={plancherVariante}
                      onChange={(e) => setPlancherVariante(e.target.value)}
                    />
                  </div>
                </div>
                <div className="flex flex-col gap-1.5">
                  <Label htmlFor="v-barcode">Code-barres (optionnel)</Label>
                  <Input
                    id="v-barcode"
                    value={codeBarresVariante}
                    onChange={(e) => setCodeBarresVariante(e.target.value)}
                  />
                </div>
                {erreurVariante && (
                  <p role="alert" className="text-xs text-destructive">
                    {erreurVariante}
                  </p>
                )}
                <Button type="submit" disabled={ajouterVariante.isPending}>
                  {ajouterVariante.isPending ? "Ajout…" : "Ajouter"}
                </Button>
              </form>
            </DialogContent>
          </Dialog>
        )}
      </div>
      {estLarge ? (
        <TableVariantes {...rendu} />
      ) : (
        <CartesVariantes {...rendu} />
      )}
      {erreurBascule && (
        <p role="alert" className="mt-2 text-xs text-destructive">
          {erreurBascule}
        </p>
      )}
      {dialogLotPour !== null && (
        <Dialog
          open
          onOpenChange={(ouvert) => {
            if (!ouvert) setDialogLotPour(null)
          }}
        >
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Nouveau lot</DialogTitle>
            </DialogHeader>
            {/* Already one field per row: measured at 375px the dialog is
                328px wide with no overflow, so it needs no breakpoint. */}
            <form
              className="flex flex-col gap-4"
              onSubmit={(e) => {
                e.preventDefault()
                setErreurLot(null)
                ajouterLot.mutate(dialogLotPour)
              }}
            >
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="l-numero">Numéro de lot</Label>
                <Input
                  id="l-numero"
                  required
                  value={numeroLot}
                  onChange={(e) => setNumeroLot(e.target.value)}
                />
              </div>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="l-peremption">
                  Date de péremption (optionnel)
                </Label>
                <Input
                  id="l-peremption"
                  type="date"
                  value={datePeremption}
                  onChange={(e) => setDatePeremption(e.target.value)}
                />
              </div>
              {erreurLot && (
                <p role="alert" className="text-xs text-destructive">
                  {erreurLot}
                </p>
              )}
              <Button type="submit" disabled={ajouterLot.isPending}>
                {ajouterLot.isPending ? "Ajout…" : "Ajouter le lot"}
              </Button>
            </form>
          </DialogContent>
        </Dialog>
      )}
    </section>
  )
}

type PropsRendu = {
  produit: Produit
  peutEcrire: boolean
  devise: string
  onBasculer: (v: Variante) => void
  onAjouterLot: (variantId: string) => void
}

/**
 * Table mode. Name, SKU and attributes are free user text, hence `TEXTE_LIBRE`
 * on those cells — the lots row included, since a supplier lot number is free
 * text too. Its JSDoc in `components/ui/table.tsx` holds the mechanism.
 *
 * Measured in Chrome on the product sheet at a 1024 px viewport, the tier
 * where this section's container is at its narrowest (`section-stock.tsx`
 * documents why): 2 256 px of table with `whitespace-nowrap`, 1 717 px with
 * `whitespace-normal break-words`, 470 px once every free-text cell carries
 * `TEXTE_LIBRE` — no horizontal scroll left.
 *
 * 470 px is the container, not a residue of it: it is the 480 px tier
 * `section-stock.tsx` documents, minus this column's 10 px share of the
 * page's vertical scrollbar. The treated table is exactly what summons that
 * scrollbar — the free text wraps onto several lines and the sheet grows from
 * 900 to 1 488 px tall, where the untreated one fit the viewport.
 *
 * The 24 % that `break-words` appears to buy is not its doing: the same cells
 * with `whitespace-normal` ALONE also measure 1 717 px. The gain comes from
 * the spaces and hyphens the Nom, SKU and Attributs columns happen to carry,
 * which the stock table's warehouse names do not — the naive fix is partly
 * effective here and flatly inert there, and in both cases insufficient.
 */
function TableVariantes({
  produit,
  peutEcrire,
  devise,
  onBasculer,
  onAjouterLot,
}: PropsRendu) {
  const colonnes =
    COLONNES_VARIANTES + (peutEcrire ? COLONNE_ACTION_VARIANTES : 0)

  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Nom</TableHead>
          <TableHead>SKU</TableHead>
          <TableHead>Attributs</TableHead>
          <TableHead numeric>Prix</TableHead>
          <TableHead>Statut</TableHead>
          {peutEcrire && <TableHead />}
        </TableRow>
      </TableHeader>
      <TableBody>
        {produit.variants.map((v) => (
          <Fragment key={v.id}>
            <TableRow>
              <TableCell className={cn("font-medium", TEXTE_LIBRE)}>
                {v.name}
              </TableCell>
              <TableCell className={cn("font-mono text-xs", TEXTE_LIBRE)}>
                {v.sku}
              </TableCell>
              <TableCell className={cn("text-sm", TEXTE_LIBRE)}>
                {texteAttributs(v)}
              </TableCell>
              <TableCell numeric>
                {formaterMontant(prixEffectif(v, produit), devise)}
              </TableCell>
              <TableCell>
                <BadgeStatut variante={v} />
              </TableCell>
              {peutEcrire && (
                <TableCell>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => onBasculer(v)}
                  >
                    {libelleBascule(v)}
                  </Button>
                </TableCell>
              )}
            </TableRow>
            {afficheLots(produit, v) && (
              <TableRow className="bg-muted/30 hover:bg-muted/30">
                <TableCell
                  colSpan={colonnes}
                  className={cn("py-1.5 pl-6", TEXTE_LIBRE)}
                >
                  <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
                    <LibelleLots />
                    {v.lots.length === 0 ? (
                      <AucunLot />
                    ) : (
                      // A real list, not `<span>` siblings held apart by a
                      // `gap`: those announce as one uninterrupted run of
                      // cell text, and on a variant with several lots a
                      // reader can no longer tell which number an "Expiré"
                      // badge belongs to — the information card mode keeps.
                      // The `<ul>` repeats the row's own flex classes so the
                      // lots keep their spacing; it is a box of its own, so
                      // a group too wide to sit after the "Lots :" label now
                      // starts on the next line instead of splitting after
                      // the first lot (measured: 114 px of row height rather
                      // than 117 on a three-lot variant, nothing else moves).
                      // `display: contents` would have kept the old flow
                      // exactly, at the cost of the list semantics in the
                      // very engines this markup exists for.
                      <ul
                        role="list"
                        aria-label={nomListeLots(v)}
                        className="flex flex-wrap items-center gap-x-4 gap-y-1"
                      >
                        {v.lots.map((lot) => (
                          <li
                            key={lot.id}
                            className="flex min-w-0 items-center gap-1.5 text-xs"
                          >
                            <LigneLot lot={lot} />
                          </li>
                        ))}
                      </ul>
                    )}
                    {peutEcrire && (
                      <BoutonAjouterLot onClick={() => onAjouterLot(v.id)} />
                    )}
                  </div>
                </TableCell>
              </TableRow>
            )}
          </Fragment>
        ))}
      </TableBody>
    </Table>
  )
}

/**
 * Card mode. Each variant becomes one card carrying everything its table row
 * carried — name, SKU, attributes, price, status badge, toggle — plus its
 * lots INSIDE the same card, where the master-detail second row belongs.
 *
 * The lots stay in full: number, expiry date and "Expiré" badge. They are
 * audit information, and the phase rule is that nothing is ever hidden by
 * width — only by role.
 *
 * Both lists carry an explicit `role="list"`, redundant in plain HTML but not
 * here: Tailwind's Preflight sets `list-style: none` on every `<ul>`, which
 * makes VoiceOver on Safari/iOS drop the list role — the reader then loses the
 * item count and the position that table mode conveys for free. Both are
 * named too; see `NOM_LISTE_VARIANTES`.
 */
function CartesVariantes({
  produit,
  peutEcrire,
  devise,
  onBasculer,
  onAjouterLot,
}: PropsRendu) {
  return (
    <ul
      role="list"
      aria-label={NOM_LISTE_VARIANTES}
      className="flex flex-col gap-2"
    >
      {produit.variants.map((v) => (
        <li key={v.id} className="rounded-md border bg-card p-3">
          {/* Identity on the left, headline figure opposite it — same card
              grammar as `SectionStock`, so the sheet reads as one thing. */}
          <div className="flex items-start justify-between gap-3">
            <p className="min-w-0 flex-1 font-medium break-words">{v.name}</p>
            <span className="shrink-0 font-medium tabular-nums">
              {formaterMontant(prixEffectif(v, produit), devise)}
            </span>
          </div>
          <dl className="mt-2 flex flex-col gap-1">
            <PaireCarte libelle="SKU" classeValeur="font-mono text-xs">
              {v.sku}
            </PaireCarte>
            <PaireCarte libelle="Attributs">{texteAttributs(v)}</PaireCarte>
            <PaireCarte libelle="Statut">
              <BadgeStatut variante={v} />
            </PaireCarte>
          </dl>
          {afficheLots(produit, v) && (
            <div className="mt-3 border-t pt-2">
              <LibelleLots />
              {v.lots.length === 0 ? (
                <AucunLot />
              ) : (
                <ul
                  role="list"
                  aria-label={nomListeLots(v)}
                  className="mt-1 flex flex-col gap-1"
                >
                  {v.lots.map((lot) => (
                    <li
                      key={lot.id}
                      className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs"
                    >
                      <LigneLot lot={lot} />
                    </li>
                  ))}
                </ul>
              )}
              {peutEcrire && (
                <BoutonAjouterLot
                  className="mt-1"
                  onClick={() => onAjouterLot(v.id)}
                />
              )}
            </div>
          )}
          {peutEcrire && (
            <Button
              variant="outline"
              size="sm"
              className="mt-3 w-full"
              onClick={() => onBasculer(v)}
            >
              {libelleBascule(v)}
            </Button>
          )}
        </li>
      ))}
    </ul>
  )
}

/**
 * A lot's audit line, identical in both trees: number, expiry (or its
 * explicit absence), and the "Expiré" badge. Shared rather than written
 * twice so a card can never quietly drop the badge a table row shows.
 *
 * `min-w-0` matters on the number: it is a flex item in a ROW container,
 * whose `min-width: auto` resolves to min-content, and an unbreakable
 * supplier reference would otherwise push the card instead of breaking.
 */
function LigneLot({ lot }: { lot: Lot }) {
  return (
    <>
      <span className="min-w-0 font-mono break-words">{lot.lotNumber}</span>
      <span className="text-muted-foreground">
        {lot.expiryDate ? formatDateJour(lot.expiryDate) : "sans péremption"}
      </span>
      {estDateExpiree(lot.expiryDate) && (
        <Badge variant="destructive">Expiré</Badge>
      )}
    </>
  )
}

/** Status badge, shared so both trees can never disagree on the wording. */
function BadgeStatut({ variante }: { variante: Variante }) {
  return (
    <Badge variant={variante.isActive ? "success" : "secondary"}>
      {variante.isActive ? "Active" : "Inactive"}
    </Badge>
  )
}

/** Toggle label, shared for the same reason as `BadgeStatut`. */
function libelleBascule(v: Variante): string {
  return v.isActive ? "Désactiver" : "Réactiver"
}

/**
 * One label/value pair of a card. In a ROW flex container an item's
 * `min-width: auto` resolves to min-content, so `min-w-0` is what lets
 * `break-words` actually break a long token instead of pushing the card.
 */
function PaireCarte({
  libelle,
  classeValeur,
  children,
}: {
  libelle: string
  classeValeur?: string
  children: ReactNode
}) {
  return (
    <div className="flex justify-between gap-3">
      <dt className="min-w-0 shrink-0 font-normal break-words text-muted-foreground">
        {libelle}
      </dt>
      <dd className={cn("min-w-0 text-right break-words", classeValeur)}>
        {children}
      </dd>
    </div>
  )
}
