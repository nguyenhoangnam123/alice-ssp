import { redirect } from "next/navigation";
import { ulid } from "ulid";
import { db } from "@/lib/db";
import { tenants, userTenants } from "@/lib/db/schema";
import { requireUser } from "@/lib/auth/rbac";

async function createTenant(formData: FormData) {
  "use server";
  const user = await requireUser();

  const domain = String(formData.get("domain") ?? "").trim().toLowerCase();
  const department = String(formData.get("department") ?? "").trim();
  const head = String(formData.get("head_of_department") ?? "").trim();
  const tagsRaw = String(formData.get("tags") ?? "").trim();

  if (!domain || !/^[a-z0-9-]+$/.test(domain)) {
    throw new Error("domain must be lowercase letters/digits/hyphens");
  }
  if (!department || !head) throw new Error("department and head required");

  const tags: Record<string, string> = {};
  for (const pair of tagsRaw.split(/\s+/).filter(Boolean)) {
    const [k, v] = pair.split("=");
    if (k && v) tags[k] = v;
  }

  const id = ulid();
  await db.transaction(async (tx) => {
    await tx.insert(tenants).values({
      id,
      domain,
      department,
      headOfDepartment: head,
      tags,
    });
    // The creator becomes admin of the tenant. Real impl: platform team grants membership.
    await tx.insert(userTenants).values({
      userId: user.id,
      tenantId: id,
      role: "admin",
    });
  });

  redirect(`/dashboard/tenants/${id}`);
}

export default async function NewTenantPage() {
  await requireUser();
  return (
    <section className="max-w-lg">
      <h1 className="text-xl mb-4">New tenant</h1>
      <p className="text-muted text-sm mb-4">
        Domain is immutable once created — it is used as the slug for AWS resource names and
        Kubernetes namespaces.
      </p>
      <form action={createTenant} className="space-y-4">
        <div>
          <label className="block text-sm text-muted mb-1">domain</label>
          <input name="domain" placeholder="acme" required />
        </div>
        <div>
          <label className="block text-sm text-muted mb-1">department</label>
          <input name="department" placeholder="growth" required />
        </div>
        <div>
          <label className="block text-sm text-muted mb-1">head of department</label>
          <input
            name="head_of_department"
            placeholder="jane.doe@example.com"
            required
            type="email"
          />
        </div>
        <div>
          <label className="block text-sm text-muted mb-1">
            tags (space-separated key=value, propagated to AWS)
          </label>
          <input name="tags" placeholder="cost_center=growth-eng env=shared-prod" />
        </div>
        <button type="submit">Create</button>
      </form>
    </section>
  );
}
