"use client";

// Service-detail secrets widget. Reads /api/services/<id>/secrets, posts new
// keys, deletes existing ones. Never displays raw values — the server only
// returns masked previews; the value the tenant typed is paid out exactly
// once at submit time (cleared from the input after).
//
// Backed by AWS Secrets Manager via the portal IRSA. ExternalSecret in the
// tenant namespace then mounts the bundle as env vars on the service pod.

import { useEffect, useState } from "react";

type SecretRow = { key: string; masked: string };

export function SecretsForm({ serviceId }: { serviceId: string }) {
  const [items, setItems] = useState<SecretRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [key, setKey] = useState("");
  const [value, setValue] = useState("");
  const [justSet, setJustSet] = useState<string | null>(null);

  async function refresh() {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/services/${serviceId}/secrets`);
      if (!res.ok) {
        const body = await res.text();
        setError(`failed to load: HTTP ${res.status} ${body.slice(0, 120)}`);
        return;
      }
      const body = (await res.json()) as { items: SecretRow[] };
      setItems(body.items);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void refresh();
  }, [serviceId]);

  async function submit() {
    if (!key.trim() || !value.trim() || busy) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/services/${serviceId}/secrets`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ key: key.trim(), value }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        setError(body.detail ?? `HTTP ${res.status}`);
        return;
      }
      const body = (await res.json()) as { change_request_id: string };
      setJustSet(
        `Submitted CR ${body.change_request_id}. Value staged in AWS Secrets Manager; pending platform approval. Value cleared from the input.`,
      );
      setKey("");
      setValue("");
      void refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  async function remove(k: string) {
    if (!confirm(`Submit a CR to delete secret ${k}? It still needs platform approval.`)) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/services/${serviceId}/secrets/${encodeURIComponent(k)}`, {
        method: "DELETE",
      });
      if (!res.ok && res.status !== 202) {
        const body = await res.text();
        setError(`HTTP ${res.status}: ${body.slice(0, 120)}`);
        return;
      }
      const body = (await res.json().catch(() => ({}))) as { change_request_id?: string };
      setJustSet(
        `Submitted delete CR ${body.change_request_id ?? "?"} for ${k}. Pending platform approval.`,
      );
      void refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="border border-border rounded p-4 space-y-4">
      <h3 className="text-sm uppercase text-muted tracking-wide">
        Secrets · stored in AWS Secrets Manager (ssp/&lt;tenant&gt;/&lt;service&gt;/secrets)
      </h3>

      <p className="text-xs text-muted">
        Mounted into the tenant pod as env vars via External Secrets. Each set
        / delete from this form creates a <strong>change-request</strong> —
        the AI is bypassed (we never let it see secret values); a platform
        admin must approve from the CR page before the value is merged into
        the live bundle. Until approved, the value lives in a pending AWS
        Secrets Manager path keyed by the CR id, encrypted under the platform
        KMS CMK.
      </p>

      <div>
        {loading ? (
          <p className="text-muted text-xs">loading…</p>
        ) : items.length === 0 ? (
          <p className="text-muted text-xs">No secrets yet.</p>
        ) : (
          <ul className="space-y-1 text-sm font-mono">
            {items.map((row) => (
              <li key={row.key} className="grid grid-cols-[12rem_1fr_6rem] gap-2 items-center">
                <span>{row.key}</span>
                <span className="text-muted">{row.masked}</span>
                <button
                  type="button"
                  onClick={() => remove(row.key)}
                  disabled={busy}
                  className="text-xs"
                >
                  delete
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>

      <form
        className="border-t border-border pt-3 space-y-2"
        onSubmit={(e) => {
          e.preventDefault();
          void submit();
        }}
      >
        <div className="grid grid-cols-[12rem_1fr_6rem] gap-2">
          <input
            value={key}
            onChange={(e) => setKey(e.target.value.toUpperCase())}
            placeholder="STRIPE_API_KEY"
            pattern="^[A-Z][A-Z0-9_]{0,63}$"
            title="UPPER_SNAKE_CASE, letters/digits/underscores, ≤64 chars"
            required
            disabled={busy}
            className="font-mono text-sm"
          />
          <input
            type="password"
            value={value}
            onChange={(e) => setValue(e.target.value)}
            placeholder="value (saved write-only)"
            required
            autoComplete="off"
            disabled={busy}
            className="font-mono text-sm"
          />
          <button type="submit" disabled={busy || !key || !value}>
            {busy ? "saving…" : "save"}
          </button>
        </div>
        {justSet && (
          <p className="text-xs text-green-300">{justSet}</p>
        )}
        {error && (
          <p className="text-xs text-red-400 border border-red-700 rounded p-2">
            {error}
          </p>
        )}
      </form>
    </div>
  );
}
