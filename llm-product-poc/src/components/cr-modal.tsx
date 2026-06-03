"use client";

import { useState } from "react";

/**
 * Unified "Request changes" form. Three vertical sections; submit composes:
 *
 *   - One AI-routed CR for static configs + non-sensitive env vars (the AI
 *     reviews and rewrites helm values.yaml from these inputs).
 *   - One SECRET CR per sensitive entry (kind=secret_upsert). Values stage
 *     in AWS Secrets Manager under a pending path keyed by the CR id; admin
 *     approval merges them. The AI never sees these values.
 *
 * Drops the old free-text payload-JSON. Vibe coders edit knobs, not
 * Kubernetes resource schemas.
 */
type MemUnit = "Mi" | "Gi";
type CpuUnit = "m" | "cores";
type KV = { id: number; key: string; value: string };

let kvSeq = 0;
function newKV(): KV {
  return { id: ++kvSeq, key: "", value: "" };
}

export function CrModal({
  serviceId,
  serviceName,
}: {
  /** Accepted for back-compat with server-action callers; ignored now. */
  action?: (formData: FormData) => void | Promise<void>;
  serviceId: string;
  serviceName: string;
}) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string[]>([]);

  // static configs
  const [replicas, setReplicas] = useState<string>("");
  const [memRequest, setMemRequest] = useState<string>("");
  const [memRequestUnit, setMemRequestUnit] = useState<MemUnit>("Mi");
  const [memLimit, setMemLimit] = useState<string>("");
  const [memLimitUnit, setMemLimitUnit] = useState<MemUnit>("Mi");
  const [cpuRequest, setCpuRequest] = useState<string>("");
  const [cpuRequestUnit, setCpuRequestUnit] = useState<CpuUnit>("m");
  const [cpuLimit, setCpuLimit] = useState<string>("");
  const [cpuLimitUnit, setCpuLimitUnit] = useState<CpuUnit>("m");

  // dynamic non-sensitive
  const [envs, setEnvs] = useState<KV[]>([newKV()]);
  // dynamic sensitive (secrets)
  const [secrets, setSecrets] = useState<KV[]>([newKV()]);

  function resetForm() {
    setError(null);
    setSuccess([]);
    setReplicas("");
    setMemRequest("");
    setMemLimit("");
    setCpuRequest("");
    setCpuLimit("");
    setEnvs([newKV()]);
    setSecrets([newKV()]);
  }

  function close() {
    setOpen(false);
    resetForm();
  }

  function buildPayload(): { payload: Record<string, unknown>; summary: string[] } {
    const payload: Record<string, unknown> = {};
    const summary: string[] = [];

    if (replicas.trim() !== "") {
      const n = Number(replicas);
      if (Number.isFinite(n) && n > 0) {
        payload.replicaCount = n;
        summary.push(`replicas=${n}`);
      }
    }

    const resources: Record<string, Record<string, string>> = {};
    function setRes(scope: "requests" | "limits", key: "memory" | "cpu", value: string) {
      if (!resources[scope]) resources[scope] = {};
      resources[scope][key] = value;
    }
    if (memRequest.trim() !== "") {
      setRes("requests", "memory", `${memRequest.trim()}${memRequestUnit}`);
      summary.push(`mem.req=${memRequest.trim()}${memRequestUnit}`);
    }
    if (memLimit.trim() !== "") {
      setRes("limits", "memory", `${memLimit.trim()}${memLimitUnit}`);
      summary.push(`mem.lim=${memLimit.trim()}${memLimitUnit}`);
    }
    if (cpuRequest.trim() !== "") {
      const formatted = cpuRequestUnit === "m" ? `${cpuRequest.trim()}m` : `${cpuRequest.trim()}`;
      setRes("requests", "cpu", formatted);
      summary.push(`cpu.req=${formatted}`);
    }
    if (cpuLimit.trim() !== "") {
      const formatted = cpuLimitUnit === "m" ? `${cpuLimit.trim()}m` : `${cpuLimit.trim()}`;
      setRes("limits", "cpu", formatted);
      summary.push(`cpu.lim=${formatted}`);
    }
    if (Object.keys(resources).length > 0) payload.resources = resources;

    const validEnvs = envs.filter((e) => e.key.trim() !== "" && e.value !== "");
    if (validEnvs.length > 0) {
      payload.env = validEnvs.map((e) => ({ name: e.key.trim(), value: e.value }));
      summary.push(`env+={${validEnvs.map((e) => e.key.trim()).join(",")}}`);
    }

    return { payload, summary };
  }

  async function submit() {
    setBusy(true);
    setError(null);
    setSuccess([]);
    try {
      const { payload, summary } = buildPayload();
      const validSecrets = secrets.filter((s) => s.key.trim() !== "" && s.value !== "");

      const hasServiceChange = Object.keys(payload).length > 0;
      if (!hasServiceChange && validSecrets.length === 0) {
        setError("Nothing to submit. Fill at least one field.");
        return;
      }

      const created: string[] = [];

      if (hasServiceChange) {
        const summaryStr = `Update service: ${summary.join(", ")}`;
        const res = await fetch(`/api/services/${serviceId}/change-requests`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ summary: summaryStr, payload }),
        });
        if (!res.ok) {
          const body = await res.json().catch(() => ({}));
          throw new Error(
            `service-config CR failed: ${body.detail ?? `HTTP ${res.status}`}`,
          );
        }
        const body = await res.json();
        created.push(`Service-config CR ${body.id ?? body.change_request_id} (AI review)`);
      }

      for (const s of validSecrets) {
        const res = await fetch(`/api/services/${serviceId}/secrets`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ key: s.key.trim().toUpperCase(), value: s.value }),
        });
        if (!res.ok && res.status !== 202) {
          const body = await res.json().catch(() => ({}));
          throw new Error(
            `secret CR for ${s.key} failed: ${body.detail ?? `HTTP ${res.status}`}`,
          );
        }
        const body = await res.json();
        created.push(
          `Secret CR ${body.id ?? body.change_request_id} for ${s.key.trim().toUpperCase()} (admin approval)`,
        );
      }

      setSuccess(created);
      setReplicas("");
      setMemRequest("");
      setMemLimit("");
      setCpuRequest("");
      setCpuLimit("");
      setEnvs([newKV()]);
      setSecrets([newKV()]);
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
            if (e.target === e.currentTarget) close();
          }}
        >
          <aside className="w-full max-w-xl h-full bg-panel border-l border-border p-6 overflow-y-auto shadow-xl">
            <header className="flex items-center justify-between mb-4">
              <div>
                <h2 className="text-lg">Request changes</h2>
                <p className="text-muted text-xs font-mono">{serviceName}</p>
              </div>
              <button
                type="button"
                className="secondary"
                onClick={close}
              >
                ✕
              </button>
            </header>

            <p className="text-muted text-xs mb-6">
              Static configs + non-sensitive env vars are bundled into one
              AI-reviewed CR. Each sensitive entry becomes its own secret CR
              (AI bypassed; admin approves on the CR page). Submit creates
              everything in one click.
            </p>

            <form
              className="space-y-6"
              onSubmit={(e) => {
                e.preventDefault();
                void submit();
              }}
            >
              {/* ----------------------- Static configs ----------------------- */}
              <section className="space-y-3 border border-border rounded p-4">
                <h3 className="text-sm uppercase tracking-wide text-muted">
                  Static configs <span className="text-xs normal-case">(recommended)</span>
                </h3>
                <Row label="Replicas">
                  <input
                    type="number"
                    min={1}
                    max={20}
                    value={replicas}
                    onChange={(e) => setReplicas(e.target.value)}
                    placeholder="e.g. 2"
                    disabled={busy}
                  />
                </Row>
                <ResourceRow
                  label="Memory request"
                  value={memRequest}
                  setValue={setMemRequest}
                  unit={memRequestUnit}
                  setUnit={(u) => setMemRequestUnit(u as MemUnit)}
                  units={["Mi", "Gi"]}
                  disabled={busy}
                />
                <ResourceRow
                  label="Memory limit"
                  value={memLimit}
                  setValue={setMemLimit}
                  unit={memLimitUnit}
                  setUnit={(u) => setMemLimitUnit(u as MemUnit)}
                  units={["Mi", "Gi"]}
                  disabled={busy}
                />
                <ResourceRow
                  label="CPU request"
                  value={cpuRequest}
                  setValue={setCpuRequest}
                  unit={cpuRequestUnit}
                  setUnit={(u) => setCpuRequestUnit(u as CpuUnit)}
                  units={["m", "cores"]}
                  disabled={busy}
                />
                <ResourceRow
                  label="CPU limit"
                  value={cpuLimit}
                  setValue={setCpuLimit}
                  unit={cpuLimitUnit}
                  setUnit={(u) => setCpuLimitUnit(u as CpuUnit)}
                  units={["m", "cores"]}
                  disabled={busy}
                />
              </section>

              {/* ----------------- Non-sensitive dynamic configs ----------------- */}
              <section className="space-y-3 border border-border rounded p-4">
                <h3 className="text-sm uppercase tracking-wide text-muted">
                  Non-sensitive dynamic configs
                </h3>
                <p className="text-xs text-muted">
                  Plain env vars added to the helm values. AI-reviewed.
                </p>
                <KvList
                  items={envs}
                  setItems={setEnvs}
                  valueType="text"
                  keyPlaceholder="LOG_LEVEL"
                  valuePlaceholder="debug"
                  disabled={busy}
                />
              </section>

              {/* ------------------ Sensitive dynamic configs ------------------ */}
              <section className="space-y-3 border border-border rounded p-4">
                <h3 className="text-sm uppercase tracking-wide text-muted">
                  Sensitive dynamic configs
                </h3>
                <p className="text-xs text-muted">
                  Each entry becomes its own secret CR. Value held in AWS
                  Secrets Manager pending path; AI never sees it. Admin
                  approves from the CR page.
                </p>
                <KvList
                  items={secrets}
                  setItems={setSecrets}
                  valueType="password"
                  keyPlaceholder="STRIPE_API_KEY"
                  valuePlaceholder="paste value"
                  disabled={busy}
                />
              </section>

              <div className="flex gap-2">
                <button type="submit" disabled={busy}>
                  {busy ? "submitting…" : "Submit"}
                </button>
                <button type="button" className="secondary" onClick={close}>
                  Cancel
                </button>
              </div>
            </form>

            {error && (
              <p className="text-xs text-red-400 border border-red-700 rounded p-2 mt-4">
                {error}
              </p>
            )}
            {success.length > 0 && (
              <div className="mt-4 border border-green-700 rounded p-3">
                <p className="text-xs text-green-300 mb-1">Submitted:</p>
                <ul className="text-xs space-y-1 list-disc list-inside">
                  {success.map((s, i) => (
                    <li key={i}>{s}</li>
                  ))}
                </ul>
              </div>
            )}
          </aside>
        </div>
      )}
    </>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="grid grid-cols-[10rem_1fr] gap-3 items-center">
      <label className="text-xs text-muted">{label}</label>
      {children}
    </div>
  );
}

