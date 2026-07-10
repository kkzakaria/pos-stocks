import { useEffect, useState } from "react"
import { createFileRoute } from "@tanstack/react-router"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { apiFetch, apiUrl } from "@/lib/api"
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

export const Route = createFileRoute("/_app/catalogue/produits/$productId")({
  component: FicheProduitPage,
})

type Lot = { id: string; lotNumber: string; expiryDate: string | null }
type Variante = {
  id: string
  name: string
  attributes: string
  sku: string
  barcode: string | null
  priceOverride: number | null
  minPriceOverride: number | null
  isActive: boolean
  lots: Lot[]
}
type Produit = {
  id: string
  name: string
  description: string | null
  categoryId: string | null
  sku: string
  barcode: string | null
  price: number
  minPrice: number | null
  hasVariants: boolean
  trackLots: boolean
  imageKey: string | null
  isActive: boolean
  variants: Variante[]
}
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

function lireAttributs(brut: string): Record<string, string> {
  try {
    return JSON.parse(brut) as Record<string, string>
  } catch {
    return {}
  }
}

function estExpire(lot: Lot): boolean {
  return lot.expiryDate !== null && new Date(lot.expiryDate) < new Date()
}

function FicheProduitPage() {
  const { me } = Route.useRouteContext()
  const { productId } = Route.useParams()
  const role = me.membership?.role
  const peutEcrire =
    role === "owner" || role === "admin" || role === "stock_manager"
  const queryClient = useQueryClient()

  const { data } = useQuery({
    queryKey: ["product", productId],
    queryFn: () =>
      apiFetch<{ product: Produit }>(`/api/v1/products/${productId}`),
  })
  const categories = useQuery({
    queryKey: ["categories"],
    queryFn: () => apiFetch<{ categories: Categorie[] }>("/api/v1/categories"),
  })
  const organisation = useQuery({
    queryKey: ["organization"],
    queryFn: () => apiFetch<{ currency: string }>("/api/v1/organization"),
  })
  const devise = organisation.data?.currency ?? "XOF"

  const [form, setForm] = useState<FormulaireProduit | null>(null)
  useEffect(() => {
    if (data && !form) {
      const p = data.product
      setForm({
        name: p.name,
        description: p.description ?? "",
        categoryId: p.categoryId ?? "",
        barcode: p.barcode ?? "",
        price: String(p.price),
        minPrice: p.minPrice === null ? "" : String(p.minPrice),
        isActive: p.isActive,
      })
    }
  }, [data, form])

  const [message, setMessage] = useState<string | null>(null)
  const [erreurImage, setErreurImage] = useState<string | null>(null)
  const [versionImage, setVersionImage] = useState(0)

  const invalider = () =>
    queryClient.invalidateQueries({ queryKey: ["product", productId] })

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
      await invalider()
      setMessage("Produit enregistré")
    },
    onError: (err) => setMessage(err instanceof Error ? err.message : "Erreur"),
  })

  const envoyerImage = useMutation({
    mutationFn: (fichier: File) => {
      const donnees = new FormData()
      donnees.append("image", fichier)
      // pas d'en-tête content-type : le navigateur pose le boundary multipart
      return apiFetch(`/api/v1/products/${productId}/image`, {
        method: "POST",
        body: donnees,
      })
    },
    onSuccess: async () => {
      await invalider()
      setVersionImage((v) => v + 1)
      setErreurImage(null)
    },
    onError: (err) =>
      // Les messages IMAGE_TROP_LOURDE / FORMAT_IMAGE arrivent déjà en
      // français via apiFetch (body.message)
      setErreurImage(err instanceof Error ? err.message : "Erreur"),
  })

  // Dialog variante
  const [dialogVariante, setDialogVariante] = useState(false)
  const [nomVariante, setNomVariante] = useState("")
  const [attributs, setAttributs] = useState<
    Array<{ cle: string; valeur: string }>
  >([{ cle: "", valeur: "" }])
  const [prixVariante, setPrixVariante] = useState("")
  const [plancherVariante, setPlancherVariante] = useState("")
  const [codeBarresVariante, setCodeBarresVariante] = useState("")
  const [erreurVariante, setErreurVariante] = useState<string | null>(null)

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
      await invalider()
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
    onSuccess: invalider,
    onError: (err) => alert(err instanceof Error ? err.message : "Erreur"),
  })

  // Dialog lot
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
      await invalider()
      setDialogLotPour(null)
      setNumeroLot("")
      setDatePeremption("")
      setErreurLot(null)
    },
    onError: (err) =>
      setErreurLot(err instanceof Error ? err.message : "Erreur"),
  })

  if (!data || !form) {
    return <p className="text-sm text-gray-500">Chargement…</p>
  }
  const produit = data.product

  return (
    <div className="max-w-3xl">
      <div className="mb-6 flex items-center gap-3">
        <h1 className="text-xl font-semibold">{produit.name}</h1>
        <span className="font-mono text-xs text-gray-500">{produit.sku}</span>
        <Badge variant={produit.isActive ? "default" : "secondary"}>
          {produit.isActive ? "Actif" : "Inactif"}
        </Badge>
      </div>

      <section className="mb-8 flex items-start gap-6">
        {produit.imageKey ? (
          <img
            src={`${apiUrl(`/api/v1/files/${produit.imageKey}`)}?v=${versionImage}`}
            alt={produit.name}
            crossOrigin="use-credentials"
            className="h-32 w-32 rounded-md border object-cover"
          />
        ) : (
          <div className="flex h-32 w-32 items-center justify-center rounded-md border bg-gray-50 text-xs text-gray-400">
            Aucune image
          </div>
        )}
        {peutEcrire && (
          <div className="flex flex-col gap-2">
            <Label htmlFor="p-image">Image (JPEG, PNG, WebP — 2 Mo max)</Label>
            <input
              id="p-image"
              type="file"
              accept="image/jpeg,image/png,image/webp"
              onChange={(e) => {
                // e.target.files est nullable (FileList | null) : l'optional
                // chain est légitime ici pour no-unnecessary-condition
                const fichier = e.target.files?.[0]
                if (fichier) envoyerImage.mutate(fichier)
              }}
              className="text-sm"
            />
            {erreurImage && (
              <p role="alert" className="text-sm text-red-700">
                {erreurImage}
              </p>
            )}
          </div>
        )}
      </section>

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
              onChange={(e) =>
                setForm({ ...form, description: e.target.value })
              }
              className="rounded-md border px-3 py-2 text-sm"
            />
          </div>
          {peutEcrire && (
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={form.isActive}
                onChange={(e) =>
                  setForm({ ...form, isActive: e.target.checked })
                }
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
                    <p role="alert" className="text-sm text-red-700">
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
              <TableHead>Prix</TableHead>
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
                <TableCell>
                  {formaterMontant(v.priceOverride ?? produit.price, devise)}
                </TableCell>
                <TableCell>
                  <Badge variant={v.isActive ? "default" : "secondary"}>
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
      </section>

      {produit.trackLots && (
        <section className="mb-8">
          <h2 className="mb-3 text-base font-semibold">Lots</h2>
          {produit.variants
            .filter((v) => v.isActive)
            .map((v) => (
              <div key={v.id} className="mb-4 rounded-md border p-4">
                <div className="mb-2 flex items-center justify-between">
                  <p className="text-sm font-medium">{v.name}</p>
                  {peutEcrire && (
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => setDialogLotPour(v.id)}
                    >
                      Ajouter un lot
                    </Button>
                  )}
                </div>
                {v.lots.length === 0 ? (
                  <p className="text-sm text-gray-500">Aucun lot.</p>
                ) : (
                  <ul className="flex flex-col gap-1">
                    {v.lots.map((lot) => (
                      <li
                        key={lot.id}
                        className="flex items-center gap-3 text-sm"
                      >
                        <span className="font-mono">{lot.lotNumber}</span>
                        <span className="text-gray-500">
                          {lot.expiryDate
                            ? new Date(lot.expiryDate).toLocaleDateString(
                                "fr-FR"
                              )
                            : "sans péremption"}
                        </span>
                        {estExpire(lot) && (
                          <span className="rounded bg-red-100 px-2 py-0.5 text-xs font-medium text-red-800">
                            Expiré
                          </span>
                        )}
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            ))}
        </section>
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
                <p role="alert" className="text-sm text-red-700">
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
    </div>
  )
}
