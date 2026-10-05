"use client";

import { useEffect, useState } from "react";
import dynamic from "next/dynamic";
import { toast } from "sonner";
import { X } from "lucide-react";
import { GlowPanel } from "@/components/shared/GlowPanel";
import { Button } from "@/components/ui/button";
import { TileBank } from "@/components/sections/TileBank";
import { CubeHexBuilder } from "@/components/sections/CubeHexBuilder";

// paper.js (used by CorrectionEditor) assumes a browser environment and
// breaks when Next's SSR pass evaluates its module graph on the server --
// loading it client-only sidesteps that entirely rather than fighting
// paper's own Node-detection shim (see lib/sections/correctionGeometry.ts).
const CorrectionEditor = dynamic(() => import("@/components/sections/CorrectionEditor").then((m) => m.CorrectionEditor), { ssr: false });
import { addNewTile, loadTileBank, nextTileNumber, renameTile, saveCorrection, type BankTile } from "@/lib/sections/tileLibrary";
import { autoTraceImage } from "@/lib/sections/autoTrace";
import { useShortcuts } from "@/lib/shortcuts";

export function SectionsTab() {
  const [tiles, setTiles] = useState<BankTile[] | null>(null);
  const [selectedNames, setSelectedNames] = useState<Set<string>>(new Set());
  const [editingName, setEditingName] = useState<string | null>(null);
  const [view, setView] = useState<"bank" | "builder">("bank");

  const refresh = () => {
    loadTileBank()
      .then(setTiles)
      .catch(() => toast.error("Couldn't load the Section Field tile bank."));
  };

  useEffect(refresh, []);

  const editingTile = tiles?.find((t) => t.name === editingName) ?? null;
  useShortcuts("sections", [
    { keys: "B", label: "Bank and cleanup", group: "View", run: () => setView("bank") },
    { keys: "U", label: "Cube / hex builder", group: "View", run: () => setView("builder") },
    ...(editingName ? [{ keys: "Escape", label: "Close the editor", group: "Editor", run: () => setEditingName(null) }] : []),
  ]);

  const handleSelect = (name: string, mode: "edit" | "toggle") => {
    if (mode === "edit") {
      setEditingName(name);
      return;
    }
    setSelectedNames((prev) => {
      const next = new Set(prev);
      if (next.has(name)) next.delete(name);
      else next.add(name);
      return next;
    });
  };

  const handleAddFiles = async (files: FileList) => {
    for (const file of Array.from(files)) {
      try {
        const proposal = await autoTraceImage(file);
        const src = await new Promise<string>((resolve, reject) => {
          const reader = new FileReader();
          reader.onload = () => resolve(reader.result as string);
          reader.onerror = reject;
          reader.readAsDataURL(file);
        });
        // The stable id still comes from the file name (uniqueness, no
        // other purpose) -- the display name users actually see is always
        // a sequential "Tile N", continuing from whatever's already in the
        // bank (baked photos included) rather than the raw file name.
        const name = `${file.name.replace(/\.[^.]+$/, "")}-${Date.now().toString(36)}`;
        addNewTile({ name, src, proposal });
        renameTile(name, `Tile ${nextTileNumber((tiles ?? []).map((t) => t.displayName))}`);
      } catch {
        toast.error(`Couldn't trace ${file.name}.`);
      }
    }
    refresh();
  };

  if (!tiles) {
    return <div className="p-8 text-center text-sm text-muted-foreground">Loading tile bank…</div>;
  }

  const bankForBuilder = tiles.filter((t) => selectedNames.has(t.name));

  return (
    <div className="flex flex-col gap-4 lg:h-full lg:min-h-0">
      <div className="flex items-center gap-2">
        <Button size="sm" variant={view === "bank" ? "default" : "outline"} onClick={() => setView("bank")}>
          Bank &amp; cleanup
        </Button>
        <Button size="sm" variant={view === "builder" ? "default" : "outline"} onClick={() => setView("builder")}>
          Cube / hex builder{bankForBuilder.length ? ` (${bankForBuilder.length} selected)` : ""}
        </Button>
      </div>

      {view === "bank" ? (
        <GlowPanel glow="magenta" className="lg:min-h-0 lg:flex-1 lg:overflow-y-auto">
          <div className="p-4">
            <TileBank
              tiles={tiles}
              selected={selectedNames}
              onSelect={handleSelect}
              onAddFiles={(files) => void handleAddFiles(files)}
              onRename={(name, displayName) => {
                renameTile(name, displayName);
                setTiles((prev) => prev?.map((t) => (t.name === name ? { ...t, displayName } : t)) ?? prev);
              }}
            />
          </div>
        </GlowPanel>
      ) : (
        <CubeHexBuilder bankTiles={bankForBuilder} allTiles={tiles} onSaved={() => {}} />
      )}

      {editingTile && (
        <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/70 p-6">
          <div className="flex h-full max-h-[90vh] w-full max-w-5xl flex-col overflow-hidden rounded-xl border border-white/15 bg-background">
            <div className="flex items-center justify-between border-b border-white/10 px-3 py-2">
              <span className="font-mono text-xs uppercase tracking-label text-muted-foreground">Vector correction · {editingTile.displayName}</span>
              <Button size="icon" variant="ghost" onClick={() => setEditingName(null)}>
                <X className="h-4 w-4" />
              </Button>
            </div>
            <div className="min-h-0 flex-1">
              <CorrectionEditor
                tileName={editingTile.name}
                imageSrc={editingTile.src}
                proposal={editingTile.proposal}
                correction={editingTile.corrected ? editingTile.proposal : null}
                onChange={(correction) => {
                  saveCorrection(editingTile.name, correction);
                  setTiles((prev) => prev?.map((t) => (t.name === editingTile.name ? { ...t, proposal: correction, corrected: true } : t)) ?? prev);
                }}
                onClose={() => setEditingName(null)}
              />
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
