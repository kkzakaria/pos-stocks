import { useState } from "react"
import { useMutation, useQuery } from "@tanstack/react-query"
import { apiFetch } from "@/lib/api"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import type { Produit } from "./types"

type Categorie = { id: string; name: string }

type FormulaireProduit = {
  name: string
  description: string
  categoryId: string
  barcode: string
  price: string
  minPrice: string
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
          description: values.description || undefined,
          categoryId: values.categoryId || undefined,
          barcode: values.barcode || undefined,
          price: Number(values.price),
          minPrice: values.minPrice ? Number(values.minPrice) : undefined,
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
          <Label htmlFor="f-categorie">Catégorie</Label>
          <select
            id="f-categorie"
            disabled={!peutEcrire}
            value={form.categoryId}
            onChange={(e) => setForm({ ...form, categoryId: e.target.value })}
            className="h-10 rounded-md border px-2 text-sm"
          >
            <option value="">— aucune —</option>
            {(categories.data?.categories ?? []).map((cat) => (
              <option key={cat.id} value={cat.id}>
                {cat.name}
              </option>
            ))}
          </select>
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
          <textarea
            id="f-description"
            rows={2}
            disabled={!peutEcrire}
            value={form.description}
            onChange={(e) => setForm({ ...form, description: e.target.value })}
            className="rounded-md border px-3 py-2 text-sm"
          />
        </div>
        {peutEcrire && (
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={form.isActive}
              onChange={(e) => setForm({ ...form, isActive: e.target.checked })}
            />
            Produit actif
          </label>
        )}
        {message && (
          <p role="status" className="text-sm font-medium text-gray-700">
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
