import { useState } from "react"
import { useMutation, useQueryClient } from "@tanstack/react-query"
import type { CompanyRole, WarehouseRole } from "shared"
import { apiFetch } from "@/lib/api"
import {
  aPorteeGlobale,
  rolesAttribuables,
  ROLES_ENTREPOT_FR,
  ROLES_ENTREPRISE_FR,
} from "@/lib/roles"
import { Button } from "@/components/ui/button"
import { Label } from "@/components/ui/label"
import { toast } from "@/components/ui/toast"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog"
import type { EntrepotOption, Utilisateur } from "./types"

/**
 * Single write surface for one account: company role, warehouse assignments
 * and activation. Each control commits on its own — there is no draft to
 * save, so nothing can be half-applied. Promotion to owner and deactivation
 * ask for confirmation because neither is undone by the same gesture.
 */
export function GererAcces({
  utilisateur,
  entrepots,
  roleDemandeur,
  open,
  onOpenChange,
}: {
  utilisateur: Utilisateur
  entrepots: EntrepotOption[]
  roleDemandeur: CompanyRole
  open: boolean
  onOpenChange: (ouvert: boolean) => void
}) {
  const queryClient = useQueryClient()
  const [entrepotAAffecter, setEntrepotAAffecter] = useState("")
  const [roleAAffecter, setRoleAAffecter] = useState<WarehouseRole>("cashier")
  const [promotionOwner, setPromotionOwner] = useState(false)

  const invalider = () => queryClient.invalidateQueries({ queryKey: ["users"] })
  const surErreur = (err: unknown) =>
    toast.error(err instanceof Error ? err.message : "Erreur")

  const changerRole = useMutation({
    mutationFn: (role: CompanyRole) =>
      apiFetch(`/api/v1/users/${utilisateur.id}/role`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ role }),
      }),
    onSuccess: async () => {
      await invalider()
      toast.success("Rôle mis à jour")
    },
    onError: surErreur,
  })

  const changerStatut = useMutation({
    mutationFn: () =>
      apiFetch(`/api/v1/users/${utilisateur.id}/statut`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ isActive: !utilisateur.isActive }),
      }),
    onSuccess: async () => {
      await invalider()
      toast.success(
        utilisateur.isActive ? "Compte désactivé" : "Compte réactivé"
      )
    },
    onError: surErreur,
  })

  const affecter = useMutation({
    mutationFn: () =>
      apiFetch("/api/v1/warehouse-members", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          userId: utilisateur.id,
          warehouseId: entrepotAAffecter,
          role: roleAAffecter,
        }),
      }),
    onSuccess: async () => {
      await invalider()
      setEntrepotAAffecter("")
      setRoleAAffecter("cashier")
      toast.success("Affectation ajoutée")
    },
    onError: surErreur,
  })

  const retirer = useMutation({
    mutationFn: (assignmentId: string) =>
      apiFetch(`/api/v1/warehouse-members/${assignmentId}`, {
        method: "DELETE",
      }),
    onSuccess: async () => {
      await invalider()
      toast.success("Affectation retirée")
    },
    onError: surErreur,
  })

  // An account can only be assigned to an active warehouse it does not
  // already hold — the API answers DEJA_AFFECTE otherwise, so the choice is
  // narrowed here rather than refused after the fact.
  const dejaAffectes = new Set(
    utilisateur.assignments.map((a) => a.warehouseId)
  )
  const entrepotsDisponibles = entrepots.filter(
    (w) => w.isActive && !dejaAffectes.has(w.id)
  )

  // The current role always stays listed, even when the requester could not
  // assign it, so the select never shows an empty value.
  const attribuables = rolesAttribuables(roleDemandeur)
  const optionsRole = attribuables.includes(utilisateur.role)
    ? attribuables
    : [utilisateur.role, ...attribuables]

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Gérer l'accès — {utilisateur.name}</DialogTitle>
          <DialogDescription>{utilisateur.email}</DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-5">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="ga-role">Rôle d'entreprise</Label>
            <Select
              value={utilisateur.role}
              onValueChange={(valeur) => {
                const role = valeur as CompanyRole
                if (role === utilisateur.role) return
                if (role === "owner") {
                  setPromotionOwner(true)
                  return
                }
                changerRole.mutate(role)
              }}
            >
              <SelectTrigger id="ga-role" className="w-full">
                <SelectValue>
                  {(valeur: CompanyRole) => ROLES_ENTREPRISE_FR[valeur]}
                </SelectValue>
              </SelectTrigger>
              <SelectContent>
                {optionsRole.map((role) => (
                  <SelectItem key={role} value={role}>
                    {ROLES_ENTREPRISE_FR[role]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="flex flex-col gap-2">
            {/* Same weight as a field label: the dialog carries two levels
                of hierarchy, its title and its fields — nothing in between. */}
            <h3 className="text-xs font-medium">Affectations</h3>
            {utilisateur.assignments.length === 0 ? (
              // The consequence is stated where it can be acted on, rather
              // than as a rule hung under the role select.
              <p className="text-xs text-muted-foreground">
                {aPorteeGlobale(utilisateur.role)
                  ? "Aucun entrepôt affecté."
                  : "Aucun entrepôt affecté : ce compte n'a accès à rien."}
              </p>
            ) : (
              <ul className="flex flex-col divide-y divide-border rounded-md border">
                {utilisateur.assignments.map((a) => (
                  <li
                    key={a.id}
                    className="flex items-center justify-between gap-2 px-2 py-1.5"
                  >
                    <span className="text-xs">
                      {a.warehouseName}{" "}
                      <span className="text-muted-foreground">
                        · {ROLES_ENTREPOT_FR[a.role]}
                      </span>
                    </span>
                    {/* No confirmation here: the assignment is restored from
                        the very form below, unlike deactivation, which closes
                        open sessions. */}
                    <Button
                      variant="ghost"
                      size="sm"
                      disabled={retirer.isPending}
                      aria-label={`Retirer l'affectation ${a.warehouseName}`}
                      onClick={() => retirer.mutate(a.id)}
                    >
                      Retirer
                    </Button>
                  </li>
                ))}
              </ul>
            )}

            {entrepotsDisponibles.length === 0 ? (
              <p className="text-xs text-muted-foreground">
                Aucun entrepôt actif à affecter.
              </p>
            ) : (
              <form
                className="flex flex-wrap items-end gap-2"
                onSubmit={(e) => {
                  e.preventDefault()
                  affecter.mutate()
                }}
              >
                <div className="flex flex-col gap-1.5">
                  <Label htmlFor="ga-entrepot">Entrepôt</Label>
                  <Select
                    value={entrepotAAffecter}
                    onValueChange={(valeur) =>
                      setEntrepotAAffecter(valeur as string)
                    }
                  >
                    <SelectTrigger id="ga-entrepot" className="w-52">
                      {/* The render function wins over `placeholder`, so the
                          prompt is spelled out here. Falling back on the
                          lookup rather than on an empty-string test also
                          covers the reset that follows a successful
                          assignment, which drops the warehouse from the
                          list of available ones. */}
                      <SelectValue>
                        {(valeur: string) =>
                          entrepotsDisponibles.find((w) => w.id === valeur)
                            ?.name ?? "— choisir —"
                        }
                      </SelectValue>
                    </SelectTrigger>
                    <SelectContent>
                      {entrepotsDisponibles.map((w) => (
                        <SelectItem key={w.id} value={w.id}>
                          {w.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="flex flex-col gap-1.5">
                  <Label htmlFor="ga-role-entrepot">Rôle</Label>
                  <Select
                    value={roleAAffecter}
                    onValueChange={(valeur) =>
                      setRoleAAffecter(valeur as WarehouseRole)
                    }
                  >
                    <SelectTrigger id="ga-role-entrepot" className="w-36">
                      <SelectValue>
                        {(valeur: WarehouseRole) => ROLES_ENTREPOT_FR[valeur]}
                      </SelectValue>
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="cashier">Caissier</SelectItem>
                      <SelectItem value="manager">Responsable</SelectItem>
                      <SelectItem value="auditor">Auditeur</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <Button
                  type="submit"
                  disabled={affecter.isPending || !entrepotAAffecter}
                >
                  Affecter
                </Button>
              </form>
            )}
          </div>

          <div className="flex items-center justify-between gap-2 border-t pt-4">
            <p className="text-xs text-muted-foreground">
              {utilisateur.isActive
                ? "Le compte peut se connecter."
                : "Le compte ne peut pas se connecter."}
            </p>
            {utilisateur.isActive ? (
              <AlertDialog>
                <AlertDialogTrigger render={<Button variant="destructive" />}>
                  Désactiver le compte
                </AlertDialogTrigger>
                <AlertDialogContent>
                  <AlertDialogHeader>
                    <AlertDialogTitle>Désactiver ce compte ?</AlertDialogTitle>
                    <AlertDialogDescription>
                      {utilisateur.name} ne pourra plus se connecter et ses
                      sessions en cours seront fermées. Ses affectations sont
                      conservées.
                    </AlertDialogDescription>
                  </AlertDialogHeader>
                  <AlertDialogFooter>
                    <AlertDialogCancel>Annuler</AlertDialogCancel>
                    <AlertDialogAction onClick={() => changerStatut.mutate()}>
                      Désactiver
                    </AlertDialogAction>
                  </AlertDialogFooter>
                </AlertDialogContent>
              </AlertDialog>
            ) : (
              <Button
                variant="outline"
                disabled={changerStatut.isPending}
                onClick={() => changerStatut.mutate()}
              >
                Réactiver le compte
              </Button>
            )}
          </div>
        </div>

        <AlertDialog open={promotionOwner} onOpenChange={setPromotionOwner}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Nommer un propriétaire ?</AlertDialogTitle>
              <AlertDialogDescription>
                {utilisateur.name} obtiendra le contrôle total de
                l'organisation, y compris la gestion des propriétaires.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Annuler</AlertDialogCancel>
              <AlertDialogAction onClick={() => changerRole.mutate("owner")}>
                Nommer propriétaire
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </DialogContent>
    </Dialog>
  )
}
