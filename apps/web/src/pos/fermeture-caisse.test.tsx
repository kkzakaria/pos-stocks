import { describe, it, expect, vi } from "vitest"
import { render, screen } from "@testing-library/react"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { jetons } from "@/test/jetons"
import { FermetureCaisse } from "./fermeture-caisse"
import type { SessionCaisse } from "@/lib/pos-api"

const session: SessionCaisse = {
  id: "session1",
  openingFloat: 20000,
  openedAt: new Date().toISOString(),
}

function rendre() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  })
  render(
    <QueryClientProvider client={queryClient}>
      <FermetureCaisse
        session={session}
        onFermee={vi.fn()}
        onAnnuler={vi.fn()}
      />
    </QueryClientProvider>
  )
}

// jsdom has neither a layout engine nor a CSS cascade: this case guards that
// the class is APPLIED, never that it produces its effect. This overlay is one
// of the five copies in `pos/` of the `grid place-items-center` pattern whose
// implicit `auto` column is floored at the panel's min-content. Nothing
// overflows here TODAY — the largest token, the variance, is one type step
// below the amounts that did overflow — so `grid-cols-1` is inert (identical
// rendering with and without, checked in the browser at 375 x 812: panel
// x 16..359 either way). It is pinned all the same, so the faulty pattern
// stops being copyable and a future amount cannot drag the panel off-screen.
describe("FermetureCaisse — tenue à 375 px", () => {
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
})
