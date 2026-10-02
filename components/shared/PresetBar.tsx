"use client";

import { Select } from "@/components/ui/select";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { Preset } from "@/lib/presets";

/** Save / apply / overwrite / rename / delete named presets. The caller owns
 * what a preset contains: `onSave`/`onUpdate` receive nothing and snapshot
 * the current state themselves, `onApply` restores one. */
export function PresetBar<T>({
  label,
  presets,
  onSave,
  onUpdate,
  onRename,
  onRemove,
  onApply,
}: {
  label: string;
  presets: Preset<T>[];
  onSave: (name: string) => void;
  onUpdate: (id: string) => void;
  onRename: (id: string, name: string) => void;
  onRemove: (id: string) => void;
  onApply: (preset: Preset<T>) => void;
}) {
  const [selectedId, setSelectedId] = useState("");
  const [name, setName] = useState("");
  const selected = presets.find((p) => p.id === selectedId);

  return (
    <div className="space-y-1.5">
      <div className="font-mono text-[11px] tracking-label uppercase text-muted-foreground">{label}</div>
      <div className="flex flex-wrap items-center gap-1.5">
        <Select
          className="h-7 min-w-0 flex-1 rounded-md border border-input bg-transparent px-2 text-xs"
          value={selected ? selectedId : ""}
          onChange={(e) => {
            const preset = presets.find((p) => p.id === e.target.value);
            setSelectedId(e.target.value);
            setName(preset?.name ?? "");
            if (preset) onApply(preset);
          }}
        >
          <option value="">{presets.length ? "Pick a preset to apply…" : "No presets saved yet"}</option>
          {presets.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </Select>
        <Button type="button" size="sm" variant="outline" className="h-7 px-2 text-[11px]" disabled={!selected} title="Overwrite the selected preset with the current settings" onClick={() => selected && onUpdate(selected.id)}>
          Update
        </Button>
        <Button
          type="button"
          size="sm"
          variant="ghost"
          className="h-7 px-2 text-[11px] text-muted-foreground hover:text-destructive"
          disabled={!selected}
          onClick={() => {
            if (!selected) return;
            onRemove(selected.id);
            setSelectedId("");
            setName("");
          }}
        >
          Delete
        </Button>
      </div>
      <div className="flex items-center gap-1.5">
        <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Preset name" className="h-7 min-w-0 flex-1 text-xs" />
        <Button type="button" size="sm" className="h-7 px-2 text-[11px]" disabled={!name.trim()} onClick={() => onSave(name)}>
          Save new
        </Button>
        <Button type="button" size="sm" variant="outline" className="h-7 px-2 text-[11px]" disabled={!selected || !name.trim() || name.trim() === selected.name} onClick={() => selected && onRename(selected.id, name.trim())}>
          Rename
        </Button>
      </div>
    </div>
  );
}
