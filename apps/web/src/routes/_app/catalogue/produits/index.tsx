import { useEffect, useState } from "react"
import { createFileRoute, useNavigate } from "@tanstack/react-router"
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

export const Route = createFileRoute("/_app/catalogue/produits/")({
  component: ProduitsPage,
})

type Variante = { id: string; isActive: boolean }
type Produit = {
  id: string
  name: string
  sku: string
  price: number
  imageKey: string | null
  isActive: boolean
  variants: Variante[]
}
type Categorie = { id: string; name: string }
type Reglages = { currency: string }

function ProduitsPage() {
  const { me } = Route.useRouteContext()
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const role = me.membership?.role
  const peutEcrire =
    role === "owner" || role === "admin" || role === "stock_manager"

  const [recherche, setRecherche] = useState("")
  const [rechercheDebouncee, setRechercheDebouncee] = useState("")
  const [categorie, setCategorie] = useState("")

  // Debounce 300 ms : la requête ne part qu'une fois la saisie stabilisée
  useEffect(() => {
    const timer = setTimeout(() => setRechercheDebouncee(recherche), 300)
    return () => clearTimeout(timer)
  }, [recherche])

  const produits = useQuery({
    queryKey: ["products", rechercheDebouncee, categorie],
    queryFn: () => {
      const params = new URLSearchParams()
      if (rechercheDebouncee) params.set("recherche", rechercheDebouncee)
      if (categorie) params.set("categorie", categorie)
      const qs = params.toString()
      return apiFetch<{ products: Produit[] }>(
        `/api/v1/products${qs ? `?${qs}` : ""}`
      )
    },
  })
  const categories = useQuery({
    queryKey: ["categories"],
    queryFn: () => apiFetch<{ categories: Categorie[] }>("/api/v1/categories"),
  })
  const organisation = useQuery({
    queryKey: ["organization"],
    queryFn: () => apiFetch<Reglages>("/api/v1/organization"),
  })
  const devise = organisation.data?.currency ?? "XOF"

  const [dialogOuvert, setDialogOuvert] = useState(false)
  const [nom, setNom] = useState("")
  const [prix, setPrix] = useState("")
  const [plancher, setPlancher] = useState("")
  const [categorieProduit, setCategorieProduit] = useState("")
  const [codeBarres, setCodeBarres] = useState("")
  const [description, setDescription] = useState("")
  const [suiviLots, setSuiviLots] = useState(false)
  const [erreur, setErreur] = useState<string | null>(null)

  const creer = useMutation({
    mutationFn: () =>
      apiFetch<{ id: string; sku: string }>("/api/v1/products", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          name: nom,
          price: Number(prix),
          minPrice: plancher ? Number(plancher) : undefined,
          categoryId: categorieProduit || undefined,
          barcode: codeBarres || undefined,
          description: description || undefined,
          trackLots: suiviLots,
        }),
      }),
    onSuccess: async (res) => {
      await queryClient.invalidateQueries({ queryKey: ["products"] })
      setDialogOuvert(false)
      void navigate({
        to: "/catalogue/produits/$productId",
        params: { productId: res.id },
      })
    },
    onError: (err) => setErreur(err instanceof Error ? err.message : "Erreur"),
  })

  return (
    <div>
      <div className="mb-6 flex items-center justify-between">
        <h1 className="text-xl font-semibold">Produits</h1>
        {peutEcrire && (
          <Dialog open={dialogOuvert} onOpenChange={setDialogOuvert}>
            <DialogTrigger render={<Button />}>Nouveau produit</DialogTrigger>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>Nouveau produit</DialogTitle>
              </DialogHeader>
              <form
                className="flex flex-col gap-4"
                onSubmit={(e) => {
                  e.preventDefault()
                  setErreur(null)
                  creer.mutate()
                }}
              >
                <div className="flex flex-col gap-1.5">
                  <Label htmlFor="p-nom">Nom</Label>
                  <Input
                    id="p-nom"
                    required
                    value={nom}
                    onChange={(e) => setNom(e.target.value)}
                  />
                </div>
                <div className="flex gap-3">
                  <div className="flex flex-1 flex-col gap-1.5">
                    <Label htmlFor="p-prix">Prix de vente</Label>
                    <Input
                      id="p-prix"
                      type="number"
                      min={1}
                      step={1}
                      required
                      value={prix}
                      onChange={(e) => setPrix(e.target.value)}
                    />
                  </div>
                  <div className="flex flex-1 flex-col gap-1.5">
                    <Label htmlFor="p-plancher">
                      Prix plancher (optionnel)
                    </Label>
                    <Input
                      id="p-plancher"
                      type="number"
                      min={1}
                      step={1}
                      value={plancher}
                      onChange={(e) => setPlancher(e.target.value)}
                    />
                  </div>
                </div>
                <div className="flex flex-col gap-1.5">
                  <Label htmlFor="p-categorie">Catégorie</Label>
                  <select
                    id="p-categorie"
                    value={categorieProduit}
                    onChange={(e) => setCategorieProduit(e.target.value)}
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
                  <Label htmlFor="p-barcode">Code-barres (optionnel)</Label>
                  <Input
                    id="p-barcode"
                    value={codeBarres}
                    onChange={(e) => setCodeBarres(e.target.value)}
                  />
                </div>
                <div className="flex flex-col gap-1.5">
                  <Label htmlFor="p-description">Description (optionnel)</Label>
                  <textarea
                    id="p-description"
                    rows={2}
                    value={description}
                    onChange={(e) => setDescription(e.target.value)}
                    className="rounded-md border px-3 py-2 text-sm"
                  />
                </div>
                <label className="flex items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    checked={suiviLots}
                    onChange={(e) => setSuiviLots(e.target.checked)}
                  />
                  Suivre les lots (péremption)
                </label>
                {erreur && (
                  <p role="alert" className="text-sm text-red-700">
                    {erreur}
                  </p>
                )}
                <Button type="submit" disabled={creer.isPending}>
                  {creer.isPending ? "Création…" : "Créer le produit"}
                </Button>
              </form>
            </DialogContent>
          </Dialog>
        )}
      </div>

      <div className="mb-4 flex flex-wrap items-end gap-3">
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="p-recherche">Recherche (nom, SKU, code-barres)</Label>
          <Input
            id="p-recherche"
            value={recherche}
            onChange={(e) => setRecherche(e.target.value)}
            className="w-72"
          />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="p-filtre-categorie">Catégorie</Label>
          <select
            id="p-filtre-categorie"
            value={categorie}
            onChange={(e) => setCategorie(e.target.value)}
            className="h-10 rounded-md border px-2 text-sm"
          >
            <option value="">Toutes</option>
            {(categories.data?.categories ?? []).map((cat) => (
              <option key={cat.id} value={cat.id}>
                {cat.name}
              </option>
            ))}
          </select>
        </div>
      </div>

      {produits.isPending ? (
        <p className="text-sm text-gray-500">Chargement…</p>
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead />
              <TableHead>Nom</TableHead>
              <TableHead>SKU</TableHead>
              <TableHead>Prix</TableHead>
              <TableHead>Variantes</TableHead>
              <TableHead>Statut</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {(produits.data?.products ?? []).map((p) => (
              <TableRow
                key={p.id}
                className="cursor-pointer"
                onClick={() =>
                  void navigate({
                    to: "/catalogue/produits/$productId",
                    params: { productId: p.id },
                  })
                }
              >
                <TableCell>
                  {p.imageKey ? (
                    <img
                      src={apiUrl(`/api/v1/files/${p.imageKey}`)}
                      alt=""
                      crossOrigin="use-credentials"
                      className="h-10 w-10 rounded object-cover"
                    />
                  ) : (
                    <div className="h-10 w-10 rounded bg-gray-100" />
                  )}
                </TableCell>
                <TableCell className="font-medium">{p.name}</TableCell>
                <TableCell className="font-mono text-xs">{p.sku}</TableCell>
                <TableCell>{formaterMontant(p.price, devise)}</TableCell>
                <TableCell>
                  <Badge variant="secondary">
                    {p.variants.filter((v) => v.isActive).length}
                  </Badge>
                </TableCell>
                <TableCell>
                  <Badge variant={p.isActive ? "default" : "secondary"}>
                    {p.isActive ? "Actif" : "Inactif"}
                  </Badge>
                </TableCell>
              </TableRow>
            ))}
            {produits.data?.products.length === 0 && (
              <TableRow>
                <TableCell
                  colSpan={6}
                  className="text-center text-sm text-gray-500"
                >
                  Aucun produit trouvé.
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      )}
    </div>
  )
}
