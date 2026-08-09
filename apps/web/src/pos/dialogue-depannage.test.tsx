import { describe, it, expect, vi } from "vitest"
import { render, screen } from "@testing-library/react"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { jetons } from "@/test/jetons"
import { DialogueDepannage } from "./dialogue-depannage"
import type { LignePanier } from "@/lib/pos"

vi.mock("@/lib/pos-api", () => ({
  fetchDisponibilites: () => Promise.resolve({ disponibilites: [] }),
}))

// A SKU-shaped name: no space, no hyphen past the prefix, so nothing in it is
// a line-break opportunity. This is exactly the shape that widened the panel.
const NOM_SANS_COUPURE =
  "ZZZRESP-ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ"

function ligne(nom = NOM_SANS_COUPURE): LignePanier {
  return {
    variantId: "v1",
    nom,
    sku: "SKU-1",
    quantite: 1,
    prixUnitaire: 1000,
    prixCatalogue: 1000,
    prixPlancher: null,
    sourceWarehouseId: null,
    sourceNom: null,
    enAlerte: true,
  }
}

function rendre(nom?: string) {
  const onFermer = vi.fn()
  render(
    <QueryClientProvider client={new QueryClient()}>
      <DialogueDepannage
        storeId="store1"
        ligne={ligne(nom)}
        onChoisir={vi.fn()}
        onFermer={onFermer}
      />
    </QueryClientProvider>
  )
  return onFermer
}

// jsdom has neither a layout engine nor a CSS cascade: these cases guard that
// the classes are APPLIED, never that they produce their effect. The effect
// was measured in Chrome (mobile emulation, coarse pointer) with the cart line
// above — the dialog is `position: fixed`, so `documentElement.scrollWidth`
// stays equal to `clientWidth` and no document-level overflow assertion can
// see it; only element rectangles and `document.elementFromPoint` can.
//
//   375 x 812 and 375 x 667, before → panel x 16..464 (448 px in a 375 px
//            viewport), « Fermer » x 620..649, missed by `elementFromPoint`;
//   after  → panel x 16..359 (343 px), widest descendant right edge 339,
//            « Fermer » x 295..339 (44 x 44) and returned by
//            `elementFromPoint` at its centre.
//   1280 x 900, before === after: panel x 416..864 (448 x 148), « Fermer »
//            x 815..844.
describe("DialogueDepannage — tenue à 375 px (mesurée au navigateur)", () => {
  it("le calque met sa colonne à minimum zéro au lieu du plancher min-content", () => {
    rendre()
    // `auto` floors the track at the panel's min-content and free space is
    // distributed only while it is positive: `grid-cols-1` is `minmax(0, 1fr)`
    // and it is the zero MINIMUM that corrects this — `1fr` alone
    // (`minmax(auto, 1fr)`) keeps the floor and would not.
    const calque = screen.getByRole("dialog").parentElement
    expect(jetons(calque)).toContain("grid")
    expect(jetons(calque)).toContain("grid-cols-1")
  })

  it("le nom d'article se coupe au lieu de chasser le bouton « Fermer »", () => {
    rendre()
    const nom = screen.getByText(NOM_SANS_COUPURE)
    // `min-w-0` on the flex item, `break-words` on the name itself: either one
    // missing and the unbreakable name keeps its full width, pushing the close
    // button past the right edge of the viewport.
    expect(jetons(nom.parentElement)).toContain("min-w-0")
    expect(jetons(nom)).toContain("break-words")
    expect(jetons(screen.getByRole("button", { name: "Fermer" }))).toContain(
      "shrink-0"
    )
  })
})
