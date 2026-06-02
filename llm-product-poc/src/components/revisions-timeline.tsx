"use client";

import { useState } from "react";
import clsx from "clsx";

type StatusEvent = { status: string; at: string; detail?: string };

type Revision = {
  id: string;
  serviceStatus: string;
  crStatus: string;
  existenceStatus: "created" | "rejected" | null;
  healthStatus: "healthy" | "unhealthy" | "unknown";
  lastProbedAt: string | null;
  routeHost: string | null;
  aiSummary: string | null;
  cdManifestRef: string | null;
  dockerfileSnapshot: string | null;
  ciPipelineRef: string | null;
  createdAt: string;
  crSummary: string;
  crStatusHistory: StatusEvent[];
};

const STATUS_META: Record<
  string,
  { label: string; tone: "ok" | "info" | "warn" | "fail"; icon: string }
> = {
  submitted: { label: "Submitted", tone: "info", icon: "•" },
  policy_gate_passed: { label: "Policy gate passed", tone: "ok", icon: "✓" },
  policy_gate_rejected: { label: "Policy gate rejected", tone: "fail", icon: "✕" },
  ai_validation_passed: { label: "AI validation passed", tone: "ok", icon: "✓" },
  ai_validation_rejected: { label: "AI validation rejected", tone: "fail", icon: "✕" },
  ai_artifacts_generated: { label: "AI artifacts generated", tone: "info", icon: "✎" },
  platform_reviewing: { label: "Platform reviewing", tone: "warn", icon: "⏳" },
  applied: { label: "Applied / integrated", tone: "ok", icon: "✓" },
  rejected: { label: "Rejected", tone: "fail", icon: "✕" },
};

const TONE_CLASS: Record<string, string> = {
  ok: "border-green-700 text-green-400",
  info: "border-blue-700 text-blue-400",
  warn: "border-yellow-700 text-yellow-400",
  fail: "border-red-700 text-red-400",
};

/**
 * One row per ChangeRequest (1:1 with ServiceRevision). The row header shows the CR
 * summary + the current CR status badge. Expanded body reveals the full status_history
 * workflow timeline + the revision's artifacts.
 */
export function RevisionsTimeline({ revisions }: { revisions: Revision[] }) {
  const [expandedId, setExpandedId] = useState<string | null>(
    revisions[0]?.id ?? null,
  );

  if (revisions.length === 0) {
    return (
      <p className="text-muted">No revisions yet — workflow may still be running.</p>
    );
  }

  return (
    <ol className="border-l border-border pl-0 space-y-2">
      {revisions.map((r) => {
        const open = expandedId === r.id;
        const meta = STATUS_META[r.crStatus] ?? STATUS_META.submitted;
        const { current, desired, summary, reason } = parseSummary(r.aiSummary);
        return (
          <li key={r.id} className="border border-border rounded">
            <button
              type="button"
              className={clsx(
                "w-full flex items-center gap-3 px-3 py-2 text-left bg-transparent border-0",
                "hover:bg-panel/50",
              )}
              onClick={() => setExpandedId(open ? null : r.id)}
              style={{
                background: "transparent",
                color: "inherit",
                fontWeight: 400,
              }}
            >
              <span className="font-mono text-xs text-muted w-44 shrink-0">
                {new Date(r.createdAt).toLocaleString()}
              </span>
              <span className="text-sm">{r.crSummary}</span>
              <span
                className={clsx(
                  "inline-flex items-center gap-1 text-xs px-2 py-0.5 border rounded ml-2",
                  TONE_CLASS[meta.tone],
                )}
              >
                <span>{meta.icon}</span>
                <span>{meta.label}</span>
              </span>
              <ExistenceBadge value={r.existenceStatus} />
              <HealthBadge
                existence={r.existenceStatus}
                value={r.healthStatus}
                lastProbedAt={r.lastProbedAt}
              />
              <span
                className={clsx(
                  "ml-auto text-muted text-xs transition-transform",
                  open && "rotate-90",
                )}
              >
                ›
              </span>
            </button>

            {open && (
              <div className="border-t border-border px-3 py-3 space-y-4 text-sm">
                {r.routeHost && (
                  <div className="text-xs text-muted">
                    Route:{" "}
                    <a
                      href={`https://${r.routeHost}`}
                      target="_blank"
                      rel="noreferrer"
                      className="font-mono"
                    >
                      {r.routeHost}
                    </a>
                    {r.lastProbedAt && (
                      <span className="ml-2">
                        · last probed {new Date(r.lastProbedAt).toLocaleTimeString()}
                      </span>
                    )}
                  </div>
                )}
                <StatusTimeline events={r.crStatusHistory} />

                {reason && (
                  <div className="text-sm text-red-300">
                    <div className="text-xs text-muted mb-1">Reason</div>
                    {reason}
                  </div>
                )}

                {(current || desired) && (
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <div className="text-xs text-muted mb-1">Current state</div>
                      <div className="text-sm">{current || "—"}</div>
                    </div>
                    <div>
                      <div className="text-xs text-muted mb-1">Desired state</div>
                      <div className="text-sm">{desired || "—"}</div>
                    </div>
                  </div>
                )}

                {summary && (
                  <div>
                    <div className="text-xs text-muted mb-1">AI summary</div>
                    <div className="text-sm whitespace-pre-wrap">{summary}</div>
                  </div>
                )}

                {r.cdManifestRef && (
                  <div className="text-xs">
                    PR:{" "}
                    <a href={r.cdManifestRef} target="_blank" rel="noreferrer">
                      {r.cdManifestRef}
                    </a>
                  </div>
                )}

                {r.dockerfileSnapshot && (
                  <details>
                    <summary className="cursor-pointer text-muted text-xs">
                      Dockerfile snapshot
                    </summary>
                    <pre className="bg-panel border border-border p-2 mt-1 overflow-x-auto text-xs">
                      {r.dockerfileSnapshot}
                    </pre>
                  </details>
                )}
              </div>
            )}
          </li>
        );
      })}
    </ol>
  );
}

