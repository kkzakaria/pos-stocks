import { describe, it, expect, vi, afterEach } from "vitest"
import { render, screen, fireEvent, act, waitFor } from "@testing-library/react"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { SectionIdentite } from "@/components/produit/section-identite"
import { apiFetch } from "@/lib/api"
import {
  AIDE_IMAGE,
  ERREUR_PREPARATION_IMAGE,
  preparerImage,
} from "@/lib/image"
import { jetons } from "@/test/jetons"
import type * as ModuleImage from "@/lib/image"
import type { Produit } from "@/components/produit/types"

vi.mock("@/lib/api", () => ({
  apiFetch: vi.fn((url: string) =>
    url === "/api/v1/categories"
      ? Promise.resolve({ categories: [{ id: "c1", name: "Outillage" }] })
      : Promise.resolve({})
  ),
  apiUrl: (chemin: string) => chemin,
}))

// The real module is kept (identity implementation, shared constants); only
// `preparerImage` is wrapped in a spy, so this path can assert that the type
// guard runs BEFORE preparation and can control WHEN preparation settles.
vi.mock("@/lib/image", async (importOriginal) => {
  const reel = await importOriginal<typeof ModuleImage>()
  return { ...reel, preparerImage: vi.fn(reel.preparerImage) }
})

afterEach(() => {
  vi.clearAllMocks()
  // clearAllMocks only wipes recorded calls: an unconsumed `...Once` would
  // leak into the next test. Reset restores the implementation given to vi.fn.
  vi.mocked(preparerImage).mockReset()
})

const fichierJpeg = (octets = 8, nom = "photo.jpg") =>
  new File([new Uint8Array(octets)], nom, { type: "image/jpeg" })

const produit: Produit = {
  id: "p1",
  name: "Article",
  sku: "PRD-1",
  description: "Une description",
  categoryId: "c1",
  barcode: "123456",
  price: 5000,
  minPrice: null,
  defaultMinStock: null,
  hasVariants: false,
  isActive: true,
  trackLots: false,
  imageKey: null,
  variants: [],
}

function rendre(
  surcharges: Partial<Parameters<typeof SectionIdentite>[0]> = {}
) {
  return render(
    <QueryClientProvider client={new QueryClient()}>
      <SectionIdentite
        produit={produit}
        productId="p1"
        peutEcrire
        onModifie={() => Promise.resolve()}
        {...surcharges}
      />
    </QueryClientProvider>
  )
}

