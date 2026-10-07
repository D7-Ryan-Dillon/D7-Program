"use client";

import { Select } from "@/components/ui/select";
import { FontPicker } from "./FontPicker";

const COMMON = ["Arial", "Helvetica", "Verdana", "Trebuchet MS", "Georgia", "Times New Roman", "Courier New", "Arkitech"];

/**
 * A font for an export: Default (what the export normally uses), a common one, or any font installed on this device. An empty value is the default.
 */
export function FontField({ value, onChange }: { value: string; onChange: (font: string) => void }) {
  const common = COMMON.includes(value) || !value;
  return (
    <div className="space-y-1">
      <Select className="h-7 w-full text-[11px]" value={common ? value : "__device"} onChange={(e) => onChange(e.target.value === "__device" ? "Arial" : e.target.value)} aria-label="Font">
        <option value="">Default font</option>
        {COMMON.map((f) => (
          <option key={f} value={f}>
            {f}
          </option>
        ))}
        <option value="__device">A font on this device…</option>
      </Select>
      {!common && (
        <FontPicker value={value} onChange={onChange} />
      )}
    </div>
  );
}
