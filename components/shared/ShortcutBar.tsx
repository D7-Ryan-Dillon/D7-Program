"use client";

import { useState } from "react";
import { Keyboard } from "lucide-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { prettyKeys, useActiveShortcuts, useGroupedShortcuts, useShortcuts } from "@/lib/shortcuts";

const Key = ({ keys }: { keys: string }) => (
  <span className="inline-flex shrink-0 items-center gap-0.5">
    {prettyKeys(keys)
      .split("+")
      .map((k, i) => (
        <kbd key={i} className="rounded border border-white/20 bg-white/5 px-1.5 py-px font-mono text-[10px] leading-4 text-foreground">
          {k.trim() || "+"}
        </kbd>
      ))}
  </span>
);

/** The slim bar at the bottom of every tab: the shortcuts that work right now. It changes with the tab and the selection because it is drawn from the same registry the keys run from. */
export function ShortcutBar({ tab }: { tab: string }) {
  const [open, setOpen] = useState(false);
  const list = useActiveShortcuts(tab).filter((d) => d.group !== "hidden");
  const groups = useGroupedShortcuts(tab).filter(([g]) => g !== "hidden");
  useShortcuts("global", [{ keys: "?", label: "All shortcuts", group: "General", run: () => setOpen(true) }]);
  return (
    <>
      <footer className="flex shrink-0 items-center gap-3 border-t border-white/10 bg-black px-3 py-1.5" aria-label="Keyboard shortcuts">
        <button type="button" onClick={() => setOpen(true)} className="flex shrink-0 items-center gap-1.5 font-mono text-[10px] uppercase tracking-label text-muted-foreground hover:text-foreground" title="All shortcuts (?)">
          <Keyboard className="h-3.5 w-3.5" />
          Keys
        </button>
        <div className="flex min-w-0 flex-1 items-center gap-x-4 gap-y-1 overflow-x-auto whitespace-nowrap">
          {list.map((d) => (
            <span key={`${d.keys}|${d.label}`} className="flex shrink-0 items-center gap-1.5 text-[11px] text-muted-foreground">
              <Key keys={d.keys} />
              {d.label}
            </span>
          ))}
        </div>
      </footer>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-h-[80vh] overflow-y-auto sm:max-w-xl">
          <DialogHeader>
            <DialogTitle>Keyboard shortcuts</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            {groups.map(([group, defs]) => (
              <div key={group}>
                <div className="mb-1.5 font-mono text-[10px] uppercase tracking-label text-muted-foreground">{group}</div>
                <div className="grid grid-cols-1 gap-x-6 gap-y-1 sm:grid-cols-2">
                  {defs.map((d) => (
                    <div key={`${d.keys}|${d.label}`} className="flex items-center justify-between gap-3 text-xs">
                      <span>{d.label}</span>
                      <Key keys={d.keys} />
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
