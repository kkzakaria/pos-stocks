import { describe, test, expect } from "bun:test"
import sharp from "sharp"
import { convertirEnWebp } from "./image"

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
