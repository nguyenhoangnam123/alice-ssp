// Renders services.desired_spec — the SSP API's authoritative record of
// what the platform thinks should be deployed. Git remains the materializer
// today (the values.yaml in fleet repo is what ArgoCD actually applies);
// this panel makes the SSP's view auditable side-by-side.
//
// On the canonical controller-pattern target (Ring 3), this column drives
// the renderer that emits the git artifacts. Today it's a shadow record
// updated on every CR -> applied transition.

type DesiredSpec = Record<string, unknown>;

export function DesiredSpecPanel({ spec }: { spec: DesiredSpec }) {
  const replicaCount = typeof spec.replicaCount === "number"
    ? spec.replicaCount
    : null;
  const image =
    typeof spec.image === "object" && spec.image !== null
      ? (spec.image as { repository?: string; tag?: string })
      : null;
  const resources =
    typeof spec.resources === "object" && spec.resources !== null
      ? (spec.resources as Record<string, Record<string, string>>)
      : null;
  const env = Array.isArray(spec.env)
    ? (spec.env as Array<{ name: string; value: string }>)
    : [];
  const requiredSecrets = Array.isArray(spec.requiredSecrets)
    ? (spec.requiredSecrets as string[])
    : [];
  const route =
    typeof spec.route === "object" && spec.route !== null
      ? (spec.route as Record<string, unknown>)
      : null;

  const isEmpty =
    replicaCount === null &&
    !image &&
    !resources &&
    env.length === 0 &&
    requiredSecrets.length === 0 &&
    !route;

  return (
    <div className="border border-border rounded p-4 space-y-3">
      <div className="flex items-baseline justify-between">
        <h3 className="text-sm uppercase text-muted tracking-wide">
          Desired spec · platform&apos;s record of intent
        </h3>
        <span className="text-xs text-muted">shadow of git (today)</span>
      </div>
      <p className="text-xs text-muted">
        Updated on every CR → applied. Today git remains the materializer for
        the cluster; this column exists so the platform can answer &quot;what does
        the SSP think this service should look like?&quot; without reading the
        fleet repo. Full controller-pattern flip (this column becomes
        authoritative; orchestrator renders → git) is in the Ring-3 plan.
      </p>

      {isEmpty ? (
        <p className="text-xs text-muted">
          No spec recorded yet. Submit a CR through &quot;Request changes&quot; — on
          merge / approval the resulting payload gets merged here.
        </p>
      ) : (
        <dl className="grid grid-cols-[10rem_1fr] gap-x-4 gap-y-1 text-sm">
          {replicaCount !== null && (
            <Row label="replicaCount" value={String(replicaCount)} />
          )}
          {image?.repository && (
            <Row
              label="image"
              value={`${image.repository}${image.tag ? ":" + image.tag : ""}`}
            />
          )}
          {resources?.requests?.cpu && (
            <Row label="resources.requests.cpu" value={resources.requests.cpu} />
          )}
          {resources?.requests?.memory && (
            <Row
              label="resources.requests.memory"
              value={resources.requests.memory}
            />
          )}
          {resources?.limits?.cpu && (
            <Row label="resources.limits.cpu" value={resources.limits.cpu} />
          )}
          {resources?.limits?.memory && (
            <Row
              label="resources.limits.memory"
              value={resources.limits.memory}
            />
          )}
          {route?.host !== undefined && (
            <Row label="route.host" value={String(route.host)} />
          )}
          {env.length > 0 && (
            <>
              <dt className="text-xs text-muted">env</dt>
              <dd>
                <ul className="font-mono text-xs">
                  {env.map((e) => (
                    <li key={e.name}>
                      <span className="text-fg">{e.name}</span>
                      <span className="text-muted">=</span>
                      <span>{e.value}</span>
                    </li>
                  ))}
                </ul>
              </dd>
            </>
          )}
          {requiredSecrets.length > 0 && (
            <>
              <dt className="text-xs text-muted">requiredSecrets</dt>
              <dd>
                <ul className="font-mono text-xs">
                  {requiredSecrets.map((k) => (
                    <li key={k}>{k}</li>
                  ))}
                </ul>
              </dd>
            </>
          )}
        </dl>
      )}
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <>
      <dt className="text-xs text-muted">{label}</dt>
      <dd className="font-mono text-sm">{value}</dd>
    </>
  );
}
