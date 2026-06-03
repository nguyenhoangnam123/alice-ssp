"use client";

import { useState } from "react";

/**
 * Slide-in side modal that wraps the ChangeRequest form. The submit action is a server
 * action passed in by the parent server component — keeps the cross-boundary contract
 * explicit (the modal doesn't know what happens on submit).
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

  return (
    <>
      <button onClick={() => setOpen(true)}>Request changes</button>

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
                <h2 className="text-lg">Submit ChangeRequest</h2>
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

            <p className="text-muted text-xs mb-4">
              Filled and submitted, the AI agent validates the request and (if accepted)
              opens a PR against the fleet repo. Unreasonable resource asks or
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
          </aside>
        </div>
      )}
    </>
  );
}