function ExistenceBadge({ value }: { value: "created" | "rejected" | null }) {
  if (value === null) return null;
  const tone = value === "created" ? "ok" : "fail";
  const label = value === "created" ? "exists" : "rejected";
  const icon = value === "created" ? "●" : "✕";
  return (
    <span
      title={`Existence: ${value} — set by orchestrator from CR workflow outcome`}
      className={clsx(
        "inline-flex items-center gap-1 text-xs px-2 py-0.5 border rounded",
        TONE_CLASS[tone],
      )}
    >
      <span>{icon}</span>
      <span>{label}</span>
    </span>
  );
}

function HealthBadge({
  existence,
  value,
  lastProbedAt,
}: {
  existence: "created" | "rejected" | null;
  value: "healthy" | "unhealthy" | "unknown";
  lastProbedAt: string | null;
}) {
  // Hide health for rejected revisions — readiness only applies once the revision exists.
  if (existence !== "created") return null;
  const meta =
    value === "healthy"
      ? { tone: "ok", label: "healthy", icon: "♥" }
      : value === "unhealthy"
        ? { tone: "fail", label: "unhealthy", icon: "✕" }
        : { tone: "info", label: "probing", icon: "?" };
  const tip = lastProbedAt
    ? `Readiness: ${value} (probed ${new Date(lastProbedAt).toLocaleString()})`
    : "Readiness: not yet probed";
  return (
    <span
      title={tip}
      className={clsx(
        "inline-flex items-center gap-1 text-xs px-2 py-0.5 border rounded",
        TONE_CLASS[meta.tone],
      )}
    >
      <span>{meta.icon}</span>
      <span>{meta.label}</span>
    </span>
  );
}

function StatusTimeline({ events }: { events: StatusEvent[] }) {
  if (!events || events.length === 0) {
    return <p className="text-muted text-xs">(no status history)</p>;
  }
  return (
    <div>
      <div className="text-xs text-muted mb-2">Workflow timeline</div>
      <ol className="space-y-1">
        {events.map((e, i) => {
          const meta = STATUS_META[e.status] ?? STATUS_META.submitted;
          return (
            <li key={i} className="flex items-center gap-3 text-sm">
              <span className="font-mono text-xs text-muted w-40 shrink-0">
                {new Date(e.at).toLocaleTimeString()}
              </span>
              <span
                className={clsx(
                  "inline-flex items-center gap-1 text-xs px-2 py-0.5 border rounded",
                  TONE_CLASS[meta.tone],
                )}
              >
                <span>{meta.icon}</span>
                <span>{meta.label}</span>
              </span>
              {e.detail && (
                <span className="text-xs text-muted truncate">{e.detail}</span>
              )}
            </li>
          );
        })}
      </ol>
    </div>
  );
}

function parseSummary(raw: string | null): {
  current: string;
  desired: string;
  summary: string;
  reason: string;
} {
  if (!raw) return { current: "", desired: "", summary: "", reason: "" };
  const grab = (label: string): string => {
    const re = new RegExp(
      `\\*\\*${label}\\*\\*\\s*:?\\s*([\\s\\S]*?)(?=\\n\\s*\\*\\*[A-Z][a-zA-Z ]+\\*\\*\\s*:?|$)`,
      "i",
    );
    return raw.match(re)?.[1]?.trim() ?? "";
  };
  const reason = grab("Reason");
  const current = grab("Current state");
  const desired = grab("Desired state");
  let summary = raw;
  for (const label of ["Step", "Reason", "Current state", "Desired state"]) {
    const re = new RegExp(
      `\\*\\*${label}\\*\\*\\s*:?\\s*[\\s\\S]*?(?=\\n\\s*\\*\\*[A-Z][a-zA-Z ]+\\*\\*\\s*:?|$)`,
      "i",
    );
    summary = summary.replace(re, "").trim();
  }
  return { current, desired, summary, reason };
}
