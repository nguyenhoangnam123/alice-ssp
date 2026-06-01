import { redirect } from "next/navigation";
import { ulid } from "ulid";
import { db } from "@/lib/db";
import { services, tenants, changeRequests } from "@/lib/db/schema";
import { inArray } from "drizzle-orm";
import { listAccessibleTenantIds, requireTenantAdmin, requireUser } from "@/lib/auth/rbac";
import { processChangeRequest } from "@/lib/workflow/orchestrator";

async function createService(formData: FormData) {
  "use server";
  const user = await requireUser();
  const tenantId = String(formData.get("tenant_id") ?? "");
  await requireTenantAdmin(tenantId);

  const name = String(formData.get("name") ?? "").trim();
  const subdomainRaw = String(formData.get("subdomain") ?? "").trim();
  const subdomain = subdomainRaw === "" ? null : subdomainRaw.toLowerCase();
  const vpnInternal = formData.get("vpn_internal") === "on";
  const gitRepo = String(formData.get("git_repo") ?? "").trim();
  const description = String(formData.get("description") ?? "").trim();

  if (!name || !/^[a-z0-9-]+$/.test(name)) {
    throw new Error("name must be lowercase letters/digits/hyphens");
  }
  if (!gitRepo) throw new Error("git_repo required");
  if (!description || description.length < 20) {
    throw new Error("description must be at least 20 characters");
  }

  const serviceId = ulid();
  const crId = ulid();
  await db.transaction(async (tx) => {
    await tx.insert(services).values({
      id: serviceId,
      tenantId,
      name,
      subdomain,
      vpnInternal,
      gitRepo,
      description,
      currentStatus: "na",
    });
    await tx.insert(changeRequests).values({
      id: crId,
      serviceId,
      requestedBy: user.id,
      summary: `Initial submission: ${name}`,
      status: "submitted",
    });
  });

  // Fire-and-forget the in-process workflow. In MVP2 this becomes StartExecution.
  processChangeRequest(crId).catch((err) => {
    console.error("workflow failed", err);
  });

  redirect(`/dashboard/services/${serviceId}`);
}

export default async function NewServicePage({
  searchParams,
}: {
  searchParams: Promise<{ tenant?: string }>;
}) {
  await requireUser();
  const { tenant: preselect } = await searchParams;
  const ids = await listAccessibleTenantIds();
  const myTenants = ids.length
    ? await db.select().from(tenants).where(inArray(tenants.id, ids))
    : [];

  if (myTenants.length === 0) {
    return (
      <section>
        <h1 className="text-xl mb-2">New service</h1>
        <p className="text-muted">
          You need to be a member of at least one tenant before you can submit a service.
        </p>
      </section>
    );
  }

  return (
    <section className="max-w-2xl">
      <h1 className="text-xl mb-4">New service</h1>
      <p className="text-muted text-sm mb-4">
        Submitting this will create a ChangeRequest, run the AI agent against your repo, and
        open a PR against <code>fleet-managers</code>. A platform engineer must merge before
        anything reaches the cluster.
      </p>
      <form action={createService} className="space-y-4">
        <div>
          <label className="block text-sm text-muted mb-1">tenant</label>
          <select name="tenant_id" defaultValue={preselect ?? myTenants[0].id}>
            {myTenants.map((t) => (
              <option key={t.id} value={t.id}>
                {t.domain}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="block text-sm text-muted mb-1">name</label>
          <input name="name" placeholder="hello-world" required />
        </div>
        <div>
          <label className="block text-sm text-muted mb-1">
            subdomain (leave blank if internal-only / not exposed)
          </label>
          <input name="subdomain" placeholder="hello" />
        </div>
        <div className="flex items-center gap-2">
          <input
            type="checkbox"
            name="vpn_internal"
            defaultChecked
            className="!w-auto"
            id="vpn"
          />
          <label htmlFor="vpn" className="text-sm">
            VPN-only (route via internal ALB)
          </label>
        </div>
        <div>
          <label className="block text-sm text-muted mb-1">git repo</label>
          <input
            name="git_repo"
            placeholder="https://github.com/ORG/hello-world"
            required
            type="url"
          />
        </div>
        <div>
          <label className="block text-sm text-muted mb-1">
            description (≥20 chars — used as AI prompt input)
          </label>
          <textarea
            name="description"
            rows={4}
            required
            placeholder="What this service does, who calls it, and any non-default resource needs."
          />
        </div>
        <button type="submit">Submit</button>
      </form>
    </section>
  );
}
