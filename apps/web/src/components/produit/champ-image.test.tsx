import { describe, it, expect, vi, afterEach } from "vitest"
import { render, screen, fireEvent, act, waitFor } from "@testing-library/react"
import { ChampImage } from "@/components/produit/champ-image"
import {
  AIDE_IMAGE,
  ERREUR_PREPARATION_IMAGE,
  preparerImage,
} from "@/lib/image"
import { jetons } from "@/test/jetons"
import type * as ModuleImage from "@/lib/image"

// The real module is kept (identity implementation, shared constants); only
// `preparerImage` is wrapped in a spy so a test can control WHEN it settles.
vi.mock("@/lib/image", async (importOriginal) => {
  const reel = await importOriginal<typeof ModuleImage>()
  return { ...reel, preparerImage: vi.fn(reel.preparerImage) }
})

// mockReset, not mockClear: `mockClear` only wipes recorded calls and leaves
// any UNCONSUMED `...Once` implementation queued. A test failing before it
// consumes its own would then contaminate the next one with a misleading
// diagnostic. Vitest 3 restores the implementation passed to `vi.fn` on reset,
// so the partial mock through `importOriginal` survives.
afterEach(() => vi.mocked(preparerImage).mockReset())

const fichierJpeg = (octets = 4, nom = "photo.jpg") =>
  new File([new Uint8Array(octets)], nom, { type: "image/jpeg" })

