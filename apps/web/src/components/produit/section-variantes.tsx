import { useState } from "react"
import { useMutation } from "@tanstack/react-query"
import { apiFetch } from "@/lib/api"
import { formaterMontant } from "@/lib/format"
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
} from "@/components/ui/table"
import { lireAttributs } from "./types"
import type { Produit, Variante } from "./types"

type Props = {
  produit: Produit
  productId: string
  peutEcrire: boolean
  devise: string
  onModifie: () => Promise<unknown>
}

/**
 * "Variants" section: table of variants (SKU, attributes, effective price,
 * status) with creation (key/value attributes, overridable price and floor
 * price) and active/inactive toggle; the displayed price falls back to the
 * product's.
 */
export function SectionVariantes({
  produit,
  productId,
  peutEcrire,
  devise,
  onModifie,
}: Props) {
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

  return (
    <section className="mb-8">
      <div className="mb-3 flex items-center justify-between">
        <h2 className="text-base font-semibold">Variantes</h2>
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
                  {attributs.map((a, index) => (
                    <div key={index} className="flex gap-2">
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
                <div className="flex gap-3">
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
                  <p role="alert" className="text-sm text-destructive">
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
            <TableRow key={v.id}>
              <TableCell className="font-medium">{v.name}</TableCell>
              <TableCell className="font-mono text-xs">{v.sku}</TableCell>
              <TableCell className="text-sm">
                {Object.entries(lireAttributs(v.attributes))
                  .map(([cle, valeur]) => `${cle} : ${valeur}`)
                  .join(", ") || "—"}
              </TableCell>
              <TableCell numeric>
                {formaterMontant(v.priceOverride ?? produit.price, devise)}
              </TableCell>
              <TableCell>
                <Badge variant={v.isActive ? "success" : "secondary"}>
                  {v.isActive ? "Active" : "Inactive"}
                </Badge>
              </TableCell>
              {peutEcrire && (
                <TableCell>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => basculerVariante.mutate(v)}
                  >
                    {v.isActive ? "Désactiver" : "Réactiver"}
                  </Button>
                </TableCell>
              )}
            </TableRow>
          ))}
        </TableBody>
      </Table>
      {erreurBascule && (
        <p role="alert" className="mt-2 text-sm text-destructive">
          {erreurBascule}
        </p>
      )}
    </section>
  )
}
