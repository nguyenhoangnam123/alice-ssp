"use client";

import { useState } from "react";
import clsx from "clsx";
import { StatusBadge } from "./status-badge";

type Revision = {
  id: string;
  serviceStatus: string;
  crStatus: string;
  aiSummary: string | null;
  cdManifestRef: string | null;
  dockerfileSnapshot: string | null;
  ciPipelineRef: string | null;
  createdAt: string;          // ISO string for client serialization
};

/**
 * Accordion-style revision history. Only one revision body open at a time; clicking the
 * open one collapses it. Renders the AI summary's markdown sections (Current state /
 * Desired state / Summary) parsed out so the user sees a clean diff-like view.
 */
export function RevisionsTimeline({ revisions }: { revisions: Revision[] }) {
  const [expandedId, setExpandedId] = useState<string | null>(
    revisions[0]?.id ?? null,
  );

  if (revisions.length === 0) {
    return <p className="text-muted">No revisions yet — workflow may still be running.</p>;
  }

  return (
    <ol className="border-l border-border pl-0 space-y-2">
      {revisions.map((r) => {
        const open = expandedId === r.id;
        const { current, desired, summary, rejected } = parseSummary(r.aiSummary);
        return (
          <li key={r.id} className="border border-border rounded">
            <button
              type="button"
              className={clsx(
                "w-full flex items-center gap-3 px-3 py-2 text-left bg-transparent border-0",
                "hover:bg-panel/50",
              )}
              onClick={() => setExpandedId(open ? null : r.id)}
              style={{ background: "transparent", color: "inherit", fontWeight: 400 }}
            >
              <span className="font-mono text-xs text-muted w-44 shrink-0">
                {new Date(r.createdAt).toLocaleString()}
              </span>
              <StatusBadge value={r.serviceStatus} />
              <StatusBadge value={r.crStatus} />
              {rejected && (
                <span className="text-xs text-red-400 ml-2">REJECTED BY AI</span>
              )}
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

/**
 * The AI summary is markdown with three named sections. Parse them out so the UI can
 * lay current/desired side-by-side.
 */
function parseSummary(raw: string | null): {
  current: string;
  desired: string;
  summary: string;
  rejected: boolean;
} {
  if (!raw) return { current: "", desired: "", summary: "", rejected: false };

  const rejected = /\*\*Rejected by AI\*\*/i.test(raw);
  const grab = (label: string): string => {
    const re = new RegExp(
      `\\*\\*${label}\\*\\*\\s*:?\\s*([\\s\\S]*?)(?=\\n\\s*\\*\\*[A-Z]|$)`,
      "i",
    );
    return raw.match(re)?.[1]?.trim() ?? "";
  };

  return {
    current: grab("Current state"),
    desired: grab("Desired state"),
    summary: grab("Summary") || grab("Rejected by AI") || raw,
    rejected,
  };
}
