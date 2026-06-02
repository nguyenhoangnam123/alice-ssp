"use client";

import { useState } from "react";
import clsx from "clsx";

type Revision = {
  id: string;
  step: string | null;
  serviceStatus: string;
  crStatus: string;
  aiSummary: string | null;
  cdManifestRef: string | null;
  dockerfileSnapshot: string | null;
  ciPipelineRef: string | null;
  createdAt: string;
};

// Cosmetic mapping from the orchestrator's step enum to a label + colour. New steps
// just need an entry here.
const STEP_META: Record<
  string,
  { label: string; tone: "ok" | "info" | "warn" | "fail"; icon: string }
> = {
  policy_gate_passed: { label: "Policy gate passed", tone: "ok", icon: "✓" },
  policy_gate_rejected: { label: "Policy gate rejected", tone: "fail", icon: "✕" },
  ai_validation_passed: { label: "AI validation passed", tone: "ok", icon: "✓" },
  ai_validation_rejected: { label: "AI validation rejected", tone: "fail", icon: "✕" },
  ai_artifacts_generated: { label: "AI artifacts generated", tone: "info", icon: "✎" },
  pr_opened: { label: "PR opened", tone: "info", icon: "↗" },
  pr_merged: { label: "PR merged + synced", tone: "ok", icon: "✓" },
};

const TONE_CLASS: Record<string, string> = {
  ok: "border-green-700 text-green-400",
  info: "border-blue-700 text-blue-400",
  warn: "border-yellow-700 text-yellow-400",
  fail: "border-red-700 text-red-400",
};

/**
 * Accordion timeline showing the workflow as discrete steps. One row per step
 * (`service_revisions.step`). Click a row to expand its body; clicking again or
 * another row collapses the previous one.
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
        const meta = (r.step && STEP_META[r.step]) || {
          label: r.serviceStatus,
          tone: "info" as const,
          icon: "•",
        };
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
              <span
                className={clsx(
                  "inline-flex items-center gap-1 text-xs px-2 py-0.5 border rounded",
                  TONE_CLASS[meta.tone],
                )}
              >
                <span>{meta.icon}</span>
                <span>{meta.label}</span>
              </span>
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
              <div className="border-t border-border px-3 py-3 space-y-3 text-sm">
                {reason && (
                  <div className="text-sm text-red-300">
                    <span className="text-xs text-muted block mb-1">
                      Reason
                    </span>
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
                    <div className="text-xs text-muted mb-1">Detail</div>
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

/**
 * The AI summary is markdown. Parse out **Current state**, **Desired state**, the
 * remainder ("Summary"/"Detail"), and an optional **Reason** for rejection steps.
 */
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

  // Anything that's not one of the named sections is the "detail" body.
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
