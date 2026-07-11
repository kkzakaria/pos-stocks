import { Outlet, createFileRoute, redirect } from "@tanstack/react-router"

// Garde d'accès du sous-arbre /stock (différé Phase 4) : le back-office
// stock est réservé aux rôles d'entreprise owner/admin/auditor/stock_manager
// et aux staff affectés manager/auditor d'au moins un entrepôt — miroir de
// porteeLectureStock côté API (le front masque, l'API fait autorité).
export const Route = createFileRoute("/_app/stock")({
  beforeLoad: ({ context }) => {
    const role = context.me.membership?.role
    const lectureTous =
      role === "owner" ||
      role === "admin" ||
      role === "auditor" ||
      role === "stock_manager"
    const aUnEntrepotLisible = context.me.assignments.some(
      (a) => a.role === "manager" || a.role === "auditor"
    )
    if (!lectureTous && !aUnEntrepotLisible) {
      throw redirect({ to: "/" })
    }
  },
  component: Outlet,
})
