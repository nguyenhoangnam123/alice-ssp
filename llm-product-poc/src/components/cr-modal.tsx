"use client";

import { useState } from "react";

type Kind = "service_change" | "secret_upsert" | "secret_delete";

/**
 * Unified "Request changes" modal. ONE entry point for every change a tenant
 * can propose — config changes that route through the AI, and secret
 * operations that bypass the AI but still ride the CR rails (admin approval
 * on the CR detail page).
 *
 * The submit action prop is still server-action-shaped (used for AI-routed
 * config changes). Secret CRs are POSTed to the dedicated secrets API on the
 * client side because their flow is asynchronous (write pending blob first,
 * then create CR) — keeping that on the server-action path would force a
 * full-page redirect for what should be a popover-class interaction.
 */
export function CrModal({
  action,
  serviceId,
  serviceName,
}: {
  action: (formData: FormData) => void | Promise<void>;
  serviceId: string;
  serviceName: string;
}) {
  const [open, setOpen] = useState(false);
  const [kind, setKind] = useState<Kind>("service_change");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  // secret-upsert fields
  const [secretKey, setSecretKey] = useState("");
  const [secretValue, setSecretValue] = useState("");
  // secret-delete fields
  const [deleteKey, setDeleteKey] = useState("");

  function resetForm() {
    setError(null);
    setSuccess(null);
    setSecretKey("");
    setSecretValue("");
    setDeleteKey("");
  }

  async function submitSecret(operation: "upsert" | "delete") {
    setBusy(true);
    setError(null);
    setSuccess(null);
    try {
      let res: Response;
      if (operation === "upsert") {
        if (!secretKey.trim() || !secretValue) {
          setError("key and value are required");
          return;
        }
        res = await fetch(`/api/services/${serviceId}/secrets`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ key: secretKey.trim(), value: secretValue }),
        });
      } else {
        if (!deleteKey.trim()) {
          setError("key is required");
          return;
        }
        res = await fetch(
          `/api/services/${serviceId}/secrets/${encodeURIComponent(deleteKey.trim())}`,
          { method: "DELETE" },
        );
      }
      if (!res.ok && res.status !== 202 && res.status !== 204) {
        const body = await res.json().catch(() => ({}));
        setError(body.detail ?? `HTTP ${res.status}`);
        return;
      }
      const body = await res.json().catch(() => ({}));
      setSuccess(
        `Submitted CR ${body.change_request_id ?? "?"} — pending platform approval. The value (if any) is held in AWS Secrets Manager under a pending path keyed by the CR id.`,
      );
      setSecretKey("");
      setSecretValue("");
      setDeleteKey("");
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <button
        onClick={() => {
          resetForm();
          setOpen(true);
        }}
      >
        Request changes
      </button>

      {open && (
        <div
          className="fixed inset-0 z-50 bg-black/60 flex justify-end"
          onClick={(e) => {
            if (e.target === e.currentTarget) setOpen(false);
          }}
        >
          <aside className="w-full max-w-md h-full bg-panel border-l border-border p-6 overflow-y-auto shadow-xl">
            <header className="flex items-center justify-between mb-4">
              <div>
                <h2 className="text-lg">Request changes</h2>
                <p className="text-muted text-xs font-mono">{serviceName}</p>
              </div>
              <button
                type="button"
                className="secondary"
                onClick={() => setOpen(false)}
              >
                ✕
              </button>
            </header>

            <div className="mb-4">
              <label className="block text-xs text-muted mb-1">Change type</label>
              <select
                value={kind}
                onChange={(e) => {
                  resetForm();
                  setKind(e.target.value as Kind);
                }}
              >
                <option value="service_change">
                  Service config — routes through the AI
                </option>
                <option value="secret_upsert">
                  Set / rotate a secret — admin approval, AI never sees the value
                </option>
                <option value="secret_delete">
                  Delete a secret — admin approval
                </option>
              </select>
            </div>

            {kind === "service_change" && (
              <>
                <p className="text-muted text-xs mb-4">
                  The AI agent validates the request and (if accepted) opens
                  a PR against the fleet repo. Unreasonable resource asks or
                  policy-violating configs are rejected up front.
                </p>
                <form action={action} className="space-y-4">
                  <input type="hidden" name="service_id" value={serviceId} />
                  <div>
                    <label className="block text-xs text-muted mb-1">summary</label>
                    <input
                      name="summary"
                      required
                      placeholder="e.g. bump replicas to 4 + increase memory limit"
                    />
                  </div>
                  <div>
                    <label className="block text-xs text-muted mb-1">
                      payload (optional JSON describing the desired delta)
                    </label>
                    <textarea
                      name="payload_raw"
                      rows={4}
                      placeholder='{"replicaCount": 4, "resources": {"requests": {"memory": "256Mi"}}}'
                      className="font-mono"
                    />
                  </div>
                  <div className="flex gap-2">
                    <button type="submit">Submit CR</button>
                    <button
                      type="button"
                      className="secondary"
                      onClick={() => setOpen(false)}
                    >
                      Cancel
                    </button>
                  </div>
                </form>
              </>
            )}

            {kind === "secret_upsert" && (
              <>
                <p className="text-muted text-xs mb-4">
                  The value is staged in AWS Secrets Manager under a pending
                  path. The AI is bypassed entirely (we never let a model see
                  secret values). A platform admin must approve the CR on the
                  CR detail page before the value is merged into the live
                  bundle.
                </p>
                <form
                  className="space-y-4"
                  onSubmit={(e) => {
                    e.preventDefault();
                    void submitSecret("upsert");
                  }}
                >
                  <div>
                    <label className="block text-xs text-muted mb-1">key</label>
                    <input
                      value={secretKey}
                      onChange={(e) => setSecretKey(e.target.value.toUpperCase())}
                      placeholder="STRIPE_API_KEY"
                      pattern="^[A-Z][A-Z0-9_]{0,63}$"
                      title="UPPER_SNAKE_CASE, ≤64 chars"
                      required
                      disabled={busy}
                      className="font-mono"
                    />
                  </div>
                  <div>
                    <label className="block text-xs text-muted mb-1">
                      value (write-only)
                    </label>
                    <input
                      type="password"
                      value={secretValue}
                      onChange={(e) => setSecretValue(e.target.value)}
                      placeholder="paste value"
                      autoComplete="off"
                      required
                      disabled={busy}
                      className="font-mono"
                    />
                  </div>
                  <div className="flex gap-2">
                    <button type="submit" disabled={busy}>
                      {busy ? "submitting…" : "Submit secret CR"}
                    </button>
                    <button
                      type="button"
                      className="secondary"
                      onClick={() => setOpen(false)}
                    >
                      Cancel
                    </button>
                  </div>
                </form>
              </>
            )}

            {kind === "secret_delete" && (
              <>
                <p className="text-muted text-xs mb-4">
                  Submits a CR to remove the key from the live bundle. Admin
                  approval drops it; until then the secret is still mounted on
                  the tenant pod.
                </p>
                <form
                  className="space-y-4"
                  onSubmit={(e) => {
                    e.preventDefault();
                    void submitSecret("delete");
                  }}
                >
                  <div>
                    <label className="block text-xs text-muted mb-1">key</label>
                    <input
                      value={deleteKey}
                      onChange={(e) => setDeleteKey(e.target.value.toUpperCase())}
                      placeholder="STRIPE_API_KEY"
                      pattern="^[A-Z][A-Z0-9_]{0,63}$"
                      required
                      disabled={busy}
                      className="font-mono"
                    />
                  </div>
                  <div className="flex gap-2">
                    <button type="submit" disabled={busy}>
                      {busy ? "submitting…" : "Submit delete CR"}
                    </button>
                    <button
                      type="button"
                      className="secondary"
                      onClick={() => setOpen(false)}
                    >
                      Cancel
                    </button>
                  </div>
                </form>
              </>
            )}

            {error && (
              <p className="text-xs text-red-400 border border-red-700 rounded p-2 mt-4">
                {error}
              </p>
            )}
            {success && (
              <p className="text-xs text-green-300 mt-4">{success}</p>
            )}
          </aside>
        </div>
      )}
    </>
  );
}