describe("ChampImage", () => {
  it("remonte le fichier choisi et en affiche l'aperçu", async () => {
    const onChange = vi.fn()
    const { rerender } = render(<ChampImage value={null} onChange={onChange} />)

    const entree = screen.getByLabelText("Choisir une image")
    fireEvent.change(entree, { target: { files: [fichierJpeg()] } })
    await waitFor(() => expect(onChange).toHaveBeenCalledTimes(1))
    expect(onChange.mock.calls[0]?.[0]).toBeInstanceOf(File)

    rerender(<ChampImage value={fichierJpeg()} onChange={onChange} />)
    expect(screen.getByAltText("Aperçu de l'image du produit")).toBeTruthy()
  })

  it("refuse un fichier de plus de 2 Mo sans le remonter", async () => {
    const onChange = vi.fn()
    render(<ChampImage value={null} onChange={onChange} />)

    fireEvent.change(screen.getByLabelText("Choisir une image"), {
      target: { files: [fichierJpeg(2 * 1024 * 1024 + 1)] },
    })
    expect((await screen.findByRole("alert")).textContent).toContain("2 Mo")
    expect(onChange).not.toHaveBeenCalled()
  })

  it("valide la taille APRÈS la préparation, pas avant", async () => {
    const onChange = vi.fn()
    // A 3 MB photo reduced under the cap must go through: validating the
    // original size would reject it before it could ever be shrunk.
    vi.mocked(preparerImage).mockResolvedValueOnce(
      fichierJpeg(1024, "reduit.jpg")
    )
    render(<ChampImage value={null} onChange={onChange} />)

    fireEvent.change(screen.getByLabelText("Choisir une image"), {
      target: { files: [fichierJpeg(3 * 1024 * 1024)] },
    })
    await waitFor(() => expect(onChange).toHaveBeenCalledTimes(1))
    expect(onChange.mock.calls[0]?.[0]?.name).toBe("reduit.jpg")
    expect(screen.queryByRole("alert")).toBeNull()
  })

  it("refuse un format non accepté sans le remonter ni le préparer", async () => {
    const onChange = vi.fn()
    render(<ChampImage value={null} onChange={onChange} />)

    const gif = new File([new Uint8Array(4)], "anim.gif", { type: "image/gif" })
    fireEvent.change(screen.getByLabelText("Choisir une image"), {
      target: { files: [gif] },
    })
    expect((await screen.findByRole("alert")).textContent).toContain("JPEG")
    expect(onChange).not.toHaveBeenCalled()
    // The type guard runs BEFORE preparation: an arbitrary file must never
    // reach the future image decoder.
    expect(preparerImage).not.toHaveBeenCalled()
  })

  it("ignore une préparation obsolète : la dernière sélection gagne", async () => {
    const onChange = vi.fn()
    render(<ChampImage value={null} onChange={onChange} />)
    const entree = screen.getByLabelText("Choisir une image")

    let resoudrePremier: (fichier: File) => void = () => undefined
    let resoudreSecond: (fichier: File) => void = () => undefined
    vi.mocked(preparerImage)
      .mockImplementationOnce(
        () => new Promise<File>((resoudre) => (resoudrePremier = resoudre))
      )
      .mockImplementationOnce(
        () => new Promise<File>((resoudre) => (resoudreSecond = resoudre))
      )

    fireEvent.change(entree, {
      target: { files: [fichierJpeg(4, "premier.jpg")] },
    })
    fireEvent.change(entree, {
      target: { files: [fichierJpeg(4, "second.jpg")] },
    })
    expect(preparerImage).toHaveBeenCalledTimes(2)

    // The SECOND preparation settles first, the first one after: nothing
    // guarantees the order two in-flight preparations come back in.
    await act(async () => {
      resoudreSecond(fichierJpeg(4, "second.jpg"))
    })
    await act(async () => {
      resoudrePremier(fichierJpeg(4, "premier.jpg"))
    })

    // Without a generation token the stale first file would overwrite the
    // second one, and the parent would silently hold the wrong file.
    expect(onChange).toHaveBeenCalledTimes(1)
    expect(onChange.mock.calls[0]?.[0]?.name).toBe("second.jpg")
  })

  it("un retrait pendant la préparation ne ressuscite pas le fichier", async () => {
    const onChange = vi.fn()
    let resoudre: (fichier: File) => void = () => undefined
    vi.mocked(preparerImage).mockImplementationOnce(
      () => new Promise<File>((r) => (resoudre = r))
    )
    // Non-null `value`: "Retirer l'image" is only rendered in that case.
    render(
      <ChampImage value={fichierJpeg(4, "ancien.jpg")} onChange={onChange} />
    )

    fireEvent.change(screen.getByLabelText("Choisir une image"), {
      target: { files: [fichierJpeg(4, "nouveau.jpg")] },
    })
    fireEvent.click(screen.getByRole("button", { name: "Retirer l'image" }))
    expect(onChange).toHaveBeenCalledTimes(1)
    expect(onChange).toHaveBeenCalledWith(null)

    await act(async () => {
      resoudre(fichierJpeg(4, "nouveau.jpg"))
    })

    // Without the token increment in "Retirer l'image", the in-flight
    // preparation would report back the file the user just discarded.
    expect(onChange).toHaveBeenCalledTimes(1)
  })

  it("un échec de préparation affiche un message français et libère le champ", async () => {
    const onChange = vi.fn()
    vi.mocked(preparerImage).mockRejectedValueOnce(
      new Error("The source image could not be decoded")
    )
    render(<ChampImage value={null} onChange={onChange} />)
    const entree = screen.getByLabelText("Choisir une image")

    fireEvent.change(entree, { target: { files: [fichierJpeg()] } })

    // Fixed French message: never `err.message`, which comes from the browser
    // in English.
    expect((await screen.findByRole("alert")).textContent).toBe(
      ERREUR_PREPARATION_IMAGE
    )
    expect(entree.getAttribute("aria-busy")).toBe("false")
    expect(screen.getByText("Choisir une image")).toBeTruthy()
    expect(onChange).not.toHaveBeenCalled()
  })

  it("un refus de type pendant une préparation ne bloque pas le champ", async () => {
    const onChange = vi.fn()
    // Preparation that never settles: the first selection stays in flight.
    vi.mocked(preparerImage).mockImplementationOnce(
      () => new Promise<File>(() => undefined)
    )
    const { container } = render(
      <ChampImage value={null} onChange={onChange} />
    )
    const entree = screen.getByLabelText("Choisir une image")

    fireEvent.change(entree, {
      target: { files: [fichierJpeg(4, "lourde.jpg")] },
    })
    expect(screen.getByText("Préparation…")).toBeTruthy()

    const gif = new File([new Uint8Array(4)], "anim.gif", { type: "image/gif" })
    fireEvent.change(entree, { target: { files: [gif] } })

    expect((await screen.findByRole("alert")).textContent).toContain("JPEG")
    // The type refusal incremented the token: preparation #1 will exit through
    // its `obsolete()` guard BEFORE its own setEnPreparation(false). If the
    // refusal branch does not release the pending state, nobody owns it any
    // more — the label stays disabled forever, with no way out on mobile.
    expect(entree.getAttribute("aria-busy")).toBe("false")
    expect(screen.getByText("Choisir une image")).toBeTruthy()
    // Exact token comparison: the button variants already carry
    // `disabled:pointer-events-none` and `[&_svg]:pointer-events-none`, which a
    // substring search would confuse with the disabling class.
    const classes = jetons(container.querySelector("label[for='p-image']"))
    expect(classes).not.toContain("pointer-events-none")
    expect(classes).not.toContain("opacity-50")
  })

  it("affiche la phrase d'aide partagée, plafond compris", () => {
    render(<ChampImage value={null} onChange={vi.fn()} />)

    // Rendered from the constant: raising the cap to 5 MB cannot leave a
    // hard-coded "2 Mo" behind in the component.
    expect(screen.getByText(AIDE_IMAGE)).toBeTruthy()
  })

  it("signale l'attente pendant la préparation", async () => {
    let resoudre: (fichier: File) => void = () => undefined
    vi.mocked(preparerImage).mockImplementationOnce(
      () => new Promise<File>((r) => (resoudre = r))
    )
    render(<ChampImage value={null} onChange={vi.fn()} />)
    const entree = screen.getByLabelText("Choisir une image")

    fireEvent.change(entree, { target: { files: [fichierJpeg()] } })
    expect(screen.getByText("Préparation…")).toBeTruthy()
    expect(entree.getAttribute("aria-busy")).toBe("true")

    await act(async () => {
      resoudre(fichierJpeg())
    })
    expect(screen.getByText("Choisir une image")).toBeTruthy()
    expect(entree.getAttribute("aria-busy")).toBe("false")
  })

  it("révoque l'URL de l'aperçu au démontage", () => {
    const revoquer = vi.spyOn(URL, "revokeObjectURL")
    const { unmount } = render(
      <ChampImage value={fichierJpeg()} onChange={vi.fn()} />
    )
    unmount()
    expect(revoquer).toHaveBeenCalled()
    revoquer.mockRestore()
  })

  it("permet de retirer l'image choisie", () => {
    const onChange = vi.fn()
    render(<ChampImage value={fichierJpeg()} onChange={onChange} />)

    fireEvent.click(screen.getByRole("button", { name: "Retirer l'image" }))
    expect(onChange).toHaveBeenCalledWith(null)
  })

  it("affiche le focus clavier sur le label via le motif peer", () => {
    const { container } = render(<ChampImage value={null} onChange={vi.fn()} />)

    const input = screen.getByLabelText("Choisir une image")
    const label = container.querySelector("label[for='p-image']")

    // Tailwind's peer-focus-visible: compiles to a general sibling combinator
    // (.peer:focus-visible ~ .target): it only works if the label is an
    // actual sibling of the input, not merely a class-name match. Assert the
    // real DOM relationship, not just the presence of the class strings.
    expect(input.nextElementSibling).toBe(label)

    // Verify that the input has the peer class so the selector can work
    expect(input.className).toContain("peer")

    // Verify that the label has the peer-focus-visible classes to display
    // the ring when the input is focused, making keyboard navigation visible
    expect(label).toBeTruthy()
    expect(label?.className).toContain("peer-focus-visible:ring-2")
    expect(label?.className).toContain("peer-focus-visible:ring-ring/30")
  })

  it("accepte un id personnalisé pour cohabiter avec un autre champ image", () => {
    render(<ChampImage id="v-image" value={null} onChange={vi.fn()} />)

    const input = screen.getByLabelText("Choisir une image")
    expect(input.getAttribute("id")).toBe("v-image")
  })
})
