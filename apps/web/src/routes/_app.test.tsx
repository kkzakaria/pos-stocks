import { vi } from "vitest"
import { render, screen, fireEvent } from "@testing-library/react"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import type * as ReactRouter from "@tanstack/react-router"
import { EnteteMobile } from "@/components/entete-mobile"
import { AppLayout } from "@/routes/_app"
import { ThemeProvider } from "@/lib/theme"
import { installerMatchMedia } from "@/test/media-query"
import type { Me } from "@/lib/me"

const me: Me = {
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
  assignments: [
    { warehouseId: "w1", warehouseName: "Entrepôt Test", role: "manager" },
  ],
}

// AppLayout takes `me` as a prop directly (see _app.tsx), but the module
// also builds `Route` at import time and NavigationPrincipale's
// useAccesStock() reads the bare useRouteContext hook — both need a stub
// since there is no real router in the tree (house pattern, see
// fiche-produit.test.tsx). Link/Outlet/useRouterState are stubbed for the
// same reason.
vi.mock("@tanstack/react-router", async (importOriginal) => {
  const original = await importOriginal<typeof ReactRouter>()
  return {
    ...original,
    Link: ({ children }: { children: React.ReactNode }) => <a>{children}</a>,
    Outlet: () => null,
    useRouteContext: () => ({ me }),
    useRouterState: () => "/",
    createFileRoute: () => () => ({
      useRouteContext: () => ({ me }),
    }),
  }
})

// BadgeAlertesStock (rendered inside NavigationPrincipale) fetches through
// this module — stubbed so the test never issues a real network call.
vi.mock("@/lib/api", () => ({
  apiFetch: vi.fn(() => Promise.resolve({ total: 0 })),
  apiUrl: (chemin: string) => chemin,
}))

function afficher() {
  return render(
    <ThemeProvider>
      <QueryClientProvider client={new QueryClient()}>
        <AppLayout me={me} />
      </QueryClientProvider>
    </ThemeProvider>
  )
}

describe("EnteteMobile", () => {
  it("expose un bouton de menu accessible", () => {
    render(<EnteteMobile onOuvrir={() => undefined} />)
    expect(screen.getByRole("button", { name: "Ouvrir le menu" })).toBeTruthy()
  })

  it("déclenche l'ouverture au clic", () => {
    let ouvert = false
    render(<EnteteMobile onOuvrir={() => (ouvert = true)} />)
    screen.getByRole("button", { name: "Ouvrir le menu" }).click()
    expect(ouvert).toBe(true)
  })
})

describe("AppLayout — bascule structurelle sidebar/tiroir", () => {
  it("à 1280px (desktop) : sidebar fixe, aucun hamburger, nav rendue une seule fois", () => {
    const nettoyer = installerMatchMedia(1280)
    afficher()

    expect(document.querySelector("aside")).toBeTruthy()
    expect(screen.queryByRole("button", { name: "Ouvrir le menu" })).toBeNull()
    expect(
      screen.getAllByRole("navigation", { name: "Navigation principale" })
    ).toHaveLength(1)

    nettoyer()
  })

  it("à 375px (mobile) : hamburger visible, nav dans le tiroir une fois ouvert, une seule fois", () => {
    const nettoyer = installerMatchMedia(375)
    afficher()

    expect(document.querySelector("aside")).toBeNull()
    const bouton = screen.getByRole("button", { name: "Ouvrir le menu" })
    expect(bouton).toBeTruthy()
    // Fermé, le tiroir ne monte pas son contenu (voir drawer.test.tsx) :
    // la nav n'existe donc qu'après ouverture.
    expect(screen.queryByRole("navigation")).toBeNull()

    fireEvent.click(bouton)

    expect(
      screen.getAllByRole("navigation", { name: "Navigation principale" })
    ).toHaveLength(1)

    nettoyer()
  })
})
