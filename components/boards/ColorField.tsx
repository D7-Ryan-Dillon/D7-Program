"use client";

export function ColorField({ label, value, onChange }: { label: string; value: string; onChange: (v: string) => void }) {
  return (
    <label className="flex items-center justify-between gap-2 text-xs">
      <span className="text-muted-foreground">{label}</span>
      <span className="flex items-center gap-1.5">
        <input type="color" value={value} onChange={(e) => onChange(e.target.value)} className="h-6 w-8 cursor-pointer rounded border border-input bg-transparent p-0.5" />
        <span className="w-16 font-mono text-[10px] text-muted-foreground">{value}</span>
      </span>
    </label>
  );
}
