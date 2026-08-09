import { jetons } from "./jetons"

describe("jetons", () => {
  it("découpe les classes d'un élément HTML en jetons exacts", () => {
    const div = document.createElement("div")
    div.className = "min-w-0  wrap-anywhere\nwhitespace-normal"
    // Whitespace of every kind collapses, and no empty token survives — the
    // point of comparing tokens rather than substrings.
    expect(jetons(div)).toEqual([
      "min-w-0",
      "wrap-anywhere",
      "whitespace-normal",
    ])
  })

  it("lit aussi les classes d'un élément SVG", () => {
    // The case that motivates `classList`: on an SVG element `className` is an
    // `SVGAnimatedString`, which has no `.split`. The repo renders SVG icons,
    // so this helper is one assertion away from being called on one.
    const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg")
    svg.setAttribute("class", "size-3 shrink-0")
    expect(
      typeof (svg as unknown as { className: unknown }).className
    ).not.toBe("string")
    expect(jetons(svg)).toEqual(["size-3", "shrink-0"])
  })

  it("rend une liste vide sur un élément sans classe", () => {
    expect(jetons(document.createElement("span"))).toEqual([])
  })

  it("rend une liste vide sur une entrée nulle", () => {
    // Deliberate: a query that found nothing must fail on the missing class
    // ("expected [] to contain …"), not on an opaque TypeError.
    expect(jetons(null)).toEqual([])
  })
})
