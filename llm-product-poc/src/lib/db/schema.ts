import { relations, sql } from "drizzle-orm";
import {
  pgTable,
  text,
  timestamp,
  boolean,
  jsonb,
  pgEnum,
  uniqueIndex,
  index,
  primaryKey,
  numeric,
  integer,
} from "drizzle-orm/pg-core";

// --- Enums -----------------------------------------------------------------

export const serviceStatus = pgEnum("service_status", [
  "na",
  "aiReview",
  "platformReview",
  "provisioning",
  "working",
  "rejected",
]);

export const changeRequestStatus = pgEnum("change_request_status", [
  "submitted",
  // Per-step workflow values — the CR moves through these as the orchestrator runs.
  "policy_gate_passed",
  "policy_gate_rejected",
  "ai_validation_passed",
  "ai_validation_rejected",
  "ai_artifacts_generated",
  "platform_reviewing",
  // Legacy values kept for back-compat with existing rows (orchestrator no longer writes them).
  "aiReviewing",
  "needsChanges",
  "platformReviewing",
  "approved",
  "rejected",
  "merged",
  "applied",
]);

export const userTenantRole = pgEnum("user_tenant_role", ["admin"]); // MVP1: admin only

// --- Tables ----------------------------------------------------------------

export const tenants = pgTable(
  "tenants",
  {
    id: text("id").primaryKey(),
    domain: text("domain").notNull(), // immutable, see migration constraint
    tags: jsonb("tags").$type<Record<string, string>>().notNull().default({}),
    department: text("department").notNull(),
    headOfDepartment: text("head_of_department").notNull(),
    // Hard cap on Bedrock spend per calendar month. checkBudget() refuses the
    // ai_invoke step once month-to-date sum(llm_calls.cost_usd) >= this value.
    // Default $5/mo is intentionally low so a brand-new tenant can't run away.
    bedrockMonthlyCapUsd: numeric("bedrock_monthly_cap_usd", { precision: 10, scale: 2 })
      .notNull()
      .default("5.00"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
  },
  (t) => ({
    domainUq: uniqueIndex("tenants_domain_uq").on(t.domain),
  }),
);

export const users = pgTable(
  "users",
  {
    id: text("id").primaryKey(),
    cognitoSub: text("cognito_sub").notNull(),
    email: text("email").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    subUq: uniqueIndex("users_cognito_sub_uq").on(t.cognitoSub),
    emailUq: uniqueIndex("users_email_uq").on(t.email),
  }),
);

export const userTenants = pgTable(
  "user_tenants",
  {
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    tenantId: text("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    role: userTenantRole("role").notNull().default("admin"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    pk: primaryKey({ columns: [t.userId, t.tenantId] }),
    tenantIdx: index("user_tenants_tenant_idx").on(t.tenantId),
  }),
);

export const services = pgTable(
  "services",
  {
    id: text("id").primaryKey(),
    tenantId: text("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "restrict" }),
    name: text("name").notNull(),
    subdomain: text("subdomain"), // null if not exposed via domain
    vpnInternal: boolean("vpn_internal").notNull().default(true),
    gitRepo: text("git_repo").notNull(),
    description: text("description").notNull(), // mandatory — AI prompt input
    currentStatus: serviceStatus("current_status").notNull().default("na"),
    // Canonical desired-state record for this service. Populated by the
    // orchestrator on every CR transition to `applied`, by merging the CR's
    // payload (replicaCount, resources, env, requiredSecrets, image, route).
    // GIT REMAINS AUTHORITATIVE TODAY — this column is a shadow record so
    // the platform can answer "what does the SSP think the spec is?" without
    // reading the fleet repo. The full controller-pattern flip (DB
    // authoritative; orchestrator renders → git) is documented as Ring 3
    // work in deliverable1-04.
    desiredSpec: jsonb("desired_spec")
      .$type<Record<string, unknown>>()
      .notNull()
      .default({}),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
  },
  (t) => ({
    tenantIdx: index("services_tenant_idx").on(t.tenantId),
    // subdomain must be unique within a tenant (when present)
    subdomainUq: uniqueIndex("services_tenant_subdomain_uq")
      .on(t.tenantId, t.subdomain)
      .where(sql`${t.subdomain} IS NOT NULL`),
  }),
);

export const changeRequests = pgTable(
  "change_requests",
  {
    id: text("id").primaryKey(),
    serviceId: text("service_id")
      .notNull()
      .references(() => services.id, { onDelete: "cascade" }),
    requestedBy: text("requested_by")
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),
    status: changeRequestStatus("status").notNull().default("submitted"),
    summary: text("summary").notNull(),
    payload: jsonb("payload").$type<Record<string, unknown>>().notNull().default({}),
    // Append-only log of every status transition. Each entry: { status, at, detail? }.
    statusHistory: jsonb("status_history")
      .$type<Array<{ status: string; at: string; detail?: string }>>()
      .notNull()
      .default([]),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    serviceIdx: index("change_requests_service_idx").on(t.serviceId),
    statusIdx: index("change_requests_status_idx").on(t.status),
  }),
);

