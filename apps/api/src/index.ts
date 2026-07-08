import { Hono } from "hono"
import { cors } from "hono/cors"
import type { Env } from "./env"
import { createAuth } from "./lib/auth"
import { setupRoute } from "./routes/setup"

const app = new Hono<{ Bindings: Env }>()

app.use("/api/*", (c, next) =>
  cors({ origin: c.env.WEB_ORIGIN, credentials: true })(c, next)
)

app.get("/api/v1/health", (c) => c.json({ status: "ok" }))

app.on(["GET", "POST"], "/api/auth/*", (c) =>
  createAuth(c.env).handler(c.req.raw)
)

app.route("/api/v1/setup", setupRoute)

export default app
