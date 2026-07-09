import { Hono } from "hono"
import { drizzle } from "drizzle-orm/d1"
import { and, asc, eq, ne } from "drizzle-orm"
import { userCreateSchema, userRoleSchema, userStatusSchema } from "shared"
import type { CompanyRole } from "shared"
import * as schema from "../db/schema"
import { createAuth } from "../lib/auth"
import { generateProvisionalPassword } from "../lib/provisional-password"
import { requireAuth } from "../middleware/require-auth"
import { requireMembership, requireRole } from "../middleware/permissions"
import type { PermissionVariables } from "../middleware/permissions"
import type { Env } from "../env"

export const usersRoute = new Hono<{
  Bindings: Env
  Variables: PermissionVariables
}>()

usersRoute.use(requireAuth, requireMembership)

// Rôles qu'un admin (non owner) a le droit de voir modifiés/attribués
const ROLES_GERABLES_PAR_ADMIN: CompanyRole[] = [
  "auditor",
  "stock_manager",
  "staff",
]

usersRoute.post("/", requireRole("owner", "admin"), async (c) => {
  const parsed = userCreateSchema.safeParse(
    await c.req.json().catch(() => null)
  )
  if (!parsed.success) {
    return c.json(
      {
        code: "VALIDATION",
        message: "Données invalides",
        details: parsed.error.flatten(),
      },
      400
    )
  }
  const demandeur = c.get("membership")
  const roleCible = parsed.data.role as CompanyRole
  if (
    demandeur.role !== "owner" &&
    !ROLES_GERABLES_PAR_ADMIN.includes(roleCible)
  ) {
    return c.json(
      {
        code: "ACCES_REFUSE",
        message: "Seul le propriétaire peut créer ce rôle",
      },
      403
    )
  }

  const db = drizzle(c.env.DB, { schema })
  const existant = await db
    .select({ id: schema.user.id })
    .from(schema.user)
    .where(eq(schema.user.email, parsed.data.email))
    .limit(1)
  if (existant.length > 0) {
    return c.json(
      {
        code: "EMAIL_EXISTANT",
        message: "Un compte existe déjà avec cet email",
      },
      409
    )
  }

  const provisionalPassword = generateProvisionalPassword()
  const auth = createAuth(c.env)
  // Le hook sign-up n'autorise la création que munie du jeton interne (SETUP_TOKEN)
  const signUp = await auth.api.signUpEmail({
    body: {
      email: parsed.data.email,
      password: provisionalPassword,
      name: parsed.data.name,
    },
    headers: new Headers({ "x-setup-token": c.env.SETUP_TOKEN }),
  })

  await db.batch([
    db
      .update(schema.user)
      .set({ mustChangePassword: true })
      .where(eq(schema.user.id, signUp.user.id)),
    db.insert(schema.member).values({
      id: crypto.randomUUID(),
      organizationId: demandeur.organizationId,
      userId: signUp.user.id,
      role: roleCible,
      createdAt: new Date(),
    }),
  ])

  return c.json({ userId: signUp.user.id, provisionalPassword }, 201)
})

usersRoute.get("/", requireRole("owner", "admin", "auditor"), async (c) => {
  const db = drizzle(c.env.DB, { schema })
  const organizationId = c.get("membership").organizationId
  const rows = await db
    .select({
      id: schema.user.id,
      name: schema.user.name,
      email: schema.user.email,
      isActive: schema.user.isActive,
      role: schema.member.role,
    })
    .from(schema.member)
    .innerJoin(schema.user, eq(schema.member.userId, schema.user.id))
    .where(eq(schema.member.organizationId, organizationId))
    .orderBy(asc(schema.user.name))

  const affectations = await db
    .select({
      userId: schema.warehouseMembers.userId,
      warehouseId: schema.warehouseMembers.warehouseId,
      warehouseName: schema.warehouses.name,
      role: schema.warehouseMembers.role,
    })
    .from(schema.warehouseMembers)
    .innerJoin(
      schema.warehouses,
      eq(schema.warehouseMembers.warehouseId, schema.warehouses.id)
    )
    .where(eq(schema.warehouseMembers.organizationId, organizationId))

  const users = rows.map((u) => ({
    ...u,
    assignments: affectations
      .filter((a) => a.userId === u.id)
      .map(({ warehouseId, warehouseName, role }) => ({
        warehouseId,
        warehouseName,
        role,
      })),
  }))
  return c.json({ users })
})

