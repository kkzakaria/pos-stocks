import type { Context } from "hono"

export type Pagination = { page: number; limite: number }

/**
 * Parses and validates the page/limite query params shared by every paginated
 * list endpoint. Returns { page, limite } when valid, or a 400 VALIDATION
 * Response to return as-is. Defaults: page 1, limite 50. Bounds: page >= 1,
 * 1 <= limite <= 200.
 */
export function lirePagination(c: Context): Pagination | Response {
  const page = Number(c.req.query("page") ?? "1")
  const limite = Number(c.req.query("limite") ?? "50")
  if (
    !Number.isInteger(page) ||
    page < 1 ||
    !Number.isInteger(limite) ||
    limite < 1 ||
    limite > 200
  ) {
    return c.json(
      {
        code: "VALIDATION",
        message: "Pagination invalide (page ≥ 1, limite entre 1 et 200)",
      },
      400
    )
  }
  return { page, limite }
}