describe("SectionIdentite", () => {
  it("affiche catégorie, code-barres et description en lecture", async () => {
    rendre()
    expect(await screen.findByText("Outillage")).toBeTruthy()
    expect(screen.getByText("123456")).toBeTruthy()
    expect(screen.getByText("Une description")).toBeTruthy()
  })

  it("lecture : une valeur longue et insécable porte la classe qui la coupe", async () => {
    const codeBarres = "01234567890123456789012345678901234567890123456789"
    rendre({ produit: { ...produit, barcode: codeBarres } })

    // Category name, barcode and description are free user text. A 50-digit
    // barcode pushed the document to 430 px at a 375 px viewport. The row is a
    // COLUMN flex container, so the box already stretches to the full width
    // and only the inline text spilled: `break-words` alone is the fix — no
    // `min-w-0`, which would be cargo cult here.
    //
    // jsdom has neither layout engine nor CSS cascade: no stylesheet is loaded,
    // so `getComputedStyle` never resolves a Tailwind utility and
    // offsetWidth/scrollWidth are constantly 0. This case therefore guards only
    // that the class is PRESENT on the right nodes — that it actually stops the
    // overflow is measured in the end-of-branch browser check.
    expect(jetons(screen.getByText(codeBarres))).toContain("break-words")
    // Same class on every value, not just the one under test.
    expect(jetons(await screen.findByText("Outillage"))).toContain(
      "break-words"
    )
  })

  it("sans écriture : ni Modifier ni upload d'image", () => {
    rendre({ peutEcrire: false })
    expect(screen.queryByRole("button", { name: "Modifier" })).toBeNull()
    expect(screen.queryByText(/Choisir une image/)).toBeNull()
  })

  it("Annuler restaure l'affichage sans PATCH", async () => {
    rendre()
    fireEvent.click(screen.getByRole("button", { name: "Modifier" }))
    fireEvent.click(screen.getByRole("button", { name: "Annuler" }))
    expect(apiFetch).not.toHaveBeenCalledWith(
      "/api/v1/products/p1",
      expect.objectContaining({ method: "PATCH" })
    )
    expect(await screen.findByRole("button", { name: "Modifier" })).toBeTruthy()
  })

  it("édition : refuse un fichier de plus de 2 Mo sans requête réseau", async () => {
    rendre()
    fireEvent.click(screen.getByRole("button", { name: "Modifier" }))

    fireEvent.change(screen.getByLabelText("Choisir une image"), {
      target: {
        files: [
          new File([new Uint8Array(2 * 1024 * 1024 + 1)], "photo.jpg", {
            type: "image/jpeg",
          }),
        ],
      },
    })

    expect((await screen.findByRole("alert")).textContent).toContain("2 Mo")
    expect(apiFetch).not.toHaveBeenCalledWith(
      "/api/v1/products/p1/image",
      expect.anything()
    )
  })

  it("édition : refuse un format non accepté sans requête réseau", async () => {
    rendre()
    fireEvent.click(screen.getByRole("button", { name: "Modifier" }))

    fireEvent.change(screen.getByLabelText("Choisir une image"), {
      target: {
        files: [
          new File([new Uint8Array(4)], "anim.gif", { type: "image/gif" }),
        ],
      },
    })

    expect((await screen.findByRole("alert")).textContent).toContain("JPEG")
    // Deterministic, unlike `not.toHaveBeenCalledWith` on apiFetch: the type
    // refusal is synchronous, so `findByRole` can resolve without proving
    // anything about the asynchronous continuation. The entry guard, on the
    // other hand, forbids an arbitrary file from reaching the future image
    // decoder.
    expect(preparerImage).not.toHaveBeenCalled()
    expect(apiFetch).not.toHaveBeenCalledWith(
      "/api/v1/products/p1/image",
      expect.anything()
    )
  })

  it("édition : un refus de type pendant une préparation ne bloque pas le champ", async () => {
    // A preparation that never settles: the first selection stays in flight.
    vi.mocked(preparerImage).mockImplementationOnce(
      () => new Promise<File>(() => undefined)
    )
    const { container } = rendre()
    fireEvent.click(screen.getByRole("button", { name: "Modifier" }))
    const entree = screen.getByLabelText("Choisir une image")

    fireEvent.change(entree, {
      target: { files: [fichierJpeg(8, "lourde.jpg")] },
    })
    expect(screen.getByText("Préparation…")).toBeTruthy()

    fireEvent.change(entree, {
      target: {
        files: [
          new File([new Uint8Array(4)], "anim.gif", { type: "image/gif" }),
        ],
      },
    })

    expect((await screen.findByRole("alert")).textContent).toContain("JPEG")
    // The token has just been incremented: preparation #1 will exit through its
    // `obsolete()` guard BEFORE its own setPreparationImage(false). Without a
    // release in the refusal branch, the pending state stays true forever.
    expect(entree.getAttribute("aria-busy")).toBe("false")
    // Exact-token comparison: the button variants already carry
    // `disabled:pointer-events-none`, which a substring search would confuse
    // with the neutralisation class.
    const classes = jetons(container.querySelector("label[for='id-image']"))
    expect(classes).not.toContain("pointer-events-none")
    expect(classes).not.toContain("opacity-50")
  })

  it("édition : un échec de préparation affiche un message français sans requête réseau", async () => {
    vi.mocked(preparerImage).mockRejectedValueOnce(
      new Error("The source image could not be decoded")
    )
    rendre()
    fireEvent.click(screen.getByRole("button", { name: "Modifier" }))
    const entree = screen.getByLabelText("Choisir une image")

    fireEvent.change(entree, { target: { files: [fichierJpeg()] } })

    expect((await screen.findByRole("alert")).textContent).toBe(
      ERREUR_PREPARATION_IMAGE
    )
    expect(entree.getAttribute("aria-busy")).toBe("false")
    expect(apiFetch).not.toHaveBeenCalledWith(
      "/api/v1/products/p1/image",
      expect.anything()
    )
  })

  it("édition : Annuler pendant une préparation empêche l'envoi", async () => {
    let resoudre: (fichier: File) => void = () => undefined
    vi.mocked(preparerImage).mockImplementationOnce(
      () => new Promise<File>((r) => (resoudre = r))
    )
    rendre()
    fireEvent.click(screen.getByRole("button", { name: "Modifier" }))

    fireEvent.change(screen.getByLabelText("Choisir une image"), {
      target: { files: [fichierJpeg()] },
    })
    fireEvent.click(screen.getByRole("button", { name: "Annuler" }))

    await act(async () => {
      resoudre(fichierJpeg())
    })

    // Unmounting the image block cancels nothing: without incrementing the
    // token in "Annuler", the image would be written to the product even though
    // the user explicitly cancelled, and with no visible feedback.
    expect(apiFetch).not.toHaveBeenCalledWith(
      "/api/v1/products/p1/image",
      expect.anything()
    )
  })

  it("édition : rouvrir le formulaire efface l'erreur d'image précédente", async () => {
    rendre()
    fireEvent.click(screen.getByRole("button", { name: "Modifier" }))
    fireEvent.change(screen.getByLabelText("Choisir une image"), {
      target: {
        files: [
          new File([new Uint8Array(4)], "anim.gif", { type: "image/gif" }),
        ],
      },
    })
    expect((await screen.findByRole("alert")).textContent).toContain("JPEG")

    fireEvent.click(screen.getByRole("button", { name: "Annuler" }))
    fireEvent.click(screen.getByRole("button", { name: "Modifier" }))

    // `ouvrir` used to reset the general error but not the image one: the
    // refusal from a previous session reappeared as-is.
    expect(screen.queryByRole("alert")).toBeNull()
  })

  it("édition : focus clavier visible sur le label via le motif peer", () => {
    const { container } = rendre()
    fireEvent.click(screen.getByRole("button", { name: "Modifier" }))

    const entree = screen.getByLabelText("Choisir une image")
    const label = container.querySelector("label[for='id-image']")

    // peer-focus-visible: compiles to a general sibling combinator
    // (.peer:focus-visible ~ .target): without a real sibling relationship the
    // rule never applies — and the failure is silent.
    expect(entree.nextElementSibling).toBe(label)
    expect(entree.className).toContain("peer")
    expect(label?.className).toContain("peer-focus-visible:ring-2")
    expect(label?.className).toContain("peer-focus-visible:ring-ring/30")
  })

  it("édition : affiche la phrase d'aide partagée, plafond compris", () => {
    rendre()
    fireEvent.click(screen.getByRole("button", { name: "Modifier" }))

    // Rendered from the constant: the two upload paths cannot announce two
    // different caps.
    expect(screen.getByText(AIDE_IMAGE)).toBeTruthy()
  })

  it("édition : envoie l'image préparée quand elle est valide", async () => {
    rendre()
    fireEvent.click(screen.getByRole("button", { name: "Modifier" }))

    fireEvent.change(screen.getByLabelText("Choisir une image"), {
      target: {
        files: [
          new File([new Uint8Array(8)], "photo.jpg", { type: "image/jpeg" }),
        ],
      },
    })

    await waitFor(() =>
      expect(apiFetch).toHaveBeenCalledWith(
        "/api/v1/products/p1/image",
        expect.objectContaining({ method: "POST" })
      )
    )
  })

  it("édition : PATCH partiel avec champs vides normalisés à null", async () => {
    const onModifie = vi.fn(() => Promise.resolve())
    rendre({ onModifie })
    fireEvent.click(screen.getByRole("button", { name: "Modifier" }))
    fireEvent.change(screen.getByLabelText("Code-barres"), {
      target: { value: "" },
    })
    fireEvent.click(screen.getByRole("button", { name: "Enregistrer" }))
    await waitFor(() => expect(onModifie).toHaveBeenCalled())
    expect(apiFetch).toHaveBeenCalledWith(
      "/api/v1/products/p1",
      expect.objectContaining({
        method: "PATCH",
        body: JSON.stringify({
          name: "Article",
          description: "Une description",
          categoryId: "c1",
          barcode: null,
          isActive: true,
        }),
      })
    )
  })
})
