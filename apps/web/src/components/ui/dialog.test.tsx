import { render, screen } from "@testing-library/react"

import { jetons } from "@/test/jetons"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "./dialog"

/**
 * jsdom has NO layout engine and NO Tailwind cascade: nothing here can observe
 * a height, a clipped edge or a scroll offset. What these tests DO hold is the
 * structure (the two boxes exist, and the scroll sits on the inner one) and the
 * class tokens the browser measurements below depend on. The numbers quoted in
 * each test come from Chrome, iPhone-class emulation, coarse pointer, on the
 * « Nouvelle variante » dialog of the product sheet.
 */

function afficher(enfants?: React.ReactNode) {
  return render(
    <Dialog open onOpenChange={() => undefined}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Nouvelle variante</DialogTitle>
          <DialogDescription>Décrivez la variante</DialogDescription>
        </DialogHeader>
        {enfants}
        <DialogFooter>
          <button type="submit">Ajouter</button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function boites(baseElement: Element) {
  const popup = baseElement.querySelector('[data-slot="dialog-content"]')
  const corps = baseElement.querySelector('[data-slot="dialog-body"]')
  return { popup, corps }
}

describe("DialogContent — deux boîtes", () => {
  it("emboîte un corps défilant dans le popup", () => {
    const { baseElement } = afficher()
    const { popup, corps } = boites(baseElement)

    expect(popup).not.toBeNull()
    expect(corps).not.toBeNull()
    expect(popup!.contains(corps)).toBe(true)
  })

  it("place les enfants dans le corps et non en enfants directs du popup", () => {
    // The fix inserts an intermediate box: consumers that reached the header,
    // the footer or a form through the popup's DIRECT children would break
    // silently. This pins the new contract — everything a consumer passes goes
    // through the body.
    const { baseElement } = afficher(<p>Contenu libre</p>)
    const { popup, corps } = boites(baseElement)

    for (const slot of ["dialog-header", "dialog-footer"]) {
      const noeud = baseElement.querySelector(`[data-slot="${slot}"]`)
      expect(noeud).not.toBeNull()
      expect(corps!.contains(noeud)).toBe(true)
      expect(noeud!.parentElement).toBe(corps)
    }
    expect(screen.getByText("Contenu libre").parentElement).toBe(corps)
    // …and the popup itself only holds the body plus the close button.
    expect(
      [...popup!.children].map((n) => n.getAttribute("data-slot"))
    ).toEqual(["dialog-body", "dialog-close"])
  })

  it("borne le popup au viewport sans lui donner le défilement", () => {
    // Browser, « Nouvelle variante », 375×812, coarse pointer: 1 attribute row
    // → popup 614px tall (top 99, submit bottom 697); 4 rows → the popup stops
    // growing at 780px (= 812 − 2rem, top 16, bottom 796) instead of the 938px
    // that used to push the submit button to 859 on an 812px screen.
    // `max-h` bounds it, `flex`+`flex-col` lets the inner box take the slack.
    const { baseElement } = afficher()
    const { popup } = boites(baseElement)
    const t = jetons(popup)

    expect(t).toContain("max-h-[calc(100dvh-2rem)]")
    expect(t).toContain("flex")
    expect(t).toContain("flex-col")
    // The popup must NOT scroll: the close button is positioned against it, so
    // scrolling here would carry the close button out of reach.
    expect(t).not.toContain("overflow-y-auto")
    expect(t).not.toContain("overflow-auto")
  })

  it("donne au corps la grille, le rétrécissement et le défilement vertical", () => {
    // Browser, 8 attribute rows at 375×812: body clientHeight 748 for a
    // scrollHeight of 1422 — the submit button sits at 1410 before scrolling
    // (elementFromPoint misses it) and at 736→780 after, where elementFromPoint
    // returns the button itself. `min-h-0` is what allows that shrink.
    const { baseElement } = afficher()
    const { corps } = boites(baseElement)
    const t = jetons(corps)

    expect(t).toContain("grid")
    expect(t).toContain("gap-4")
    expect(t).toContain("min-h-0")
    expect(t).toContain("overflow-y-auto")
    // Browser, « Modifier la catégorie » with a long parent name: without
    // `*:min-w-0` the grid track took the select trigger's min-content width
    // and the dialog ran from 32 to 536px on a 375px screen — while
    // `document.documentElement.scrollWidth` still read 375, so no automated
    // overflow check could see it. With it, the trigger and the « Enregistrer »
    // button both end at 343.
    expect(t).toContain("*:min-w-0")
  })

  it("garde la croix hors du corps défilant", () => {
    // Browser: at 4 and 8 rows the close button stays at top 24→68 whatever the
    // inner scroll offset, and elementFromPoint at its centre returns the
    // button. Being a sibling of the scroller is what guarantees it.
    const { baseElement } = afficher()
    const { popup, corps } = boites(baseElement)
    const croix = baseElement.querySelector('[data-slot="dialog-close"]')

    expect(croix).not.toBeNull()
    expect(corps!.contains(croix)).toBe(false)
    expect(croix!.parentElement).toBe(popup)
  })

  it("agrandit la croix à la taille tactile sur pointeur grossier", () => {
    // Browser: 44×44 at 375px with a coarse pointer (it was 24×24, the only
    // touch target of the dialog below the 44px floor), and still 24×24 at
    // 1280px with a fine pointer — the growth is conditional, not unconditional.
    const { baseElement } = afficher()
    const croix = baseElement.querySelector('[data-slot="dialog-close"]')
    const t = jetons(croix)

    expect(t).toContain("pointer-coarse:size-11")
    expect(t).toContain("size-6")
  })

  it("n'affiche rien tant que le dialogue est fermé", () => {
    render(
      <Dialog open={false} onOpenChange={() => undefined}>
        <DialogContent>
          <DialogTitle>Nouvelle variante</DialogTitle>
        </DialogContent>
      </Dialog>
    )

    expect(screen.queryByText("Nouvelle variante")).toBeNull()
  })

  it("omet la croix quand le consommateur la refuse", () => {
    const { baseElement } = render(
      <Dialog open onOpenChange={() => undefined}>
        <DialogContent showCloseButton={false}>
          <DialogTitle>Compte créé</DialogTitle>
        </DialogContent>
      </Dialog>
    )
    const { popup } = boites(baseElement)

    expect(baseElement.querySelector('[data-slot="dialog-close"]')).toBeNull()
    // The body must remain, otherwise the scroll would go with the close button.
    expect(
      [...popup!.children].map((n) => n.getAttribute("data-slot"))
    ).toEqual(["dialog-body"])
  })
})
