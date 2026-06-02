"use client";

import { useState, useMemo, useRef, useEffect } from "react";
import clsx from "clsx";

/**
 * Combobox-style filter input. As the user types, suggestions matching the substring
 * appear in a dropdown directly under the input. Clicking a suggestion adds it as a
 * chip BELOW the input — the chip sticks there until clicked off. Multiple chips =
 * union (OR) filter.
 */
export function FilterChipInput({
  label,
  options,
  selected,
  onChange,
  placeholder,
}: {
  label: string;
  options: string[];
  selected: string[];
  onChange: (next: string[]) => void;
  placeholder?: string;
}) {
  const [input, setInput] = useState("");
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);

  const filteredOptions = useMemo(() => {
    const q = input.trim().toLowerCase();
    return options
      .filter((o) => !selected.includes(o))
      .filter((o) => (q ? o.toLowerCase().includes(q) : true))
      .slice(0, 8);
  }, [options, input, selected]);

  useEffect(() => {
    const onDocClick = (e: MouseEvent) => {
      if (!wrapRef.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDocClick);
    return () => document.removeEventListener("mousedown", onDocClick);
  }, []);

  const add = (value: string) => {
    if (!value || selected.includes(value)) return;
    onChange([...selected, value]);
    setInput("");
    setOpen(false);
  };

  const remove = (value: string) => {
    onChange(selected.filter((v) => v !== value));
  };

  return (
    <div ref={wrapRef} className="relative">
      <label className="block text-xs text-muted mb-1">{label}</label>
      <input
        type="text"
        value={input}
        onChange={(e) => {
          setInput(e.target.value);
          setOpen(true);
        }}
        onFocus={() => setOpen(true)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && filteredOptions[0]) {
            e.preventDefault();
            add(filteredOptions[0]);
          }
        }}
        placeholder={placeholder ?? `type to filter ${label.toLowerCase()}…`}
      />

      {open && filteredOptions.length > 0 && (
        <ul
          className={clsx(
            "absolute z-30 left-0 right-0 mt-1 bg-panel border border-border rounded",
            "shadow-lg max-h-56 overflow-y-auto",
          )}
        >
          {filteredOptions.map((o) => (
            <li
              key={o}
              className="px-3 py-1.5 cursor-pointer hover:bg-border/50 text-sm"
              onClick={() => add(o)}
            >
              {o}
            </li>
          ))}
        </ul>
      )}

      {selected.length > 0 && (
        <div className="flex flex-wrap gap-1 mt-2">
          {selected.map((v) => (
            <span
              key={v}
              className="inline-flex items-center gap-1 text-xs px-2 py-1 border border-border rounded bg-panel"
            >
              <span className="text-muted">{label.toLowerCase()}:</span>
              <span className="font-mono">{v}</span>
              <button
                type="button"
                onClick={() => remove(v)}
                className="secondary !p-0 !px-1 !text-xs ml-1 hover:!text-red-400"
                aria-label={`Remove ${v}`}
                style={{ background: "transparent", border: "none" }}
              >
                ✕
              </button>
            </span>
          ))}
        </div>
      )}
    </div>
  );
}
