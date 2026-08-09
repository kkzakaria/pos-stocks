/**
 * Maximum size the server accepts for a product image (2 MB). The server
 * rejects early, on `content-length`, so this bound is a hard target rather
 * than an indication.
 */
export const TAILLE_IMAGE_MAX = 2 * 1024 * 1024

/**
 * MIME types the server accepts for a product image. Typed `readonly string[]`
 * on purpose: a `as const` tuple would make `.includes(fichier.type)` a type
 * error, since `File.type` is a plain `string`.
 */
export const TYPES_IMAGE_ACCEPTES: readonly string[] = [
  "image/jpeg",
  "image/png",
  "image/webp",
]

/** Value of the `accept` attribute of every product-image file input. */
export const ACCEPT_IMAGE = TYPES_IMAGE_ACCEPTES.join(",")

/**
 * Human wording of {@link TYPES_IMAGE_ACCEPTES}. Not derived from the MIME
 * list: "image/webp" would uppercase to "WEBP", and the brand spelling is
 * "WebP".
 */
const LIBELLE_FORMATS_IMAGE = "JPEG, PNG, WebP"

/**
 * Human wording of {@link TAILLE_IMAGE_MAX}, DERIVED from it: raising the cap
 * must never leave a hard-coded "2 Mo" contradicting the actual threshold.
 * A plain space separates the number from the unit, as everywhere else in this
 * repository — no narrow no-break space is written in source here.
 */
export const LIBELLE_TAILLE_IMAGE_MAX = `${new Intl.NumberFormat("fr-FR", {
  maximumFractionDigits: 1,
}).format(TAILLE_IMAGE_MAX / 1024 / 1024)} Mo`

/**
 * Helper sentence shown under every product-image field. Exported so the cap
 * and the accepted formats are spelled out ONCE: the two upload paths render
 * this constant instead of each restating it.
 */
export const AIDE_IMAGE = `${LIBELLE_FORMATS_IMAGE} — ${LIBELLE_TAILLE_IMAGE_MAX} max`

/**
 * Error shown when the file is not one of {@link TYPES_IMAGE_ACCEPTES}.
 * Exported so both upload paths word it identically — sharing the constant is
 * what structurally prevents divergence, not a comment asking for it.
 */
export const ERREUR_TYPE_IMAGE = `Formats acceptés : ${LIBELLE_FORMATS_IMAGE}`

/** Error shown when the prepared file still exceeds {@link TAILLE_IMAGE_MAX}. */
export const ERREUR_TAILLE_IMAGE = `L'image dépasse ${LIBELLE_TAILLE_IMAGE_MAX}`

/**
 * Error shown when {@link preparerImage} throws. Deliberately a fixed French
 * sentence: `err.message` would surface the browser's own English wording
 * ("The source image could not be decoded") in an all-French interface.
 * It states what to do, not merely that something failed.
 */
export const ERREUR_PREPARATION_IMAGE =
  "Impossible de préparer cette image. Réessayez ou choisissez une autre photo."

/**
 * Single pass-through point for a product image before any upload.
 *
 * It currently returns the file unchanged. Client-side compression will be
 * implemented HERE and nowhere else: both upload paths — product creation
 * (`ChampImage`) and product edition (`SectionIdentite`) — already await it,
 * and both validate the MIME type BEFORE calling it and the size AFTER, so a
 * 3 MB phone photo gets a chance to be reduced instead of being rejected on
 * sight.
 *
 * Callers must treat the returned file as a different object from the one they
 * passed in (different size, possibly different MIME type and name) and upload
 * that one.
 *
 * Decisions deliberately left open, to be settled when compression is actually
 * implemented — see "Image produit sur mobile — terrain à préparer en phase 2b"
 * in `docs/superpowers/specs/2026-08-07-spa-responsive-design.md`:
 *
 * 1. **EXIF orientation** — re-encoding through a `<canvas>` drops the EXIF
 *    metadata, so a photo shot in portrait comes out lying down.
 *    `createImageBitmap(fichier, { imageOrientation: "from-image" })` applies
 *    the orientation before drawing; this is pitfall #1 of any client-side
 *    compression.
 * 2. **Output format** — WebP compresses markedly better than JPEG at equal
 *    quality and preserves transparency, which JPEG does not. All three
 *    formats are accepted by the server.
 * 3. **Target dimension and quality** — the image is displayed at 128x128 on
 *    the product page and 40x40 in the list; a 1024 px long edge is already
 *    very generous for that use.
 * 4. **A guarantee, not an attempt** — the server rejects on `content-length`,
 *    so compression must *reach* the target, not merely approach it: plan a
 *    second pass if the first re-encoding still overshoots.
 * 5. **Error message** — if the file still exceeds the limit after
 *    compression, the message must say what to do, not merely state the
 *    failure.
 */
export async function preparerImage(fichier: File): Promise<File> {
  return fichier
}
