import { describe, it, expect } from "vitest"
import type { Context } from "hono"
import { lirePagination } from "../src/lib/pagination"

// Minimal context: lirePagination only uses c.req.query() and c.json().
function contexteFactice(query: Record<string, string>): Context {
  return {
    req: { query: (cle: string) => query[cle] },
    json: (corps: unknown, statut?: number) =>
      new Response(JSON.stringify(corps), { status: statut ?? 200 }),
  } as unknown as Context
}

describe("lirePagination", () => {
  it("défauts : page 1, limite 50 quand absents", () => {
    expect(lirePagination(contexteFactice({}))).toEqual({ page: 1, limite: 50 })
  })

  it("valeurs explicites valides", () => {
    expect(
      lirePagination(contexteFactice({ page: "3", limite: "20" }))
    ).toEqual({ page: 3, limite: 20 })
  })

  it("page < 1 → Response 400", async () => {
    const r = lirePagination(contexteFactice({ page: "0" }))
    expect(r).toBeInstanceOf(Response)
    expect((r as Response).status).toBe(400)
    expect(await (r as Response).json()).toMatchObject({ code: "VALIDATION" })
  })

  it("limite hors bornes → Response 400", () => {
    expect(lirePagination(contexteFactice({ limite: "0" }))).toBeInstanceOf(
      Response
    )
    expect(lirePagination(contexteFactice({ limite: "201" }))).toBeInstanceOf(
      Response
    )
  })

  it("non-entier → Response 400", () => {
    expect(lirePagination(contexteFactice({ page: "1.5" }))).toBeInstanceOf(
      Response
    )
    expect(lirePagination(contexteFactice({ limite: "abc" }))).toBeInstanceOf(
      Response
    )
  })
})
