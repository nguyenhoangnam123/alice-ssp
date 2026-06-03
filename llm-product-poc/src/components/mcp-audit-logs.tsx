// MCP audit logs viewer for the service detail page. Merges two streams:
//   - llm_calls       (every Bedrock invocation: model, tokens, cost)
//   - guarded_actions (every policy-gate / budget / output-validator
//                      rejection, every secret CR step, every PII block)
//
// Both tables are tenant-scoped; this view shows the last 100 events for
// the service's tenant ordered by time desc. The components is a presenter
// only — server-side query happens in the page.

import clsx from "clsx";

export type AuditEvent =
  | {
      kind: "llm_call";
      ts: string;
      model: string;
      inputTokens: number;
      outputTokens: number;
      cacheReadTokens: number;
      costUsd: number;
      latencyMs: number | null;
      crId: string | null;
    }
  | {
      kind: "guarded_action";
      ts: string;
      action: string;
      actorUserId: string | null;
      resource: string | null;
      outcome: "allowed" | "blocked" | "warning" | string;
      detail: string | null;
    };

export function McpAuditLogs({ events }: { events: AuditEvent[] }) {
  if (events.length === 0) {
    return (
      <p className="text-muted text-sm">
        No MCP-recorded events yet for this tenant. Submit a CR or chat
        message to generate one.
      </p>
    );
  }
  return (
    <div className="border border-border rounded p-4">
      <h3 className="text-sm uppercase text-muted tracking-wide mb-3">
        MCP audit log · tenant scope · most recent 100 events
      </h3>
      <p className="text-xs text-muted mb-3">
        Each row is one MCP event the platform recorded. <code>llm_call</code>
        rows come from <code>record_llm_call</code>; <code>guarded_action</code>
        rows from <code>log_guarded_action</code>. CloudWatch EMF on stderr
        is the durable copy — these are the queryable replicas.
      </p>
      <ol className="space-y-1 text-xs">
        {events.map((e, i) => (
          <li
            key={`${e.kind}-${e.ts}-${i}`}
            className="grid grid-cols-[10rem_8rem_auto] gap-2 items-baseline border-b border-border/30 pb-1"
          >
            <span className="font-mono text-muted">
              {new Date(e.ts).toLocaleString()}
            </span>
            <span
              className={clsx(
                "font-mono px-1.5 py-0.5 rounded border text-[10px] uppercase w-fit",
                e.kind === "llm_call"
                  ? "border-blue-700 text-blue-400"
                  : guardedToneClass(
                      (e as { outcome: string }).outcome,
                    ),
              )}
            >
              {e.kind === "llm_call" ? "llm_call" : e.kind}
            </span>
            <span className="font-mono whitespace-pre-wrap break-words">
              {renderBody(e)}
            </span>
          </li>
        ))}
      </ol>
    </div>
  );
}

function guardedToneClass(outcome: string): string {
  switch (outcome) {
    case "blocked":
      return "border-red-700 text-red-400";
    case "warning":
      return "border-yellow-700 text-yellow-400";
    default:
      return "border-green-700 text-green-400";
  }
}

function renderBody(e: AuditEvent): string {
  if (e.kind === "llm_call") {
    const cache = e.cacheReadTokens > 0 ? ` cache=${e.cacheReadTokens}` : "";
    const lat = e.latencyMs !== null ? ` ${e.latencyMs}ms` : "";
    const cr = e.crId ? ` cr=${e.crId.slice(-6)}` : "";
    return `${e.model.replace(/^eu\./, "")}  in=${e.inputTokens} out=${e.outputTokens}${cache}  $${e.costUsd.toFixed(6)}${lat}${cr}`;
  }
  // guarded_action
  const actor = e.actorUserId ? ` by ${e.actorUserId.slice(-6)}` : "";
  const res = e.resource ? `\n    resource=${e.resource}` : "";
  const det = e.detail ? `\n    detail=${e.detail}` : "";
  return `${e.action} (${e.outcome})${actor}${res}${det}`;
}
