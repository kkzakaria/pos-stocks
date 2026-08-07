import { render, screen, within } from "@testing-library/react"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { ListeAdaptative } from "@/components/ui/liste-adaptative"
import { installerMatchMedia } from "@/test/media-query"
import {
  COLONNES_VENTES,
  titreVente,
  valeurVente,
  sousTitreVente,
  HistoriqueVentes,
} from "./index"
import type { VenteListe } from "@/lib/pos-api"
import type { Me } from "@/lib/me"

const ME: Me = {
  user: {
    id: "u1",
    email: "owner@exemple.com",
    name: "Propriétaire Test",
    mustChangePassword: false,
  },
  membership: {
    organizationId: "org1",
    organizationName: "Organisation Test",
    role: "owner",
  },
  assignments: [],
}

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
    useRouteContext: () => ({ me: ME }),
  }
})

// The destinations query never resolves — mirrors "no shop selected"
// (boutiqueId stays null) without needing to wait on a real fetch.
vi.mock("@/lib/api", () => ({
  apiFetch: vi.fn(() => new Promise(() => undefined)),
  apiUrl: (chemin: string) => chemin,
}))

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

/**
 * Card mode renders non-hidden columns as `<dt>`/`<dd>` pairs inside a
 * `<dl>` — reading the `<dd>` next to a given `<dt>` label targets that
 * specific pair instead of the whole card's `textContent`, which other
 * fields (a date, a ticket number) can satisfy by coincidence.
 */
function valeurPaire(carte: HTMLElement, libelle: string): string {
  const dt = within(carte).getByText(libelle)
  const dd = dt.nextElementSibling
  if (!(dd instanceof HTMLElement)) {
    throw new Error(`Aucune <dd> associée au libellé « ${libelle} »`)
  }
  return dd.textContent
}

function afficher(largeur: number) {
  const nettoyer = installerMatchMedia(largeur)
  render(
    <ListeAdaptative<VenteListe>
      colonnes={COLONNES_VENTES}
      lignes={[V]}
      cleLigne={(v) => v.id}
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

    // masquerEnCarte: true columns — must resurface via titre/valeur/sousTitre/actionCarte,
    // otherwise this data would be hidden by screen width.
    // "numero" → titreVente.
    expect(carte.textContent).toContain("N° 42")
    // "date" → sousTitreVente: stable fr-FR locale fragment (the year).
    expect(carte.textContent).toContain("2026")
    // "total" → valeurVente: formatted amount at the top of the card.
    expect(carte.textContent).toMatch(texteMontant(12500))
    // "detail" → actionCarte only, never in the pairs, never duplicated.
    expect(screen.getAllByText("Détail")).toHaveLength(1)

    // Non-hidden columns — go through `paires`, never hidden by construction,
    // but still checked to keep coverage explicit. Targeted at the dt/dd
    // pair itself: `carte.textContent` alone would also match "3" inside
    // the fr-FR rendering of createdAt ("07/08/2026 10:30:00"), which
    // would pass even if the "Articles" column vanished entirely.
    expect(valeurPaire(carte, "Caissier")).toBe("Awa")
    expect(valeurPaire(carte, "Articles")).toBe("3")
    nettoyer()
  })
})

describe("HistoriqueVentes — squelette d'une requête désactivée", () => {
  it("n'affiche pas de squelette indéfini quand aucune boutique n'est sélectionnée (requête désactivée)", () => {
    const nettoyer = installerMatchMedia(1280)
    const queryClient = new QueryClient()
    render(
      <QueryClientProvider client={queryClient}>
        <HistoriqueVentes />
      </QueryClientProvider>
    )

    // La requête "destinations" ne se résout jamais : boutiqueId reste null
    // et la requête "ventes" reste enabled: false. `isPending` d'une requête
    // désactivée vaut toujours true — seul `isLoading` (isPending &&
    // isFetching) distingue ce cas d'un vrai chargement en cours.
    expect(document.querySelectorAll('[data-slot="skeleton"]')).toHaveLength(0)
    expect(screen.getByText("Aucune vente")).toBeTruthy()

    nettoyer()
  })
})
