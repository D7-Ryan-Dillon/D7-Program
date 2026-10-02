"use client";

/** A small pill-style one-of-N switch. */
export function Segmented<T extends string | number>({ value, options, onChange }: { value: T; options: { value: T; label: string }[]; onChange: (v: T) => void }) {
  return (
    <div className="inline-flex flex-wrap rounded-full border-hair p-0.5">
      {options.map((o) => (
        <button
          key={String(o.value)}
          type="button"
          onClick={() => onChange(o.value)}
          className={`rounded-full px-2.5 py-1 font-mono text-[11px] tracking-label uppercase transition-colors ${
            value === o.value ? "bg-gradient-to-r from-magenta to-orange text-white" : "text-muted-foreground hover:text-foreground"
          }`}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}
