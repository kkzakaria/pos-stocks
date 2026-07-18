import { describe, test, expect } from "bun:test"
import sharp from "sharp"
import { convertirEnWebp, telechargerEtConvertir } from "./image"

describe("convertirEnWebp", () => {
  test("convertit une image PNG en buffer WebP valide", async () => {
    const pngSource = await sharp({
      create: {
        width: 4,
        height: 4,
        channels: 3,
        background: { r: 200, g: 50, b: 10 },
      },
    })
      .png()
      .toBuffer()

    const webp = await convertirEnWebp(pngSource)

    expect(webp.subarray(0, 4).toString("ascii")).toBe("RIFF")
    expect(webp.subarray(8, 12).toString("ascii")).toBe("WEBP")
  })

  test("rejette un buffer qui n'est pas une image", async () => {
    await expect(
      convertirEnWebp(Buffer.from("pas une image"))
    ).rejects.toThrow()
  })
})

describe("telechargerEtConvertir", () => {
  test(
    "retourne null si la connexion échoue",
    async () => {
      const result = await telechargerEtConvertir(
        "http://this-domain-does-not-exist-xyz123.invalid/nope.avif",
        "test-network-failure"
      )
      expect(result).toBeNull()
    },
    { timeout: 15000 }
  )

  test("retourne null si le serveur répond avec un statut non-2xx", async () => {
    const server = Bun.serve({
      port: 0,
      fetch() {
        return new Response("Not Found", { status: 404 })
      },
    })

    try {
      const result = await telechargerEtConvertir(
        `http://localhost:${server.port}/test.avif`,
        "test-404"
      )
      expect(result).toBeNull()
    } finally {
      server.stop()
    }
  })

  test("télécharge, convertit et retourne une ImageTelechargee valide", async () => {
    const pngBuffer = await sharp({
      create: {
        width: 8,
        height: 8,
        channels: 3,
        background: { r: 100, g: 150, b: 200 },
      },
    })
      .png()
      .toBuffer()

    const server = Bun.serve({
      port: 0,
      fetch() {
        return new Response(pngBuffer, {
          headers: { "content-type": "image/png" },
        })
      },
    })

    try {
      const result = await telechargerEtConvertir(
        `http://localhost:${server.port}/test.png`,
        "test-success"
      )

      expect(result).not.toBeNull()
      expect(result?.contentType).toBe("image/webp")
      expect(result?.nomFichier).toBe("test-success.webp")
      expect(result?.buffer.subarray(0, 4).toString("ascii")).toBe("RIFF")
      expect(result?.buffer.subarray(8, 12).toString("ascii")).toBe("WEBP")
    } finally {
      server.stop()
    }
  })
})
