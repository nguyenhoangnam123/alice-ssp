"use client";

import { useState, type ReactNode } from "react";
import clsx from "clsx";

type Tab = { id: string; label: string; content: ReactNode };

export function ServiceTabs({
  tabs,
  defaultId,
}: {
  tabs: Tab[];
  defaultId?: string;
}) {
  const initial = defaultId ?? tabs[0]?.id ?? "";
  const [activeId, setActiveId] = useState(initial);
  const active = tabs.find((t) => t.id === activeId) ?? tabs[0];

  return (
    <div>
      <nav
        className="flex gap-1 border-b border-border"
        role="tablist"
        aria-label="Service detail tabs"
      >
        {tabs.map((t) => {
          const isActive = activeId === t.id;
          return (
            <button
              key={t.id}
              type="button"
              role="tab"
              aria-selected={isActive}
              onClick={() => setActiveId(t.id)}
              className={clsx(
                "px-4 py-2 text-sm border-b-2 -mb-px",
                isActive
                  ? "border-fg text-fg"
                  : "border-transparent text-muted hover:text-fg",
              )}
              style={{
                background: "transparent",
                color: "inherit",
                fontWeight: 400,
                borderRadius: 0,
              }}
            >
              {t.label}
            </button>
          );
        })}
      </nav>
      <div className="pt-6" role="tabpanel" aria-labelledby={active?.id}>
        {active?.content}
      </div>
    </div>
  );
}
