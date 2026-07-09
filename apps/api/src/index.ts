import { Hono } from "hono"
import { cors } from "hono/cors"
import type { Env } from "./env"
import { createAuth } from "./lib/auth"
import { setupRoute } from "./routes/setup"
import { meRoute } from "./routes/me"

const app = new Hono<{ Bindings: Env }>()

app.onError((err, c) => {
  console.error(err)
  return c.json(
    { code: "ERREUR_INTERNE", message: "Une erreur interne est survenue" },
    500
  )
})

app.use("/api/*", (c, next) => {
  if (!c.env.WEB_ORIGIN) {
    throw new Error("Variable WEB_ORIGIN manquante")
  }
  return cors({ origin: c.env.WEB_ORIGIN, credentials: true })(c, next)
})

app.get("/api/v1/health", (c) => c.json({ status: "ok" }))

app.on(["GET", "POST"], "/api/auth/*", (c) =>
  createAuth(c.env).handler(c.req.raw)
)

app.route("/api/v1/setup", setupRoute)

app.route("/api/v1/me", meRoute)

export default app
