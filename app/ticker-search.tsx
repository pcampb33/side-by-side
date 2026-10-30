"use client";

import { useEffect, useRef, useState } from "react";
import type { TickerEntry } from "@/lib/sec/client";

type Results =
  | { status: "idle" }
  | { status: "loading" }
  | { status: "error"; message: string }
  | { status: "done"; query: string; matches: TickerEntry[] };

export function TickerSearch({
  id,
  label,
  value,
  onChange,
}: {
  id: string;
  label: string;
  value: TickerEntry | null;
  onChange: (entry: TickerEntry | null) => void;
}) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<Results>({ status: "idle" });
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const q = query.trim();
    if (!q) return;
    const controller = new AbortController();
    const timer = setTimeout(async () => {
      setResults({ status: "loading" });
      try {
        const res = await fetch(`/api/search?q=${encodeURIComponent(q)}`, { signal: controller.signal });
        const body = await res.json();
        if (!res.ok) throw new Error(body.error ?? `Search failed (HTTP ${res.status})`);
        setResults({ status: "done", query: q, matches: body });
        setActive(0);
      } catch (err) {
        if (controller.signal.aborted) return;
        setResults({ status: "error", message: err instanceof Error ? err.message : "Search failed." });
      }
    }, 150);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [query]);

  const select = (entry: TickerEntry) => {
    onChange(entry);
    setQuery("");
    setResults({ status: "idle" });
    setOpen(false);
  };

  if (value) {
    return (
      <div>
        <span className="text-sm font-medium">{label}</span>
        <div className="mt-2 flex items-center justify-between gap-3 rounded-md border border-rule bg-surface px-4 py-3">
          <span className="min-w-0 truncate">
            <span className="font-semibold">{value.ticker}</span> <span className="text-muted">{value.name}</span>
          </span>
          <button
            type="button"
            className="shrink-0 text-sm text-accent hover:underline"
            onClick={() => {
              onChange(null);
              requestAnimationFrame(() => inputRef.current?.focus());
            }}
          >
            Change
          </button>
        </div>
      </div>
    );
  }

  const matches = results.status === "done" ? results.matches : [];
  const listId = `${id}-results`;
  const showList = open && query.trim() !== "" && results.status !== "idle";

  return (
    <div className="relative">
      <label htmlFor={id} className="text-sm font-medium">
        {label}
      </label>
      <input
        ref={inputRef}
        id={id}
        type="text"
        role="combobox"
        aria-expanded={showList}
        aria-controls={listId}
        aria-autocomplete="list"
        aria-activedescendant={showList && matches[active] ? `${listId}-${active}` : undefined}
        autoComplete="off"
        placeholder="Company name or ticker"
        value={query}
        onChange={(e) => {
          setQuery(e.target.value);
          if (!e.target.value.trim()) setResults({ status: "idle" });
          setOpen(true);
        }}
        onFocus={() => setOpen(true)}
        onBlur={() => setOpen(false)}
        onKeyDown={(e) => {
          if (e.key === "ArrowDown" && matches.length) {
            e.preventDefault();
            setActive((i) => (i + 1) % matches.length);
          } else if (e.key === "ArrowUp" && matches.length) {
            e.preventDefault();
            setActive((i) => (i - 1 + matches.length) % matches.length);
          } else if (e.key === "Enter" && showList && matches[active]) {
            e.preventDefault();
            select(matches[active]);
          } else if (e.key === "Escape") {
            setOpen(false);
          }
        }}
        className="mt-2 w-full rounded-md border border-rule bg-surface px-4 py-3 outline-none placeholder:text-muted focus:border-accent"
      />
      {showList && (
        <div className="absolute z-10 mt-1 w-full overflow-hidden rounded-md border border-rule bg-surface shadow-lg">
          {results.status === "loading" && <p className="px-4 py-3 text-sm text-muted">Searching…</p>}
          {results.status === "error" && <p className="px-4 py-3 text-sm text-danger">{results.message}</p>}
          {results.status === "done" && matches.length === 0 && (
            <p className="px-4 py-3 text-sm text-muted">No SEC-registered company matches “{results.query}”.</p>
          )}
          {matches.length > 0 && (
            <ul id={listId} role="listbox" aria-label={`${label} matches`}>
              {matches.map((m, i) => (
                <li
                  key={`${m.cik}-${m.ticker}`}
                  id={`${listId}-${i}`}
                  role="option"
                  aria-selected={i === active}
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => select(m)}
                  onMouseEnter={() => setActive(i)}
                  className={`flex cursor-pointer gap-3 px-4 py-2.5 ${i === active ? "bg-paper" : ""}`}
                >
                  <span className="w-16 shrink-0 font-semibold">{m.ticker}</span>
                  <span className="truncate text-muted">{m.name}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