// Note : le typage du helper avec un `Context` générique posait problème au
// typecheck (cf. brief) ; on prend directement `env` + `organizationId`.
// Retour explicitement nullable : sans cette annotation, TS élide le membre
// `| null` (indexation de tableau non-stricte) et déclenche
// `no-unnecessary-condition` côté appelants sur `if (!cible)`.
async function membershipCible(
  env: Env,
  organizationId: string,
  userId: string
): Promise<{ id: string; role: string } | null> {
  const db = drizzle(env.DB, { schema })
  const rows = await db
    .select({ id: schema.member.id, role: schema.member.role })
    .from(schema.member)
    .where(
      and(
        eq(schema.member.userId, userId),
        eq(schema.member.organizationId, organizationId)
      )
    )
    .limit(1)
  return rows[0] ?? null
}

usersRoute.patch("/:id/role", requireRole("owner", "admin"), async (c) => {
  const parsed = userRoleSchema.safeParse(await c.req.json().catch(() => null))
  if (!parsed.success) {
    return c.json(
      {
        code: "VALIDATION",
        message: "Données invalides",
        details: parsed.error.flatten(),
      },
      400
    )
  }
  const cibleId = c.req.param("id")
  const demandeur = c.get("membership")
  const cible = await membershipCible(c.env, demandeur.organizationId, cibleId)
  if (!cible)
    return c.json(
      { code: "INTROUVABLE", message: "Utilisateur introuvable" },
      404
    )

  const nouveauRole = parsed.data.role
  if (demandeur.role !== "owner") {
    const cibleGerable = ROLES_GERABLES_PAR_ADMIN.includes(
      cible.role as CompanyRole
    )
    const roleGerable = ROLES_GERABLES_PAR_ADMIN.includes(nouveauRole)
    if (!cibleGerable || !roleGerable) {
      return c.json({ code: "ACCES_REFUSE", message: "Accès refusé" }, 403)
    }
  }

  const db = drizzle(c.env.DB, { schema })
  if (cible.role === "owner" && nouveauRole !== "owner") {
    const autresOwners = await db
      .select({ id: schema.member.id })
      .from(schema.member)
      .where(
        and(
          eq(schema.member.organizationId, demandeur.organizationId),
          eq(schema.member.role, "owner"),
          ne(schema.member.userId, cibleId)
        )
      )
    if (autresOwners.length === 0) {
      return c.json(
        {
          code: "DERNIER_OWNER",
          message: "Impossible de rétrograder le dernier propriétaire",
        },
        409
      )
    }
  }

  await db
    .update(schema.member)
    .set({ role: nouveauRole })
    .where(eq(schema.member.id, cible.id))
  return c.json({ ok: true })
})

usersRoute.patch("/:id/statut", requireRole("owner", "admin"), async (c) => {
  const parsed = userStatusSchema.safeParse(
    await c.req.json().catch(() => null)
  )
  if (!parsed.success) {
    return c.json(
      {
        code: "VALIDATION",
        message: "Données invalides",
        details: parsed.error.flatten(),
      },
      400
    )
  }
  const cibleId = c.req.param("id")
  if (cibleId === c.get("user").id) {
    return c.json(
      {
        code: "AUTO_DESACTIVATION",
        message: "Impossible de désactiver son propre compte",
      },
      400
    )
  }
  const demandeur = c.get("membership")
  const cible = await membershipCible(c.env, demandeur.organizationId, cibleId)
  if (!cible)
    return c.json(
      { code: "INTROUVABLE", message: "Utilisateur introuvable" },
      404
    )
  if (
    demandeur.role !== "owner" &&
    !ROLES_GERABLES_PAR_ADMIN.includes(cible.role as CompanyRole)
  ) {
    return c.json({ code: "ACCES_REFUSE", message: "Accès refusé" }, 403)
  }

  const db = drizzle(c.env.DB, { schema })
  const updateStatut = db
    .update(schema.user)
    .set({ isActive: parsed.data.isActive })
    .where(eq(schema.user.id, cibleId))
  if (parsed.data.isActive) {
    await updateStatut
  } else {
    await db.batch([
      updateStatut,
      db.delete(schema.session).where(eq(schema.session.userId, cibleId)),
    ])
  }
  return c.json({ ok: true })
})
