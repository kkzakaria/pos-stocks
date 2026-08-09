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
    // Déterministe, contrairement à `not.toHaveBeenCalledWith` sur apiFetch :
    // le refus de type est synchrone, donc `findByRole` peut résoudre sans
    // rien prouver de la suite asynchrone. La garde d'entrée, elle, interdit
    // qu'un fichier arbitraire atteigne le futur décodeur d'image.
    expect(preparerImage).not.toHaveBeenCalled()
    expect(apiFetch).not.toHaveBeenCalledWith(
      "/api/v1/products/p1/image",
      expect.anything()
    )
  })

  it("édition : un refus de type pendant une préparation ne bloque pas le champ", async () => {
    // Préparation qui ne se résout jamais : la première sélection reste en vol.
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
    // Le jeton vient d'être incrémenté : la préparation n°1 sortira par sa
    // garde `obsolete()` AVANT son propre setPreparationImage(false). Sans
    // libération dans la branche de refus, l'attente reste à true à vie.
    expect(entree.getAttribute("aria-busy")).toBe("false")
    // Comparaison par jeton exact : les variantes du bouton portent déjà
    // `disabled:pointer-events-none`, qu'une recherche de sous-chaîne
    // confondrait avec la classe de neutralisation.
    const classes =
      container
        .querySelector("label[for='id-image']")
        ?.className.split(/\s+/) ?? []
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

    // Démonter le bloc image n'annule rien : sans incrément du jeton dans
    // « Annuler », l'image serait écrite sur le produit alors que
    // l'utilisateur a explicitement annulé, et sans aucun retour visible.
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

    // `ouvrir` réinitialisait l'erreur générale mais pas celle de l'image :
    // le refus d'une session précédente réapparaissait tel quel.
    expect(screen.queryByRole("alert")).toBeNull()
  })

  it("édition : focus clavier visible sur le label via le motif peer", () => {
    const { container } = rendre()
    fireEvent.click(screen.getByRole("button", { name: "Modifier" }))

    const entree = screen.getByLabelText("Choisir une image")
    const label = container.querySelector("label[for='id-image']")

    // peer-focus-visible: compile vers un combinateur de frères généraux
    // (.peer:focus-visible ~ .cible) : sans relation de fratrie réelle, la
    // règle ne s'applique jamais — et l'échec est silencieux.
    expect(entree.nextElementSibling).toBe(label)
    expect(entree.className).toContain("peer")
    expect(label?.className).toContain("peer-focus-visible:ring-2")
    expect(label?.className).toContain("peer-focus-visible:ring-ring/30")
  })

  it("édition : affiche la phrase d'aide partagée, plafond compris", () => {
    rendre()
    fireEvent.click(screen.getByRole("button", { name: "Modifier" }))

    // Rendue depuis la constante : les deux chemins d'envoi ne peuvent pas
    // annoncer deux plafonds différents.
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
