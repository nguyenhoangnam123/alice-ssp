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
    ciPipelineRef: text("ci_pipeline_ref"),       // ref into the app repo workflow
    dockerfileSnapshot: text("dockerfile_snapshot"), // frozen content
    cdManifestRef: text("cd_manifest_ref"),       // PR url / SHA / path in fleet-managers
    aiSummary: text("ai_summary"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    serviceIdx: index("service_revisions_service_idx").on(t.serviceId),
    crIdx: index("service_revisions_cr_idx").on(t.changeRequestId),
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
