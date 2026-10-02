"use client";

import { useState } from "react";
import { RefreshCw } from "lucide-react";
import { Popover } from "@base-ui/react/popover";
import { Button } from "@/components/ui/button";
import { Select } from "@/components/ui/select";
import { SYNC_FIELDS, type SyncField } from "@/components/shared/TilePane";

/** "Sync all viewports": pick which viewport is the model answer and which
 * groups of settings to copy from it onto every other viewport. */
export function SyncAllMenu({ count, onSync }: { count: number; onSync: (source: number, fields: SyncField[]) => void }) {
  const [source, setSource] = useState(0);
  const [fields, setFields] = useState<SyncField[]>(SYNC_FIELDS.map((f) => f.key));

  return (
    <Popover.Root>
      <Popover.Trigger className="flex h-7 items-center gap-1.5 rounded-md border-hair px-2 font-mono text-[10px] uppercase tracking-label text-muted-foreground transition-colors hover:border-white/30 hover:text-foreground data-[popup-open]:border-magenta/50 data-[popup-open]:text-foreground">
        <RefreshCw className="h-3.5 w-3.5" />
        Sync all
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Positioner side="bottom" align="start" sideOffset={6} collisionPadding={8} className="z-[70]">
          <Popover.Popup className="w-64 max-w-[92vw] space-y-3 rounded-lg border-hair bg-popover p-3 text-xs text-popover-foreground shadow-lg outline-none">
            <div className="font-mono text-[10px] uppercase tracking-label text-muted-foreground">Sync all viewports</div>
            <label className="block">
              <span className="mb-1 block text-muted-foreground">Copy from</span>
              <Select className="w-full" value={String(Math.min(source, count - 1))} onChange={(e) => setSource(Number(e.target.value))}>
                {Array.from({ length: count }, (_, i) => (
                  <option key={i} value={String(i)}>
                    Viewport {i + 1}
                  </option>
                ))}
              </Select>
            </label>
            <div className="space-y-1.5">
              {SYNC_FIELDS.map((f) => (
                <label key={f.key} className="flex items-center gap-2">
                  <input type="checkbox" checked={fields.includes(f.key)} onChange={(e) => setFields((cur) => (e.target.checked ? [...cur, f.key] : cur.filter((k) => k !== f.key)))} />
                  {f.label}
                </label>
              ))}
            </div>
            <Button size="sm" className="w-full" disabled={!fields.length} onClick={() => onSync(Math.min(source, count - 1), fields)}>
              Apply to the other viewports
            </Button>
          </Popover.Popup>
        </Popover.Positioner>
      </Popover.Portal>
    </Popover.Root>
  );
}
