// Read-only listing of secret KEYS for this service. Edits happen ONLY via
// the "Request changes" button at the top of the page — there's no form on
// this tab. This component shows what's currently set; the CR-mediated path
// is how a tenant proposes a change.
//
// Values are NEVER rendered. The masked form (first 2 chars + asterisks)
// comes server-side from secret-manager.maskValue() — the browser only
// receives those previews.

export function SecretKeysReadonly({
  items,
}: {
  items: { key: string; masked: string }[];
}) {
  return (
    <div className="border border-border rounded p-4 space-y-3">
      <div className="flex items-baseline justify-between">
        <h3 className="text-sm uppercase text-muted tracking-wide">
          Secrets · stored in AWS Secrets Manager
        </h3>
        <span className="text-xs text-muted">read-only</span>
      </div>
      <p className="text-xs text-muted">
        Mounted into the tenant pod as env vars via External Secrets. The
        keys below are what&apos;s currently set; values are write-only.
        <br />
        To <strong>add / rotate / delete</strong> a secret, use the{" "}
        <strong>Request changes</strong> button at the top of the page —
        secret operations are CR-mediated like every other change. The AI is
        bypassed (the model never sees the value); a platform admin approves
        from the CR detail page.
      </p>
      {items.length === 0 ? (
        <p className="text-xs text-muted">
          No secrets yet for this service.
        </p>
      ) : (
        <ul className="space-y-1 font-mono text-sm">
          {items.map((row) => (
            <li
              key={row.key}
              className="grid grid-cols-[16rem_1fr] gap-2 border-t border-border/30 pt-1"
            >
              <span>{row.key}</span>
              <span className="text-muted">{row.masked}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
