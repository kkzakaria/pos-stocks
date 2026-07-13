import { useState } from "react"
import { useMutation, useQuery } from "@tanstack/react-query"
import { apiFetch } from "@/lib/api"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Checkbox } from "@/components/ui/checkbox"
import { Textarea } from "@/components/ui/textarea"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import type { Produit } from "./types"

type Categorie = { id: string; name: string }

type FormulaireProduit = {
  name: string
  description: string
  categoryId: string
  barcode: string
  price: string
  minPrice: string
  defaultMinStock: string
  isActive: boolean
}

type Props = {
  produit: Produit
  productId: string
  peutEcrire: boolean
  onModifie: () => Promise<unknown>
}

// Monté avec key={produit.id} par la page : l'état initial du formulaire
// est re-semé quand on navigue vers un autre produit.
export function SectionInfos({
  produit,
  productId,
  peutEcrire,
  onModifie,
}: Props) {
  const [form, setForm] = useState<FormulaireProduit>({
    name: produit.name,
    description: produit.description ?? "",
    categoryId: produit.categoryId ?? "",
    barcode: produit.barcode ?? "",
    price: String(produit.price),
    minPrice: produit.minPrice === null ? "" : String(produit.minPrice),
    defaultMinStock:
      produit.defaultMinStock === null ? "" : String(produit.defaultMinStock),
    isActive: produit.isActive,
  })
  const [message, setMessage] = useState<string | null>(null)

  const categories = useQuery({
    queryKey: ["categories"],
    queryFn: () => apiFetch<{ categories: Categorie[] }>("/api/v1/categories"),
  })

  const enregistrer = useMutation({
    mutationFn: (values: FormulaireProduit) =>
      apiFetch(`/api/v1/products/${productId}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          name: values.name,
          description: values.description === "" ? null : values.description,
          categoryId: values.categoryId === "" ? null : values.categoryId,
          barcode: values.barcode === "" ? null : values.barcode,
          price: Number(values.price),
          minPrice: values.minPrice === "" ? null : Number(values.minPrice),
          defaultMinStock:
            values.defaultMinStock === ""
              ? null
              : Number(values.defaultMinStock),
          isActive: values.isActive,
        }),
      }),
    onSuccess: async () => {
      await onModifie()
      setMessage("Produit enregistré")
    },
    onError: (err) => setMessage(err instanceof Error ? err.message : "Erreur"),
  })

  return (
    <section className="mb-8">
      <h2 className="mb-3 text-base font-semibold">Informations</h2>
      <form
        className="flex flex-col gap-4"
        onSubmit={(e) => {
          e.preventDefault()
          setMessage(null)
          enregistrer.mutate(form)
        }}
      >
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="f-nom">Nom</Label>
          <Input
            id="f-nom"
            required
            disabled={!peutEcrire}
            value={form.name}
            onChange={(e) => setForm({ ...form, name: e.target.value })}
          />
        </div>
        <div className="flex gap-3">
          <div className="flex flex-1 flex-col gap-1.5">
            <Label htmlFor="f-prix">Prix de vente</Label>
            <Input
              id="f-prix"
              type="number"
              min={1}
              step={1}
              required
              disabled={!peutEcrire}
              value={form.price}
              onChange={(e) => setForm({ ...form, price: e.target.value })}
            />
          </div>
          <div className="flex flex-1 flex-col gap-1.5">
            <Label htmlFor="f-plancher">Prix plancher</Label>
            <Input
              id="f-plancher"
              type="number"
              min={1}
              step={1}
              disabled={!peutEcrire}
              value={form.minPrice}
              onChange={(e) => setForm({ ...form, minPrice: e.target.value })}
            />
          </div>
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="f-seuil-alerte">Seuil d'alerte par défaut</Label>
          <Input
            id="f-seuil-alerte"
            type="number"
            min={0}
            step={1}
            disabled={!peutEcrire}
            value={form.defaultMinStock}
            onChange={(e) =>
              setForm({ ...form, defaultMinStock: e.target.value })
            }
          />
          <p className="text-xs text-muted-foreground">
            Alerte quand le stock d'un entrepôt passe sous ce seuil —
            surchargeable par entrepôt.
          </p>
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="f-categorie">Catégorie</Label>
          <Select
            value={form.categoryId}
            onValueChange={(valeur) =>
              setForm({ ...form, categoryId: valeur as string })
            }
            disabled={!peutEcrire}
          >
            <SelectTrigger id="f-categorie" className="w-full">
              <SelectValue placeholder="— aucune —">
                {(valeur: string) =>
                  valeur === ""
                    ? "— aucune —"
                    : (categories.data?.categories ?? []).find(
                        (cat) => cat.id === valeur
                      )?.name
                }
              </SelectValue>
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="">— aucune —</SelectItem>
              {(categories.data?.categories ?? []).map((cat) => (
                <SelectItem key={cat.id} value={cat.id}>
                  {cat.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="f-barcode">Code-barres</Label>
          <Input
            id="f-barcode"
            disabled={!peutEcrire}
            value={form.barcode}
            onChange={(e) => setForm({ ...form, barcode: e.target.value })}
          />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="f-description">Description</Label>
          <Textarea
            id="f-description"
            rows={2}
            disabled={!peutEcrire}
            value={form.description}
            onChange={(e) => setForm({ ...form, description: e.target.value })}
          />
        </div>
        {peutEcrire && (
          <div className="flex items-center gap-2">
            <Checkbox
              id="f-actif"
              checked={form.isActive}
              onCheckedChange={(valeur) =>
                setForm({ ...form, isActive: valeur === true })
              }
            />
            <Label htmlFor="f-actif">Produit actif</Label>
          </div>
        )}
        {message && (
          <p role="status" className="text-sm font-medium text-foreground">
            {message}
          </p>
        )}
        {peutEcrire && (
          <Button type="submit" disabled={enregistrer.isPending}>
            {enregistrer.isPending ? "Enregistrement…" : "Enregistrer"}
          </Button>
        )}
      </form>
    </section>
  )
}
