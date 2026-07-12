import { useState } from "react"
import { createFileRoute, redirect } from "@tanstack/react-router"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import type { CompanyRole, WarehouseRole } from "shared"
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
import { ProvisionalPasswordDialog } from "@/components/provisional-password-dialog"

export const Route = createFileRoute("/_app/administration/utilisateurs")({
  beforeLoad: ({ context }) => {
    const role = context.me.membership?.role
    if (role !== "owner" && role !== "admin" && role !== "auditor") {
      throw redirect({ to: "/" })
    }
  },
  component: UtilisateursPage,
})

type Utilisateur = {
  id: string
  name: string
  email: string
  role: CompanyRole
  isActive: boolean
  assignments: Array<{
    id: string
    warehouseId: string
    warehouseName: string
    role: WarehouseRole
  }>
}

const ROLES_FR: Record<CompanyRole, string> = {
  owner: "Propriétaire",
  admin: "Administrateur",
  auditor: "Auditeur",
  stock_manager: "Gestionnaire de stock",
  staff: "Employé",
}

const ROLES_ENTREPOT_FR: Record<WarehouseRole, string> = {
  manager: "Responsable",
  auditor: "Auditeur",
  cashier: "Caissier",
}

function UtilisateursPage() {
  const { me } = Route.useRouteContext()
  const peutEcrire =
    me.membership?.role === "owner" || me.membership?.role === "admin"
  const queryClient = useQueryClient()

  const [dialogCreation, setDialogCreation] = useState(false)
  const [nom, setNom] = useState("")
  const [email, setEmail] = useState("")
  const [role, setRole] = useState<CompanyRole>("staff")
  const [erreur, setErreur] = useState<string | null>(null)
  const [provisoire, setProvisoire] = useState<{
    password: string
    email: string
  } | null>(null)
  const [affectation, setAffectation] = useState<{
    userId: string
    warehouseId: string
    role: WarehouseRole
  }>({
    userId: "",
    warehouseId: "",
    role: "cashier",
  })

  const utilisateurs = useQuery({
    queryKey: ["users"],
    queryFn: () => apiFetch<{ users: Utilisateur[] }>("/api/v1/users"),
  })
  const entrepots = useQuery({
    queryKey: ["warehouses"],
    queryFn: () =>
      apiFetch<{ warehouses: Array<{ id: string; name: string }> }>(
        "/api/v1/warehouses"
      ),
  })

  const invalider = () => queryClient.invalidateQueries({ queryKey: ["users"] })

  const creer = useMutation({
    mutationFn: () =>
      apiFetch<{ provisionalPassword: string }>("/api/v1/users", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ name: nom, email, role }),
      }),
    onSuccess: async (res) => {
      await invalider()
      setDialogCreation(false)
      setProvisoire({ password: res.provisionalPassword, email })
      setNom("")
      setEmail("")
      setRole("staff")
      setErreur(null)
    },
    onError: (err) => setErreur(err instanceof Error ? err.message : "Erreur"),
  })

  const changerRole = useMutation({
    mutationFn: (v: { userId: string; role: CompanyRole }) =>
      apiFetch(`/api/v1/users/${v.userId}/role`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ role: v.role }),
      }),
    onSuccess: invalider,
    onError: (err) => alert(err instanceof Error ? err.message : "Erreur"),
  })

  const changerStatut = useMutation({
    mutationFn: (u: Utilisateur) =>
      apiFetch(`/api/v1/users/${u.id}/statut`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ isActive: !u.isActive }),
      }),
    onSuccess: invalider,
    onError: (err) => alert(err instanceof Error ? err.message : "Erreur"),
  })

  const affecter = useMutation({
    mutationFn: () =>
      apiFetch("/api/v1/warehouse-members", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(affectation),
      }),
    onSuccess: async () => {
      await invalider()
      setAffectation({ userId: "", warehouseId: "", role: "cashier" })
    },
    onError: (err) => alert(err instanceof Error ? err.message : "Erreur"),
  })

  const retirerAffectation = useMutation({
    mutationFn: (assignmentId: string) =>
      apiFetch(`/api/v1/warehouse-members/${assignmentId}`, {
        method: "DELETE",
      }),
    onSuccess: invalider,
    onError: (err) => alert(err instanceof Error ? err.message : "Erreur"),
  })

  return (
    <div>
      <div className="mb-6 flex items-center justify-between">
        <h1 className="text-xl font-semibold">Utilisateurs</h1>
        {peutEcrire && (
          <Dialog open={dialogCreation} onOpenChange={setDialogCreation}>
            <DialogTrigger render={<Button />}>
              Nouvel utilisateur
            </DialogTrigger>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>Créer un compte employé</DialogTitle>
              </DialogHeader>
              <form
                className="flex flex-col gap-4"
                onSubmit={(e) => {
                  e.preventDefault()
                  creer.mutate()
                }}
              >
                <div className="flex flex-col gap-1.5">
                  <Label htmlFor="u-nom">Nom</Label>
                  <Input
                    id="u-nom"
                    required
                    value={nom}
                    onChange={(e) => setNom(e.target.value)}
                  />
                </div>
                <div className="flex flex-col gap-1.5">
                  <Label htmlFor="u-email">Email</Label>
                  <Input
                    id="u-email"
                    type="email"
                    required
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                  />
                </div>
                <div className="flex flex-col gap-1.5">
                  <Label htmlFor="u-role">Rôle</Label>
                  <select
                    id="u-role"
                    value={role}
                    onChange={(e) => setRole(e.target.value as CompanyRole)}
                    className="h-10 rounded-md border px-2 text-sm"
                  >
                    <option value="staff">Employé (caissier)</option>
                    <option value="stock_manager">Gestionnaire de stock</option>
                    <option value="auditor">Auditeur</option>
                    {me.membership?.role === "owner" && (
                      <option value="admin">Administrateur</option>
                    )}
                  </select>
                </div>
                {erreur && (
                  <p role="alert" className="text-sm text-red-700">
                    {erreur}
                  </p>
                )}
                <Button type="submit" disabled={creer.isPending}>
                  {creer.isPending ? "Création…" : "Créer le compte"}
                </Button>
              </form>
            </DialogContent>
          </Dialog>
        )}
      </div>

      {provisoire && (
        <ProvisionalPasswordDialog
          password={provisoire.password}
          email={provisoire.email}
          onClose={() => setProvisoire(null)}
        />
      )}

      {utilisateurs.isPending ? (
        <p className="text-sm text-gray-500">Chargement…</p>
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Nom</TableHead>
              <TableHead>Email</TableHead>
              <TableHead>Rôle</TableHead>
              <TableHead>Affectations</TableHead>
              <TableHead>Statut</TableHead>
              {peutEcrire && <TableHead />}
            </TableRow>
          </TableHeader>
          <TableBody>
            {(utilisateurs.data?.users ?? []).map((u) => (
              <TableRow key={u.id}>
                <TableCell className="font-medium">{u.name}</TableCell>
                <TableCell>{u.email}</TableCell>
                <TableCell>
                  {peutEcrire && u.id !== me.user.id ? (
                    <select
                      value={u.role}
                      onChange={(e) =>
                        changerRole.mutate({
                          userId: u.id,
                          role: e.target.value as CompanyRole,
                        })
                      }
                      className="rounded border px-1 py-0.5 text-sm"
                    >
                      {Object.entries(ROLES_FR).map(([valeur, libelle]) => (
                        <option key={valeur} value={valeur}>
                          {libelle}
                        </option>
                      ))}
                    </select>
                  ) : (
                    ROLES_FR[u.role]
                  )}
                </TableCell>
                <TableCell className="text-sm">
                  {u.assignments.length === 0 ? (
                    "—"
                  ) : (
                    <span className="flex flex-wrap gap-1">
                      {u.assignments.map((a) => (
                        <Badge key={a.id} variant="secondary">
                          {a.warehouseName} ({ROLES_ENTREPOT_FR[a.role]})
                          {peutEcrire && (
                            <button
                              type="button"
                              aria-label={`Retirer l'affectation ${a.warehouseName}`}
                              className="ml-1 font-semibold hover:text-red-700"
                              disabled={retirerAffectation.isPending}
                              onClick={() => {
                                if (
                                  window.confirm(
                                    `Retirer l'affectation « ${a.warehouseName} » de ${u.name} ?`
                                  )
                                ) {
                                  retirerAffectation.mutate(a.id)
                                }
                              }}
                            >
                              ×
                            </button>
                          )}
                        </Badge>
                      ))}
                    </span>
                  )}
                </TableCell>
                <TableCell>
                  <Badge variant={u.isActive ? "default" : "secondary"}>
                    {u.isActive ? "Actif" : "Désactivé"}
                  </Badge>
                </TableCell>
                {peutEcrire && (
                  <TableCell>
                    {u.id !== me.user.id && (
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => changerStatut.mutate(u)}
                      >
                        {u.isActive ? "Désactiver" : "Réactiver"}
                      </Button>
                    )}
                  </TableCell>
                )}
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}

      {peutEcrire && (
        <div className="mt-8 max-w-2xl rounded-md border p-4">
          <h2 className="mb-3 text-base font-semibold">
            Affecter à un entrepôt
          </h2>
          <form
            className="flex flex-wrap items-end gap-3"
            onSubmit={(e) => {
              e.preventDefault()
              affecter.mutate()
            }}
          >
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="a-user">Utilisateur</Label>
              <select
                id="a-user"
                required
                value={affectation.userId}
                onChange={(e) =>
                  setAffectation({ ...affectation, userId: e.target.value })
                }
                className="h-10 rounded-md border px-2 text-sm"
              >
                <option value="">— choisir —</option>
                {(utilisateurs.data?.users ?? [])
                  .filter((u) => u.isActive)
                  .map((u) => (
                    <option key={u.id} value={u.id}>
                      {u.name}
                    </option>
                  ))}
              </select>
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="a-wh">Entrepôt</Label>
              <select
                id="a-wh"
                required
                value={affectation.warehouseId}
                onChange={(e) =>
                  setAffectation({
                    ...affectation,
                    warehouseId: e.target.value,
                  })
                }
                className="h-10 rounded-md border px-2 text-sm"
              >
                <option value="">— choisir —</option>
                {(entrepots.data?.warehouses ?? []).map((w) => (
                  <option key={w.id} value={w.id}>
                    {w.name}
                  </option>
                ))}
              </select>
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="a-role">Rôle</Label>
              <select
                id="a-role"
                value={affectation.role}
                onChange={(e) =>
                  setAffectation({
                    ...affectation,
                    role: e.target.value as WarehouseRole,
                  })
                }
                className="h-10 rounded-md border px-2 text-sm"
              >
                <option value="cashier">Caissier</option>
                <option value="manager">Responsable</option>
                <option value="auditor">Auditeur</option>
              </select>
            </div>
            <Button type="submit" disabled={affecter.isPending}>
              Affecter
            </Button>
          </form>
        </div>
      )}
    </div>
  )
}
