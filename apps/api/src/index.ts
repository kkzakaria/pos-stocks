import { Hono } from "hono"
import { cors } from "hono/cors"
import type { Env } from "./env"
import { createAuth } from "./lib/auth"
import { setupRoute } from "./routes/setup"
import { meRoute } from "./routes/me"
import { warehousesRoute } from "./routes/warehouses"
import { usersRoute } from "./routes/users"
import { warehouseMembersRoute } from "./routes/warehouse-members"
import { organizationRoute } from "./routes/organization"
import { monCompteRoute } from "./routes/mon-compte"
import { categoriesRoute } from "./routes/categories"
import { suppliersRoute } from "./routes/suppliers"
import { productsRoute } from "./routes/products"
import { variantsRoute } from "./routes/variants"
import { filesRoute } from "./routes/files"
import { stockRoute } from "./routes/stock"
import { purchasesRoute } from "./routes/purchases"
import { transfersRoute } from "./routes/transfers"
import { inventoryCountsRoute } from "./routes/inventory-counts"
import { registerSessionsRoute } from "./routes/register-sessions"

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

app.route("/api/v1/warehouses", warehousesRoute)

app.route("/api/v1/users", usersRoute)

app.route("/api/v1/warehouse-members", warehouseMembersRoute)

app.route("/api/v1/organization", organizationRoute)

app.route("/api/v1/mon-compte", monCompteRoute)

app.route("/api/v1/categories", categoriesRoute)

app.route("/api/v1/suppliers", suppliersRoute)

app.route("/api/v1/products", productsRoute)

app.route("/api/v1/variants", variantsRoute)

app.route("/api/v1/files", filesRoute)

app.route("/api/v1/stock", stockRoute)

app.route("/api/v1/purchases", purchasesRoute)

app.route("/api/v1/transfers", transfersRoute)

app.route("/api/v1/inventory-counts", inventoryCountsRoute)

app.route("/api/v1/register-sessions", registerSessionsRoute)

export default app
