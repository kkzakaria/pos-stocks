import { useState } from "react"
import { createFileRoute, redirect } from "@tanstack/react-router"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { apiFetch } from "@/lib/api"
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

export const Route = createFileRoute("/_app/administration/entrepots")({
  beforeLoad: ({ context }) => {
    const role = context.me.membership?.role
    if (role !== "owner" && role !== "admin" && role !== "auditor") {
      throw redirect({ to: "/" })
    }
  },
  component: EntrepotsPage,
})

type Warehouse = {
  id: string
  name: string
  type: "warehouse" | "store"
  address: string | null
  isActive: boolean
}

const TYPES = { warehouse: "Entrepôt", store: "Boutique" } as const

function EntrepotsPage() {
  const { me } = Route.useRouteContext()
  const peutEcrire =
    me.membership?.role === "owner" || me.membership?.role === "admin"
  const queryClient = useQueryClient()
  const [dialogOuvert, setDialogOuvert] = useState(false)
  const [nom, setNom] = useState("")
  const [type, setType] = useState<"warehouse" | "store">("store")
  const [adresse, setAdresse] = useState("")
  const [erreur, setErreur] = useState<string | null>(null)

  const { data, isPending } = useQuery({
    queryKey: ["warehouses"],
    queryFn: () => apiFetch<{ warehouses: Warehouse[] }>("/api/v1/warehouses"),
  })

  const creer = useMutation({
    mutationFn: () =>
      apiFetch("/api/v1/warehouses", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          name: nom,
          type,
          address: adresse || undefined,
        }),
      }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["warehouses"] })
      setDialogOuvert(false)
      setNom("")
      setAdresse("")
      setErreur(null)
    },
    onError: (err) => setErreur(err instanceof Error ? err.message : "Erreur"),
  })

  const basculer = useMutation({
    mutationFn: (w: Warehouse) =>
      apiFetch(`/api/v1/warehouses/${w.id}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ isActive: !w.isActive }),
      }),
    onSuccess: () =>
      queryClient.invalidateQueries({ queryKey: ["warehouses"] }),
  })

  return (
    <div>
      <div className="mb-6 flex items-center justify-between">
        <h1 className="text-xl font-semibold">Entrepôts &amp; boutiques</h1>
        {peutEcrire && (
          <Dialog open={dialogOuvert} onOpenChange={setDialogOuvert}>
            <DialogTrigger render={<Button />}>Nouvel entrepôt</DialogTrigger>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>Nouvel entrepôt ou boutique</DialogTitle>
              </DialogHeader>
              <form
                className="flex flex-col gap-4"
                onSubmit={(e) => {
                  e.preventDefault()
                  creer.mutate()
                }}
              >
                <div className="flex flex-col gap-1.5">
                  <Label htmlFor="wh-nom">Nom</Label>
                  <Input
                    id="wh-nom"
                    required
                    value={nom}
                    onChange={(e) => setNom(e.target.value)}
                  />
                </div>
                <div className="flex flex-col gap-1.5">
                  <Label htmlFor="wh-type">Type</Label>
                  <select
                    id="wh-type"
                    value={type}
                    onChange={(e) =>
                      setType(e.target.value as "warehouse" | "store")
                    }
                    className="h-10 rounded-md border px-2 text-sm"
                  >
                    <option value="store">
                      Boutique (avec point de vente)
                    </option>
                    <option value="warehouse">Entrepôt (réserve)</option>
                  </select>
                </div>
                <div className="flex flex-col gap-1.5">
                  <Label htmlFor="wh-adresse">Adresse (optionnel)</Label>
                  <Input
                    id="wh-adresse"
                    value={adresse}
                    onChange={(e) => setAdresse(e.target.value)}
                  />
                </div>
                {erreur && (
                  <p role="alert" className="text-sm text-red-700">
                    {erreur}
                  </p>
                )}
                <Button type="submit" disabled={creer.isPending}>
                  {creer.isPending ? "Création…" : "Créer"}
                </Button>
              </form>
            </DialogContent>
          </Dialog>
        )}
      </div>

      {isPending ? (
        <p className="text-sm text-gray-500">Chargement…</p>
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Nom</TableHead>
              <TableHead>Type</TableHead>
              <TableHead>Adresse</TableHead>
              <TableHead>Statut</TableHead>
              {peutEcrire && <TableHead />}
            </TableRow>
          </TableHeader>
          <TableBody>
            {(data?.warehouses ?? []).map((w) => (
              <TableRow key={w.id}>
                <TableCell className="font-medium">{w.name}</TableCell>
                <TableCell>{TYPES[w.type]}</TableCell>
                <TableCell>{w.address ?? "—"}</TableCell>
                <TableCell>
                  <Badge variant={w.isActive ? "default" : "secondary"}>
                    {w.isActive ? "Actif" : "Inactif"}
                  </Badge>
                </TableCell>
                {peutEcrire && (
                  <TableCell>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => basculer.mutate(w)}
                    >
                      {w.isActive ? "Désactiver" : "Réactiver"}
                    </Button>
                  </TableCell>
                )}
              </TableRow>
            ))}
            {data?.warehouses.length === 0 && (
              <TableRow>
                <TableCell
                  colSpan={peutEcrire ? 5 : 4}
                  className="text-center text-sm text-gray-500"
                >
                  Aucun entrepôt — créez le premier pour démarrer.
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      )}
    </div>
  )
}
