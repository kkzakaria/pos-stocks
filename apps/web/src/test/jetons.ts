/**
 * Reads an element's exact class tokens, through `classList`.
 *
 * Class assertions must compare TOKENS, never substrings: Tailwind names nest
 * as prefixes of one another (`min-w-0` is a prefix of `min-w-0.5`, `w-full`
 * of `w-full-something`, `pointer-events-none` appears inside
 * `disabled:pointer-events-none`), so a `toContain` on the raw string is a
 * false positive waiting to happen — it would pass on a class that is NOT the
 * one under test.
 *
 * `classList` rather than a `className.split`: on an SVG element `className`
 * is an `SVGAnimatedString`, not a string, so splitting it throws. This helper
 * is shared and the app renders SVG icons, so the only correct source is the
 * one API both HTML and SVG elements implement — which also normalises
 * whitespace and yields an empty list for a class-less element instead of the
 * `[""]` a split returns.
 *
 * Returns an empty array on a null element on purpose: the assertion then
 * fails on the missing class (a readable "expected [] to contain …") instead
 * of throwing an opaque TypeError when the queried element has disappeared.
 */
export function jetons(element: Element | null): string[] {
  return element ? Array.from(element.classList) : []
}
