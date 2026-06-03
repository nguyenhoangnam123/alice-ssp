// Per-service / per-tenant usage widget for the service detail page.
// Renders three things:
//   1. Bedrock usage      — month-to-date count + cost + recent calls list.
//   2. MCP tool calls     — recent llm_calls rows (the persisted half of
//                            what the MCP captures; spans are EMF-only in MVP1).
//   3. Usage limit        — tenants.bedrock_monthly_cap_usd + remaining.
//
// All data comes from the portal's own DB; no external CloudWatch query yet.

type UsageProps = {
  monthSpentUsd: number;
  monthCapUsd: number;
  callsThisMonth: number;
  recentCalls: Array<{
    id: string;
    model: string;
    inputTokens: number;
    outputTokens: number;
    cacheReadTokens: number;
    costUsd: number;
    latencyMs: number | null;
    createdAt: string;
    crId: string | null;
  }>;
};

export function UsageWidget(props: UsageProps) {
  const remaining = Math.max(0, props.monthCapUsd - props.monthSpentUsd);
  const pct = props.monthCapUsd > 0
    ? Math.min(100, (props.monthSpentUsd / props.monthCapUsd) * 100)
    : 0;
  const tone =
    pct >= 100 ? "red" : pct >= 80 ? "yellow" : pct >= 50 ? "blue" : "green";
  const toneClass: Record<string, string> = {
    red: "bg-red-900/40 border-red-700 text-red-300",
    yellow: "bg-yellow-900/30 border-yellow-700 text-yellow-300",
    blue: "bg-blue-900/30 border-blue-700 text-blue-300",
    green: "bg-green-900/30 border-green-700 text-green-300",
  };

  return (
    <div className="border border-border rounded p-4 space-y-4">
      <h3 className="text-sm uppercase text-muted tracking-wide">
        Tenant Bedrock usage · this month
      </h3>

      <div className="grid grid-cols-3 gap-3">
        <Stat label="spent (mtd)" value={`$${props.monthSpentUsd.toFixed(4)}`} />
        <Stat
          label="monthly cap"
          value={`$${props.monthCapUsd.toFixed(2)}`}
        />
        <Stat
          label={pct >= 100 ? "OVER CAP" : "remaining"}
          value={`$${remaining.toFixed(4)}`}
          tone={pct >= 100 ? "red" : "default"}
        />
      </div>

      {/* progress bar */}
      <div className="h-2 bg-panel rounded overflow-hidden">
        <div
          className={`h-full ${toneClass[tone]}`}
          style={{ width: `${pct}%` }}
        />
      </div>
      <div className="text-xs text-muted">
        {props.callsThisMonth} MCP-recorded tool call{props.callsThisMonth === 1 ? "" : "s"} this month ({pct.toFixed(1)}%
        of cap used)
      </div>

      <div>
        <div className="text-xs text-muted mb-2">
          Recent MCP <code>record_llm_call</code> events
        </div>
        {props.recentCalls.length === 0 ? (
          <p className="text-muted text-xs">
            No calls yet. Chat or submit a CR to generate one.
          </p>
        ) : (
          <ol className="text-xs space-y-1">
            {props.recentCalls.map((c) => (
              <li
                key={c.id}
                className="grid grid-cols-[10rem_8rem_6rem_5rem_5rem_auto] gap-2 font-mono"
              >
                <span className="text-muted">
                  {new Date(c.createdAt).toLocaleString()}
                </span>
                <span title={c.model}>{c.model.replace(/^eu\./, "")}</span>
                <span title="input / output tokens">
                  {c.inputTokens}↑ {c.outputTokens}↓
                </span>
                <span title="cache reads">
                  {c.cacheReadTokens > 0 ? `cache ${c.cacheReadTokens}` : ""}
                </span>
                <span>${c.costUsd.toFixed(6)}</span>
                <span className="text-muted">
                  {c.latencyMs !== null ? `${c.latencyMs}ms` : ""}
                  {c.crId && !c.crId.startsWith("svc:") ? ` · CR ${c.crId.slice(-6)}` : ""}
                </span>
              </li>
            ))}
          </ol>
        )}
      </div>
    </div>
  );
}

function Stat({
  label,
  value,
  tone = "default",
}: {
  label: string;
  value: string;
  tone?: "default" | "red";
}) {
  return (
    <div
      className={`border rounded p-2 ${tone === "red" ? "border-red-700" : "border-border"}`}
    >
      <div className="text-xs text-muted">{label}</div>
      <div
        className={`text-lg ${tone === "red" ? "text-red-300" : "text-fg"}`}
      >
        {value}
      </div>
    </div>
  );
}
