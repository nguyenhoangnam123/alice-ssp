"use client";

import { useState, useMemo } from "react";
import Link from "next/link";
import clsx from "clsx";
import { StatusBadge } from "./status-badge";
import { FilterChipInput } from "./filter-chip-input";

type Row = {
  id: string;
  name: string;
  subdomain: string | null;
  currentStatus: string;
  tenantDomain: string;
  latestCr: {
    summary: string;
    status: string;
    createdAt: string;
  } | null;
  latestAiSummary: string | null;
};

/**
 * Services list with two filter-chip inputs and click-to-expand rows. The expanded
 * row shows the latest CR's status + AI summary. A row-level "History →" link goes
 * to the service detail page, which is also the per-service CR history (timeline).
 */
export function ServicesTable({ rows }: { rows: Row[] }) {
  const allTenants = useMemo(
    () => Array.from(new Set(rows.map((r) => r.tenantDomain))).sort(),
    [rows],
  );
  const allNames = useMemo(
    () => Array.from(new Set(rows.map((r) => r.name))).sort(),
    [rows],
  );

  const [nameFilter, setNameFilter] = useState<string[]>([]);
  const [tenantFilter, setTenantFilter] = useState<string[]>([]);
  const [expandedId, setExpandedId] = useState<string | null>(null);

  const filtered = useMemo(
    () =>
      rows.filter((r) => {
        const okName = nameFilter.length === 0 || nameFilter.includes(r.name);
        const okTenant =
          tenantFilter.length === 0 || tenantFilter.includes(r.tenantDomain);
        return okName && okTenant;
      }),
    [rows, nameFilter, tenantFilter],
  );

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4 max-w-2xl">
        <FilterChipInput
          label="Service name"
          options={allNames}
          selected={nameFilter}
          onChange={setNameFilter}
          placeholder="type a service name…"
        />
        <FilterChipInput
          label="Tenant"
          options={allTenants}
          selected={tenantFilter}
          onChange={setTenantFilter}
          placeholder="type a tenant domain…"
        />
      </div>

      <div className="text-xs text-muted">
        {filtered.length} of {rows.length} services
      </div>

      <table>
        <thead>
          <tr>
            <th></th>
            <th>tenant</th>
            <th>name</th>
            <th>subdomain</th>
            <th>status</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          {filtered.map((r) => {
            const open = expandedId === r.id;
            return (
              <RowGroup
                key={r.id}
                row={r}
                open={open}
                onToggle={() => setExpandedId(open ? null : r.id)}
              />
            );
          })}
          {filtered.length === 0 && (
            <tr>
              <td colSpan={6} className="text-muted text-sm py-4">
                No services match the current filters.
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}

function RowGroup({
  row,
  open,
  onToggle,
}: {
  row: Row;
  open: boolean;
  onToggle: () => void;
}) {
  return (
    <>
      <tr
        className={clsx(
          "cursor-pointer transition-colors",
          open ? "bg-panel/60" : "hover:bg-panel/40",
        )}
        onClick={onToggle}
      >
        <td className="text-muted text-xs w-6">{open ? "▾" : "▸"}</td>
        <td className="font-mono text-muted">{row.tenantDomain}</td>
        <td className="font-medium">{row.name}</td>
        <td className="font-mono text-sm text-muted">{row.subdomain ?? "—"}</td>
        <td>
          <StatusBadge value={row.currentStatus} />
        </td>
        <td className="text-right" onClick={(e) => e.stopPropagation()}>
          <Link
            href={`/dashboard/services/${row.id}`}
            className="text-xs no-underline"
          >
            History →
          </Link>
        </td>
      </tr>
      {open && (
        <tr>
          <td></td>
          <td colSpan={5} className="bg-panel/40 border-t border-border py-3">
            {row.latestCr ? (
              <div className="space-y-2 text-sm">
                <div className="flex items-center gap-2">
                  <span className="text-xs text-muted">Latest CR</span>
                  <StatusBadge value={row.latestCr.status} />
                  <span className="text-xs text-muted">
                    {new Date(row.latestCr.createdAt).toLocaleString()}
                  </span>
                </div>
                <div className="text-sm">{row.latestCr.summary}</div>
                {row.latestAiSummary && (
                  <details className="text-sm">
                    <summary className="cursor-pointer text-muted text-xs">
                      AI summary
                    </summary>
                    <div className="mt-2 whitespace-pre-wrap text-sm pl-3 border-l-2 border-border">
                      {row.latestAiSummary}
                    </div>
                  </details>
                )}
              </div>
            ) : (
              <p className="text-muted text-sm">
                No change requests for this service yet.
              </p>
            )}
          </td>
        </tr>
      )}
    </>
  );
}