function ResourceRow({
  label,
  value,
  setValue,
  unit,
  setUnit,
  units,
  disabled,
}: {
  label: string;
  value: string;
  setValue: (s: string) => void;
  unit: string;
  setUnit: (u: string) => void;
  units: string[];
  disabled?: boolean;
}) {
  return (
    <Row label={label}>
      <div className="flex gap-2">
        <input
          type="number"
          min={0}
          value={value}
          onChange={(e) => setValue(e.target.value)}
          placeholder="e.g. 256"
          disabled={disabled}
          className="flex-1 font-mono"
        />
        <select
          value={unit}
          onChange={(e) => setUnit(e.target.value)}
          disabled={disabled}
        >
          {units.map((u) => (
            <option key={u} value={u}>
              {u}
            </option>
          ))}
        </select>
      </div>
    </Row>
  );
}

function KvList({
  items,
  setItems,
  valueType,
  keyPlaceholder,
  valuePlaceholder,
  disabled,
}: {
  items: KV[];
  setItems: (next: KV[]) => void;
  valueType: "text" | "password";
  keyPlaceholder: string;
  valuePlaceholder: string;
  disabled?: boolean;
}) {
  return (
    <div className="space-y-2">
      {items.map((kv, idx) => (
        <div
          key={kv.id}
          className="grid grid-cols-[10rem_1fr_3rem] gap-2 items-center"
        >
          <input
            value={kv.key}
            onChange={(e) => {
              const next = [...items];
              next[idx] = { ...kv, key: e.target.value.toUpperCase() };
              setItems(next);
            }}
            placeholder={keyPlaceholder}
            disabled={disabled}
            className="font-mono"
          />
          <input
            type={valueType}
            value={kv.value}
            onChange={(e) => {
              const next = [...items];
              next[idx] = { ...kv, value: e.target.value };
              setItems(next);
            }}
            placeholder={valuePlaceholder}
            autoComplete={valueType === "password" ? "off" : undefined}
            disabled={disabled}
            className="font-mono"
          />
          <button
            type="button"
            className="secondary"
            disabled={disabled || items.length === 1}
            onClick={() => {
              setItems(items.filter((x) => x.id !== kv.id));
            }}
            title="remove this entry"
          >
            ✕
          </button>
        </div>
      ))}
      <button
        type="button"
        className="secondary"
        disabled={disabled}
        onClick={() => setItems([...items, newKV()])}
      >
        + add entry
      </button>
    </div>
  );
}
