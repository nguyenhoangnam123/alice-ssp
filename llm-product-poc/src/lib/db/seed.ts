import { ulid } from "ulid";
import { db } from "./index";
import { tenants, users, userTenants, services } from "./schema";

async function main() {
  const userId = ulid();
  const tenantId = ulid();
  const serviceId = ulid();

  await db
    .insert(users)
    .values({
      id: userId,
      cognitoSub: "stub-admin",
      email: "admin@example.com",
    })
    .onConflictDoNothing();

  await db
    .insert(tenants)
    .values({
      id: tenantId,
      domain: "acme",
      department: "growth",
      headOfDepartment: "jane.doe@example.com",
      tags: { cost_center: "growth-eng", env: "shared-prod" },
    })
    .onConflictDoNothing();

  await db
    .insert(userTenants)
    .values({
      userId,
      tenantId,
      role: "admin",
    })
    .onConflictDoNothing();

  await db
    .insert(services)
    .values({
      id: serviceId,
      tenantId,
      name: "hello-world",
      subdomain: "hello",
      vpnInternal: true,
      gitRepo: "https://github.com/ORG/hello-world",
      description: "Internal greeting service used by onboarding flow.",
      currentStatus: "na",
    })
    .onConflictDoNothing();

  console.log("seeded:", { userId, tenantId, serviceId });
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
