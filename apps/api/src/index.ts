import { Hono } from "hono"
import { cors } from "hono/cors"
import type { Env } from "./env"

const app = new Hono<{ Bindings: Env }>()

app.use("/api/*", (c, next) =>
  cors({ origin: c.env.WEB_ORIGIN, credentials: true })(c, next)
)

app.get("/api/v1/health", (c) => c.json({ status: "ok" }))

export default app
