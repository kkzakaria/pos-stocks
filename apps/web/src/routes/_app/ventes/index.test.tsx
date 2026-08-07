import { render, screen } from "@testing-library/react"
import { ListeAdaptative } from "@/components/ui/liste-adaptative"
import { installerMatchMedia } from "@/test/media-query"
import {
  COLONNES_VENTES,
  titreVente,
  valeurVente,
  sousTitreVente,
} from "./index"
import type { VenteListe } from "@/lib/pos-api"

vi.mock("@tanstack/react-router", async () => {
  const reel = await vi.importActual<Record<string, unknown>>(
    "@tanstack/react-router"
  )
  return {
    ...reel,
    Link: ({
      children,
      params,
    }: {
      children: React.ReactNode
      params?: { saleId?: string }
    }) => <a href={`/ventes/${params?.saleId ?? ""}`}>{children}</a>,
  }
})

const V: VenteListe = {
  id: "s1",
  ticketNumber: 42,
  total: 12500,
  currency: "XOF",
  status: "completed",
  createdAt: "2026-08-07T10:30:00.000Z",
  cashierName: "Awa",
  itemCount: 3,
}

/** fr-FR inserts U+202F narrow no-break spaces in amounts. */
function texteMontant(valeur: number): RegExp {
  return new RegExp(String(valeur).replace(/\B(?=(\d{3})+(?!\d))/g, "\\s?"))
}

function afficher(largeur: number) {
  const nettoyer = installerMatchMedia(largeur)
  render(
    <ListeAdaptative<VenteListe>
      colonnes={COLONNES_VENTES}
      lignes={[V]}
      cle={(v) => v.id}
      titre={titreVente}
      valeur={valeurVente}
      sousTitre={sousTitreVente}
      actionCarte={() => <a href="/ventes/s1">Détail</a>}
    />
  )
  return nettoyer
}

describe("colonnes de l'historique des ventes", () => {
  it("expose 6 entrées : 5 colonnes de données plus l'action", () => {
    expect(COLONNES_VENTES).toHaveLength(6)
    expect(COLONNES_VENTES.at(-1)!.cle).toBe("detail")
  })

  it("rend les en-têtes de données en table à 1280 px", () => {
    const nettoyer = afficher(1280)
    for (const entete of ["N°", "Date", "Caissier", "Articles", "Total"]) {
      expect(screen.getByText(entete)).toBeTruthy()
    }
    nettoyer()
  })

  it("porte le numéro de ticket en titre et le montant en valeur à 375 px", () => {
    const nettoyer = afficher(375)
    const carte = screen.getAllByRole("listitem")[0]
    expect(carte.textContent).toContain("N° 42")
    expect(carte.textContent).toMatch(texteMontant(12500))
    nettoyer()
  })

  it("n'affiche le lien Détail qu'une seule fois en carte", () => {
    const nettoyer = afficher(375)
    const liens = screen.getAllByText("Détail")
    expect(liens).toHaveLength(1)
    expect(liens[0].getAttribute("href")).toBe("/ventes/s1")
    nettoyer()
  })

  it("ne perd aucune donnée en mode carte : les 4 colonnes masquées resurgissent, les 2 autres restent en paires", () => {
    const nettoyer = afficher(375)
    const carte = screen.getAllByRole("listitem")[0]

    // Colonnes masquerEnCarte: true — doivent resurgir via titre/valeur/sous-titre/actionCarte,
    // sans quoi cette donnée serait masquée par la largeur d'écran.
    // "numero" → titreVente.
    expect(carte.textContent).toContain("N° 42")
    // "date" → sousTitreVente : fragment stable de la locale fr-FR (l'année).
    expect(carte.textContent).toContain("2026")
    // "total" → valeurVente : montant formaté en tête de carte.
    expect(carte.textContent).toMatch(texteMontant(12500))
    // "detail" → actionCarte uniquement, jamais dans les paires ni dupliqué.
    expect(screen.getAllByText("Détail")).toHaveLength(1)

    // Colonnes non masquées — passent par `paires`, jamais masquées par construction,
    // mais toujours vérifiées pour garder la couverture explicite.
    expect(carte.textContent).toContain("Awa")
    expect(carte.textContent).toContain("3")
    nettoyer()
  })
})
