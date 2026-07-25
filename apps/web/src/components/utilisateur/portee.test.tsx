import { describe, it, expect } from "vitest"
import { render, screen } from "@testing-library/react"
import { PorteeUtilisateur } from "@/components/utilisateur/portee"
import type { Utilisateur } from "@/components/utilisateur/types"

function utilisateur(surcharge: Partial<Utilisateur> = {}): Utilisateur {
  return {
    id: "u1",
    name: "Awa Traoré",
    email: "awa@exemple.com",
    role: "staff",
    isActive: true,
    assignments: [],
    ...surcharge,
  }
}

describe("PorteeUtilisateur", () => {
  it("annonce la portée globale des rôles d'entreprise, sans lister leurs affectations", () => {
    render(
      <PorteeUtilisateur
        utilisateur={utilisateur({
          role: "stock_manager",
          assignments: [
            {
              id: "a1",
              warehouseId: "w1",
              warehouseName: "Dépôt central",
              role: "manager",
            },
          ],
        })}
      />
    )

    expect(screen.getByText("Tous les entrepôts")).toBeTruthy()
    expect(screen.queryByText(/Dépôt central/)).toBeNull()
  })

  it("liste l'entrepôt et le rôle local d'un employé affecté", () => {
    render(
      <PorteeUtilisateur
        utilisateur={utilisateur({
          assignments: [
            {
              id: "a1",
              warehouseId: "w1",
              warehouseName: "Boutique Centre",
              role: "cashier",
            },
            {
              id: "a2",
              warehouseId: "w2",
              warehouseName: "Dépôt central",
              role: "auditor",
            },
          ],
        })}
      />
    )

    expect(screen.getByText(/Boutique Centre/)).toBeTruthy()
    expect(screen.getByText(/· Caissier/)).toBeTruthy()
    expect(screen.getByText(/Dépôt central/)).toBeTruthy()
    expect(screen.getByText(/· Auditeur/)).toBeTruthy()
    expect(screen.queryByText("Aucun accès")).toBeNull()
  })

  it("signale qu'un employé sans affectation n'a accès à rien", () => {
    render(<PorteeUtilisateur utilisateur={utilisateur()} />)

    expect(screen.getByText("Aucun accès")).toBeTruthy()
    expect(screen.queryByText("Tous les entrepôts")).toBeNull()
  })
})