export const serviceRevisions = pgTable(
  "service_revisions",
  {
    id: text("id").primaryKey(),
    changeRequestId: text("change_request_id")
      .notNull()
      .references(() => changeRequests.id, { onDelete: "cascade" }),
    serviceId: text("service_id")
      .notNull()
      .references(() => services.id, { onDelete: "cascade" }),
    serviceStatus: serviceStatus("service_status").notNull(),
    crStatus: changeRequestStatus("cr_status").notNull(),
    // Existence: did the CR produce a viable revision (created) or was it rejected (rejected).
    // null while still in flight (pre-policy-gate or pre-AI-validation outcome).
    existenceStatus: text("existence_status").$type<"created" | "rejected" | null>(),
    // Readiness: result of the periodic HTTP probe against route_host. unknown until the
    // first probe completes; healthy/unhealthy after.
    healthStatus: text("health_status")
      .$type<"healthy" | "unhealthy" | "unknown">()
      .notNull()
      .default("unknown"),
    lastProbedAt: timestamp("last_probed_at", { withTimezone: true }),
    // The FQDN this revision claims (route.host). Probed every ~60s by the prober.
    routeHost: text("route_host"),
    ciPipelineRef: text("ci_pipeline_ref"),
    dockerfileSnapshot: text("dockerfile_snapshot"),
    cdManifestRef: text("cd_manifest_ref"),
    aiSummary: text("ai_summary"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    serviceIdx: index("service_revisions_service_idx").on(t.serviceId),
    // 1 CR → 1 revision. Orchestrator upserts on change_request_id.
    crUnique: uniqueIndex("service_revisions_cr_unique").on(t.changeRequestId),
  }),
);

// Persisted audit log for guarded_action events. Emitted in parallel with the
// CW EMF event by emitGuardedAction(). CW is still the authority; this table
// is the in-portal query surface for the MCP audit logs tab.
export const guardedActions = pgTable(
  "guarded_actions",
  {
    id: text("id").primaryKey(),
    tenantId: text("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    actorUserId: text("actor_user_id"),
    action: text("action").notNull(),
    resource: text("resource"),
    outcome: text("outcome").notNull(), // "allowed" | "blocked" | "warning"
    detail: text("detail"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => ({
    tenantTimeIdx: index("guarded_actions_tenant_time_idx").on(
      t.tenantId,
      t.createdAt,
    ),
  }),
);

// Per-call Bedrock audit. Append-only; the budget guard reads SUM(cost_usd)
// from this table, dashboards render rate-of-spend, security audits the model
// allowlist drift via DISTINCT model_id.
export const llmCalls = pgTable(
  "llm_calls",
  {
    id: text("id").primaryKey(),
    changeRequestId: text("change_request_id").references(
      () => changeRequests.id,
      { onDelete: "set null" },
    ),
    tenantId: text("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    modelId: text("model_id").notNull(),
    inputTokens: integer("input_tokens").notNull().default(0),
    outputTokens: integer("output_tokens").notNull().default(0),
    cacheReadTokens: integer("cache_read_tokens").notNull().default(0),
    cacheWriteTokens: integer("cache_write_tokens").notNull().default(0),
    costUsd: numeric("cost_usd", { precision: 10, scale: 6 }).notNull(),
    latencyMs: integer("latency_ms"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => ({
    tenantTimeIdx: index("llm_calls_tenant_time_idx").on(
      t.tenantId,
      t.createdAt,
    ),
  }),
);

// --- Relations -------------------------------------------------------------

export const tenantsRelations = relations(tenants, ({ many }) => ({
  services: many(services),
  members: many(userTenants),
}));

export const usersRelations = relations(users, ({ many }) => ({
  memberships: many(userTenants),
}));

export const userTenantsRelations = relations(userTenants, ({ one }) => ({
  user: one(users, { fields: [userTenants.userId], references: [users.id] }),
  tenant: one(tenants, { fields: [userTenants.tenantId], references: [tenants.id] }),
}));

export const servicesRelations = relations(services, ({ one, many }) => ({
  tenant: one(tenants, { fields: [services.tenantId], references: [tenants.id] }),
  changeRequests: many(changeRequests),
  revisions: many(serviceRevisions),
}));

export const changeRequestsRelations = relations(changeRequests, ({ one, many }) => ({
  service: one(services, { fields: [changeRequests.serviceId], references: [services.id] }),
  requester: one(users, { fields: [changeRequests.requestedBy], references: [users.id] }),
  revisions: many(serviceRevisions),
}));

export const serviceRevisionsRelations = relations(serviceRevisions, ({ one }) => ({
  changeRequest: one(changeRequests, {
    fields: [serviceRevisions.changeRequestId],
    references: [changeRequests.id],
  }),
  service: one(services, {
    fields: [serviceRevisions.serviceId],
    references: [services.id],
  }),
}));

// --- Type exports ----------------------------------------------------------

export type Tenant = typeof tenants.$inferSelect;
export type NewTenant = typeof tenants.$inferInsert;
export type User = typeof users.$inferSelect;
export type UserTenant = typeof userTenants.$inferSelect;
export type Service = typeof services.$inferSelect;
export type NewService = typeof services.$inferInsert;
export type ChangeRequest = typeof changeRequests.$inferSelect;
export type NewChangeRequest = typeof changeRequests.$inferInsert;
export type ServiceRevision = typeof serviceRevisions.$inferSelect;
export type NewServiceRevision = typeof serviceRevisions.$inferInsert;
